import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createDecipheriv, createHmac } from "node:crypto";
import { rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	DurabilityError,
	DurabilityDatabase,
	defaultLimits,
	hash,
	scopeKey,
} from "../../src/internal/durability.js";
import { ObservationOutbox } from "../../src/telemetry/observations.js";
import {
	canonicalJson,
	evidencePayloadDigest,
	type EvidencePage,
	evidencePageSchemaId,
	readEvidencePage,
	verifyEvidencePage,
} from "../../src/telemetry/evidence-page.js";
import {
	fixture,
	file,
	plan,
	scope,
	foreign,
	sensitive,
} from "../fixtures/durability/fixture.js";

const invalid = (error: unknown) =>
	error instanceof DurabilityError && error.code === "INVALID_INPUT";
function seedJob(f: ReturnType<typeof fixture>, key = "batch", owner = scope) {
	f.jobs.create(owner, plan(key, 2));
	const claim = f.jobs.claim(owner);
	assert.ok(claim);
	f.jobs.complete(owner, claim, [file()]);
}
function outboxState(f: ReturnType<typeof fixture>) {
	return {
		outbox: f.db.sql.prepare("SELECT * FROM outbox ORDER BY rowid").all(),
		transports: f.db.sql.prepare("SELECT * FROM transports").all(),
	};
}

test("envelope states staged, unmapped, non-authoritative provenance with a verifiable digest", () => {
	using f = fixture();
	seedJob(f);
	const page = readEvidencePage(f.outbox, scope);
	assert.equal(page.schema, evidencePageSchemaId);
	assert.equal(page.version, 2);
	assert.deepEqual(
		{ ...page.provenance, note: undefined },
		{
			staged: true,
			local: true,
			mapped: false,
			authoritative: false,
			deliveryStatus: "not_included",
			note: undefined,
		},
	);
	assert.equal("delivered" in page.provenance, false);
	assert.match(page.provenance.note, /no delivery claim/);
	assert.equal(Object.hasOwn(page, "scopeDigest"), false);
	assert.equal(Object.hasOwn(page, "after"), false);
	assert.equal(page.integrity.algorithm, "sha256");
	const { integrity, ...payload } = page;
	assert.equal(integrity.payloadDigest, hash(canonicalJson(payload)));
	assert.equal(verifyEvidencePage(page), true);
	assert.equal(
		verifyEvidencePage({
			...page,
			observations: page.observations.slice(1),
		}),
		false,
	);
	assert.equal(
		verifyEvidencePage({
			...page,
			provenance: { ...page.provenance, authoritative: true as never },
		}),
		false,
	);
});

test("repeated reads are byte-stable and carry recorded references and provenance", () => {
	using f = fixture();
	seedJob(f);
	const a = readEvidencePage(f.outbox, scope);
	const b = readEvidencePage(f.outbox, scope);
	assert.equal(JSON.stringify(a), JSON.stringify(b));
	const source = f.outbox.list(scope);
	assert.ok(source.length > 0);
	assert.equal(a.observations.length, source.length);
	a.observations.forEach((o, i) => {
		const s = source[i];
		assert.ok(s);
		assert.equal(o.observationId, s.id);
		assert.equal(o.operationId, s.operation);
		assert.equal(o.executionAttemptId, s.attempt);
		assert.equal(o.jobId, s.job);
		assert.equal(o.publicationId, s.publication);
		assert.equal(o.environment, "local");
		assert.equal(o.billingMode, "unclassified");
		assert.equal(o.producerBuildDigest, null);
		assert.equal(o.stagingVersion, 1);
	});
	assert.ok(a.observations.some((o) => o.executionAttemptId !== null));
	assert.ok(a.observations.some((o) => o.jobId !== null));
});

test("preserves unknown measurements and never substitutes zero", () => {
	using f = fixture();
	seedJob(f);
	const page = readEvidencePage(f.outbox, scope);
	const planned = page.observations.filter((o) => o.kind === "planned");
	assert.ok(planned.length > 0);
	for (const o of planned) {
		assert.deepEqual(o.metrics.duration, {
			unit: "millisecond",
			value: null,
			completeness: "unknown",
		});
		assert.deepEqual(o.metrics.outputBytes, {
			unit: "byte",
			value: null,
			completeness: "unknown",
		});
	}
	const measured = page.observations.filter(
		(o) => o.metrics.duration.completeness === "measured",
	);
	assert.ok(measured.length > 0);
	for (const o of page.observations) {
		for (const m of Object.values(o.metrics))
			assert.equal(m.value === null, m.completeness === "unknown");
	}
});

test("paginates without skipping or duplicating and binds opaque cursors to scope", () => {
	using f = fixture();
	seedJob(f, "one");
	seedJob(f, "two");
	seedJob(f, "foreign", foreign);
	const all = f.outbox.list(scope).map((e) => e.id);
	assert.ok(all.length > 3);
	const seen: string[] = [];
	let cursor: string | null = null;
	let pages = 0;
	do {
		const page = readEvidencePage(f.outbox, scope, { cursor, limit: 3 });
		assert.ok(page.observations.length <= 3);
		assert.equal(verifyEvidencePage(page), true);
		seen.push(...page.observations.map((o) => o.observationId));
		cursor = page.nextCursor;
		pages++;
	} while (cursor !== null && pages < 100);
	assert.deepEqual(seen, all);
	assert.equal(pages, Math.ceil(all.length / 3));
	const first = readEvidencePage(f.outbox, scope, { limit: 3 });
	assert.ok(first.nextCursor);
	assert.match(first.nextCursor, /^v2:[A-Za-z0-9_-]{96}$/);
	assert.equal(first.nextCursor.includes(scopeKey(scope)), false);
	assert.throws(
		() => readEvidencePage(f.outbox, foreign, { cursor: first.nextCursor }),
		invalid,
	);
	for (const bad of [
		"",
		"7",
		"v1:x:1",
		`v1:${scopeKey(scope)}:1`,
		"v2:x",
		`${first.nextCursor.slice(0, 5)}${first.nextCursor[5] === "A" ? "B" : "A"}${first.nextCursor.slice(6)}`,
	])
		assert.throws(
			() => readEvidencePage(f.outbox, scope, { cursor: bad }),
			invalid,
		);
	assert.throws(
		() => readEvidencePage(f.outbox, scope, { limit: 0 }),
		(e) => e instanceof DurabilityError && e.code === "LIMIT",
	);
	// Mutating any nonce, ciphertext or tag byte must fail authentication.
	const token = Buffer.from(first.nextCursor.slice(3), "base64url");
	assert.equal(token.length, 72);
	assert.equal(token.toString("base64url"), first.nextCursor.slice(3));
	for (let i = 0; i < token.length; i++) {
		const tampered = Buffer.from(token);
		tampered[i] = (tampered[i] ?? 0) ^ 1;
		assert.throws(
			() =>
				readEvidencePage(f.outbox, scope, {
					cursor: `v2:${tampered.toString("base64url")}`,
				}),
			invalid,
		);
	}
	for (const bad of [
		`${first.nextCursor}=`,
		`${first.nextCursor}\n`,
		first.nextCursor.slice(0, -1),
		`${first.nextCursor}A`,
		`v2:${token.toString("hex")}`,
		`v2:${"A".repeat(96)}`,
		new String(first.nextCursor) as never,
	])
		assert.throws(
			() => readEvidencePage(f.outbox, scope, { cursor: bad }),
			invalid,
		);
	// The same cap applies on first and resumed pages, including the default.
	using capped = fixture({ ...defaultLimits, pageSize: 2 });
	seedJob(capped);
	const cappedFirst = readEvidencePage(capped.outbox, scope);
	assert.equal(cappedFirst.limit, null);
	assert.equal(cappedFirst.observations.length, 2);
	assert.ok(cappedFirst.nextCursor);
	for (const limit of [
		0,
		-1,
		3,
		1001,
		Number.MAX_SAFE_INTEGER,
		1.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	]) {
		for (const cursor of [null, cappedFirst.nextCursor]) {
			assert.throws(
				() => readEvidencePage(capped.outbox, scope, { cursor, limit }),
				(e) => e instanceof DurabilityError && e.code === "LIMIT",
			);
		}
	}
	const boundedIds: string[] = [];
	let boundedCursor: string | null = null;
	do {
		const page = readEvidencePage(capped.outbox, scope, {
			cursor: boundedCursor,
		});
		assert.ok(page.observations.length <= 2);
		boundedIds.push(...page.observations.map((o) => o.observationId));
		boundedCursor = page.nextCursor;
	} while (boundedCursor !== null);
	const storedIds = capped.db.sql
		.prepare("SELECT id FROM observations ORDER BY sequence")
		.all()
		.map((row) => row["id"]);
	assert.deepEqual(boundedIds, storedIds);
	using empty = fixture();
	assert.deepEqual(readEvidencePage(empty.outbox, scope).observations, []);
	assert.equal(readEvidencePage(empty.outbox, scope).nextCursor, null);
	const foreignPage = readEvidencePage(f.outbox, foreign);
	assert.deepEqual(
		foreignPage.observations.map((o) => o.observationId),
		f.outbox.list(foreign).map((e) => e.id),
	);
	assert.equal(foreignPage.nextCursor, null);
});

test("isolates scopes", () => {
	using f = fixture();
	seedJob(f, "mine", scope);
	seedJob(f, "theirs", foreign);
	const mine = readEvidencePage(f.outbox, scope);
	const theirs = readEvidencePage(f.outbox, foreign);
	assert.deepEqual(
		mine.observations.map((o) => o.observationId),
		f.outbox.list(scope).map((e) => e.id),
	);
	assert.deepEqual(
		theirs.observations.map((o) => o.observationId),
		f.outbox.list(foreign).map((e) => e.id),
	);
	assert.ok(
		mine.observations.every(
			(o) =>
				!theirs.observations.some(
					(other) => other.observationId === o.observationId,
				),
		),
	);
	assert.equal(Object.hasOwn(mine, "scopeDigest"), false);
	assert.equal(Object.hasOwn(theirs, "scopeDigest"), false);
	assert.ok(mine.observations.every((o) => o.observationId));
});

test("reading evidence leaves outbox delivery state and transports unchanged", () => {
	using f = fixture();
	seedJob(f);
	const claim = f.outbox.claim();
	assert.ok(claim);
	const before = outboxState(f);
	readEvidencePage(f.outbox, scope);
	readEvidencePage(f.outbox, scope, { limit: 1 });
	assert.deepEqual(outboxState(f), before);
	f.outbox.settle(claim, true);
	const settled = outboxState(f);
	readEvidencePage(f.outbox, scope);
	assert.deepEqual(outboxState(f), settled);
});

test("exports no raw input, names, scope strings, URLs or secrets", () => {
	using f = fixture();
	const bytes = Buffer.from(sensitive);
	const op = f.store.bind(scope, "export", sensitive, bytes, hash(bytes));
	const stage = f.store.stage(scope, op.id);
	f.store.write(scope, stage, file());
	f.store.publish(scope, stage, [file()]);
	seedJob(f);
	const text = JSON.stringify(readEvidencePage(f.outbox, scope));
	for (const leak of [
		sensitive,
		"SYNTHETIC_PRIVATE_NAME",
		scope.tenant,
		scope.project,
		scopeKey(scope),
		"https://",
		"secret",
		"output.bin",
		"row-0",
	])
		assert.equal(text.includes(leak), false, leak);
	assert.deepEqual(
		Object.keys(readEvidencePage(f.outbox, scope).observations[0] ?? {}).sort(),
		[
			"billingMode",
			"code",
			"environment",
			"executionAttemptId",
			"jobId",
			"kind",
			"metrics",
			"observationId",
			"operationId",
			"producerBuildDigest",
			"publicationId",
			"recordedAtMs",
			"stagingVersion",
		],
	);
});

test("projects metrics explicitly so unexpected runtime fields never leak", () => {
	using f = fixture();
	seedJob(f);
	const real = f.outbox.list(scope);
	const leak = "https://private.invalid/?signature=secret";
	const injected = real.map((event) => ({
		...event,
		metrics: {
			outputBytes: { ...event.metrics.outputBytes, privateUrl: leak },
			duration: { ...event.metrics.duration, privateUrl: leak },
			rows: { ...event.metrics.rows, privateUrl: leak },
		},
	}));
	f.outbox.list = () => injected;
	const page = readEvidencePage(f.outbox, scope);
	const text = JSON.stringify(page);
	assert.equal(text.includes(leak), false);
	assert.equal(text.includes("privateUrl"), false);
	assert.equal(verifyEvidencePage(page), true);
	page.observations.forEach((o, i) => {
		const m = real[i]?.metrics;
		assert.ok(m);
		assert.deepEqual(o.metrics, m);
		for (const metric of Object.values(o.metrics))
			assert.deepEqual(Object.keys(metric), ["unit", "value", "completeness"]);
	});
});

test("canonicalization fails closed on non-JSON and malformed values", () => {
	const reject = (value: unknown) =>
		assert.throws(() => canonicalJson(value), invalid);
	reject(undefined);
	reject({ a: undefined });
	reject([undefined]);
	reject(Number.NaN);
	reject({ a: Number.POSITIVE_INFINITY });
	reject(() => 1);
	reject(Symbol("x"));
	reject(1n);
	reject(new Array(2));
	reject([1, , 3]);
	const extra = [1, 2];
	(extra as unknown as Record<string, unknown>)["x"] = 1;
	reject(extra);
	const cycle: Record<string, unknown> = {};
	cycle["self"] = cycle;
	reject(cycle);
	const arrayCycle: unknown[] = [];
	arrayCycle.push(arrayCycle);
	reject(arrayCycle);
	reject({
		get a() {
			return 1;
		},
	});
	reject({ [Symbol("k")]: 1 });
	reject(new Date(0));
	reject(new Map());
	reject(Object.defineProperty({}, "hidden", { value: 1, enumerable: false }));
	// shared (non-cyclic) references are fine and deterministic
	const shared = { v: 1 };
	assert.equal(
		canonicalJson({ b: shared, a: [shared] }),
		'{"a":[{"v":1}],"b":{"v":1}}',
	);
	assert.equal(canonicalJson(Object.create(null)), "{}");
});

test("verification returns false without throwing for malformed or mutated pages", () => {
	using f = fixture();
	seedJob(f);
	const page = readEvidencePage(f.outbox, scope);
	assert.ok(page.observations.length > 1);
	const sparse = new Array(page.observations.length);
	sparse[0] = page.observations[0];
	assert.equal(verifyEvidencePage({ ...page, observations: sparse }), false);
	const hole = [...page.observations];
	delete hole[1];
	assert.equal(verifyEvidencePage({ ...page, observations: hole }), false);
	assert.equal(
		verifyEvidencePage({ ...page, nextCursor: undefined as never }),
		false,
	);
	assert.equal(
		verifyEvidencePage({ ...page, after: Number.NaN } as never),
		false,
	);
	const cyclic = { ...page, observations: [] as unknown[] };
	cyclic.observations.push(cyclic);
	assert.equal(verifyEvidencePage(cyclic as never), false);
	assert.equal(
		verifyEvidencePage({ ...page, integrity: null as never }),
		false,
	);
	assert.equal(verifyEvidencePage(null as never), false);
	assert.throws(
		() => evidencePayloadDigest({ ...page, observations: sparse } as never),
		invalid,
	);
	assert.equal(verifyEvidencePage(page), true);
});

test("verification never invokes getters at the root or nested levels", () => {
	using f = fixture();
	seedJob(f);
	const page = readEvidencePage(f.outbox, scope);
	let calls = 0;
	const getter = (value: unknown) => ({
		enumerable: true,
		configurable: true,
		get: () => {
			calls++;
			return value;
		},
	});
	const rootAfter = Object.defineProperty({ ...page }, "after", getter(0));
	const integrityGetter = Object.defineProperty(
		{ ...page },
		"integrity",
		getter(page.integrity),
	);
	const nestedIntegrity = {
		...page,
		integrity: Object.defineProperty(
			{ ...page.integrity },
			"payloadDigest",
			getter(page.integrity.payloadDigest),
		),
	};
	const nestedObservation = {
		...page,
		observations: [
			Object.defineProperty({ ...page.observations[0] }, "sequence", getter(0)),
			...page.observations.slice(1),
		],
	};
	for (const malformed of [
		rootAfter,
		integrityGetter,
		nestedIntegrity,
		nestedObservation,
	])
		assert.equal(verifyEvidencePage(malformed as never), false);
	assert.equal(calls, 0);
	assert.equal(verifyEvidencePage(page), true);
});

test("verification preserves own __proto__ keys instead of dropping them", () => {
	using f = fixture();
	seedJob(f);
	const page = readEvidencePage(f.outbox, scope);
	for (const value of [null, 17]) {
		const forged = JSON.parse(
			JSON.stringify(page).replace(/^\{/, `{"__proto__":${value},`),
		);
		assert.equal(Object.hasOwn(forged, "__proto__"), true);
		assert.equal(forged.integrity.payloadDigest, page.integrity.payloadDigest);
		assert.equal(verifyEvidencePage(forged), false);
	}
	assert.equal(verifyEvidencePage(JSON.parse(JSON.stringify(page))), true);
	assert.equal(verifyEvidencePage(page), true);
});

test("exports no plain request or row-key digests and keeps generated IDs", () => {
	using f = fixture();
	seedJob(f);
	const page = readEvidencePage(f.outbox, scope);
	const source = f.outbox.list(scope);
	assert.ok(source.some((e) => e.row !== null));
	const text = JSON.stringify(page);
	for (const o of page.observations) {
		assert.equal("requestDigest" in o, false);
		assert.equal("rowKeyDigest" in o, false);
	}
	const plans = plan("batch", 2);
	const leaks = [
		plans.requestDigest,
		plans.pinsDigest,
		...plans.rows.map((r) => r.digest),
		...plans.rows.map((r) => hash(r.id)),
		...source.flatMap((e) => [e.request, ...(e.row ? [e.row] : [])]),
	];
	for (const leak of leaks) assert.equal(text.includes(leak), false, leak);
	page.observations.forEach((o, i) => {
		const e = source[i];
		assert.ok(e);
		assert.equal(o.observationId, e.id);
		assert.equal(o.operationId, e.operation);
		assert.equal(o.executionAttemptId, e.attempt);
		assert.equal(o.jobId, e.job);
		assert.equal(o.publicationId, e.publication);
	});
});

test("verification rejects forged fixed fields and key sets even with a recomputed digest", () => {
	using f = fixture();
	seedJob(f);
	const page = readEvidencePage(f.outbox, scope);
	const { integrity: _integrity, ...payload } = page;
	const reseal = (forged: Record<string, unknown>): EvidencePage => ({
		...(forged as Omit<EvidencePage, "integrity">),
		integrity: {
			...page.integrity,
			payloadDigest: evidencePayloadDigest(forged as never),
		},
	});
	const first = page.observations[0];
	assert.ok(first);
	assert.equal(verifyEvidencePage(reseal({ ...payload })), true);
	const forgeries: Record<string, unknown>[] = [
		{ ...payload, extra: 1 },
		{ ...payload, schema: "other" },
		{ ...payload, version: 1 },
		{ ...payload, provenance: { ...payload.provenance, authoritative: true } },
		{ ...payload, provenance: { ...payload.provenance, mapped: true } },
		{
			...payload,
			provenance: { ...payload.provenance, deliveryStatus: "delivered" },
		},
		{
			...payload,
			provenance: { ...payload.provenance, note: "approved receipt" },
		},
		{ ...payload, provenance: { ...payload.provenance, extra: true } },
		{ ...payload, scopeDigest: "abc" },
		{ ...payload, after: -1 },
		{ ...payload, limit: 0 },
		{ ...payload, nextCursor: "v1:nothex:1" },
		{ ...payload, nextCursor: `v1:${"0".repeat(64)}:1` },
		{ ...payload, nextCursor: "v2:x" },
		{ ...payload, observations: [{ ...first, environment: "production" }] },
		{ ...payload, observations: [{ ...first, billingMode: "billable" }] },
		{
			...payload,
			observations: [{ ...first, producerBuildDigest: "a".repeat(64) }],
		},
		{ ...payload, observations: [{ ...first, requestDigest: "a".repeat(64) }] },
		{ ...payload, observations: [{ ...first, providerRequestId: "x" }] },
		{ ...payload, observations: [{ ...first, observationId: "not-a-uuid" }] },
		{
			...payload,
			observations: [
				{
					...first,
					metrics: {
						...first.metrics,
						duration: {
							unit: "millisecond",
							value: 0,
							completeness: "unknown",
						},
					},
				},
			],
		},
	];
	for (const forged of forgeries)
		assert.equal(verifyEvidencePage(reseal(forged)), false);
	const { payloadDigest: _d, ...rest } = page.integrity;
	assert.equal(
		verifyEvidencePage({ ...payload, integrity: rest } as never),
		false,
	);
	assert.equal(
		verifyEvidencePage({
			...page,
			integrity: { ...page.integrity, extra: 1 },
		} as never),
		false,
	);
	assert.equal(
		verifyEvidencePage({
			...page,
			integrity: { ...page.integrity, algorithm: "md5" },
		} as never),
		false,
	);
});

test("v2 rejects v1 pages and persists immutable opaque cursor keys across migration and concurrent reopen", async () => {
	using f = fixture();
	seedJob(f);
	const first = readEvidencePage(f.outbox, scope, { limit: 1 });
	assert.ok(first.nextCursor);
	const smallOffset = f.outbox.createEvidenceCursor(scope, 1);
	const largeOffset = f.outbox.createEvidenceCursor(scope, 9_999_999_999);
	assert.equal(smallOffset.length, largeOffset.length);
	assert.notEqual(smallOffset, largeOffset);
	assert.equal(smallOffset, f.outbox.createEvidenceCursor(scope, 1));
	assert.notEqual(smallOffset, f.outbox.createEvidenceCursor(foreign, 1));
	for (const sequence of [
		-1,
		0.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.MAX_SAFE_INTEGER + 1,
	])
		assert.throws(
			() => f.outbox.createEvidenceCursor(scope, sequence),
			invalid,
		);
	assert.equal(
		f.outbox.evidenceCursorOffset(
			scope,
			f.outbox.createEvidenceCursor(scope, Number.MAX_SAFE_INTEGER),
		),
		Number.MAX_SAFE_INTEGER,
	);
	// A synthetic store owner can inspect the AEAD wire format. This key never
	// leaves the fixture; token holders cannot recover the scope or offset.
	const key = Buffer.from(
		f.db.sql.prepare("SELECT key FROM evidence_cursor_keys WHERE id=1").get()?.[
			"key"
		] as Uint8Array,
	);
	assert.equal(key.length, 32);
	const encryptionKey = createHmac("sha256", key)
		.update("pp-evidence-cursor-encryption-v2", "ascii")
		.digest();
	const nonceKey = createHmac("sha256", key)
		.update("pp-evidence-cursor-nonce-v2", "ascii")
		.digest();
	assert.notDeepEqual(encryptionKey, nonceKey);
	assert.notDeepEqual(encryptionKey, key);
	const wire = Buffer.from(smallOffset.slice(3), "base64url");
	const decrypt = (aad: string) => {
		const decipher = createDecipheriv(
			"aes-256-gcm",
			encryptionKey,
			wire.subarray(0, 16),
		);
		decipher.setAAD(Buffer.from(aad, "ascii"));
		decipher.setAuthTag(wire.subarray(56));
		return Buffer.concat([
			decipher.update(wire.subarray(16, 56)),
			decipher.final(),
		]);
	};
	const plaintext = decrypt("pp.telemetry.evidence-cursor.v2");
	assert.equal(plaintext.length, 40);
	assert.equal(plaintext.subarray(0, 32).toString("hex"), scopeKey(scope));
	assert.equal(plaintext.readBigUInt64BE(32), 1n);
	assert.throws(() => decrypt("pp.telemetry.evidence-cursor.v1"));
	const nonceSet = new Set<string>();
	for (let sequence = 0; sequence < 256; sequence++)
		nonceSet.add(
			Buffer.from(
				f.outbox.createEvidenceCursor(scope, sequence).slice(3),
				"base64url",
			)
				.subarray(0, 16)
				.toString("hex"),
		);
	assert.equal(nonceSet.size, 256);
	for (const sql of [
		"UPDATE evidence_cursor_keys SET key=? WHERE id=1",
		"INSERT OR REPLACE INTO evidence_cursor_keys(id,key) VALUES(1,?)",
		"REPLACE INTO evidence_cursor_keys(id,key) VALUES(1,?)",
		"INSERT INTO evidence_cursor_keys(id,key) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET key=excluded.key",
	])
		assert.throws(() => f.db.sql.prepare(sql).run(Buffer.alloc(32, 42)));
	assert.throws(() => f.db.sql.exec("DELETE FROM evidence_cursor_keys"));
	assert.deepEqual(
		Buffer.from(
			f.db.sql
				.prepare("SELECT key FROM evidence_cursor_keys WHERE id=1")
				.get()?.["key"] as Uint8Array,
		),
		key,
	);
	assert.equal(statSync(f.path).mode & 0o077, 0);
	const { integrity: _integrity, ...payload } = first;
	const legacyPayload = {
		...payload,
		version: 1,
		scopeDigest: scopeKey(scope),
		after: 0,
		nextCursor: `v1:${scopeKey(scope)}:1`,
		observations: first.observations.map((observation, index) => ({
			...observation,
			sequence: f.outbox.list(scope)[index]?.sequence ?? 0,
		})),
	};
	const legacy = {
		...legacyPayload,
		integrity: {
			algorithm: "sha256" as const,
			canonicalization: "json-sorted-keys-v1" as const,
			payloadDigest: evidencePayloadDigest(legacyPayload as never),
		},
	};
	assert.equal(verifyEvidencePage(legacy as never), false);
	assert.throws(
		() => readEvidencePage(f.outbox, scope, { cursor: legacy.nextCursor }),
		invalid,
	);

	const reopened = new DurabilityDatabase(f.path);
	try {
		const outbox = new ObservationOutbox(reopened);
		const resumed = readEvidencePage(outbox, scope, {
			cursor: first.nextCursor,
			limit: 1,
		});
		assert.equal(verifyEvidencePage(resumed), true);
		assert.notEqual(
			resumed.observations[0]?.observationId,
			first.observations[0]?.observationId,
		);
	} finally {
		reopened.close();
	}

	// Reopen a closed old-schema store with real staged observations. Dropping
	// only this additive table recreates the exact pre-cursor schema.
	const legacyStore = fixture();
	let legacyOpen = true;
	try {
		seedJob(legacyStore, "legacy");
		const history = legacyStore.outbox.list(scope);
		const settings = legacyStore.db.sql.prepare("SELECT * FROM settings").all();
		legacyStore.db.sql.exec("DROP TABLE evidence_cursor_keys");
		legacyStore.db.close();
		legacyOpen = false;
		let migratedPage: EvidencePage;
		{
			using migrated = new DurabilityDatabase(legacyStore.path);
			const migratedOutbox = new ObservationOutbox(migrated);
			assert.deepEqual(migratedOutbox.list(scope), history);
			assert.deepEqual(
				migrated.sql.prepare("SELECT * FROM settings").all(),
				settings,
			);
			migratedPage = readEvidencePage(migratedOutbox, scope, { limit: 1 });
			assert.ok(migratedPage.nextCursor);
		}
		using reopenedMigration = new DurabilityDatabase(legacyStore.path);
		const reopenedOutbox = new ObservationOutbox(reopenedMigration);
		assert.deepEqual(
			readEvidencePage(reopenedOutbox, scope, { limit: 1 }),
			migratedPage,
		);
		assert.ok(
			readEvidencePage(reopenedOutbox, scope, {
				cursor: migratedPage.nextCursor,
			}).observations.length > 0,
		);
	} finally {
		if (legacyOpen) legacyStore.db.close();
		rmSync(legacyStore.root, { recursive: true, force: true });
	}
	// The SQLite schema/WAL must already exist. Cold database creation has a
	// separate bootstrap race; here two first outboxes race to persist one key.
	const concurrentPath = join(f.root, "concurrent.sqlite");
	{
		using schemaOnly = new DurabilityDatabase(concurrentPath);
		assert.equal(
			schemaOnly.sql
				.prepare("SELECT COUNT(*) AS n FROM evidence_cursor_keys")
				.get()?.["n"],
			0,
		);
	}
	const script = `
		import { DurabilityDatabase } from ${JSON.stringify(new URL("../../src/internal/durability.js", import.meta.url).href)};
		import { ObservationOutbox } from ${JSON.stringify(new URL("../../src/telemetry/observations.js", import.meta.url).href)};
		using db = new DurabilityDatabase(${JSON.stringify(concurrentPath)});
		const outbox = new ObservationOutbox(db);
		console.log(outbox.createEvidenceCursor(${JSON.stringify(scope)}, 7));
	`;
	const run = promisify(execFile);
	const processes = await Promise.all(
		[1, 2].map(() =>
			run(process.execPath, ["--input-type=module", "-e", script], {
				timeout: 30000,
			}),
		),
	);
	assert.equal(processes[0]?.stdout, processes[1]?.stdout);
	using concurrent = new DurabilityDatabase(concurrentPath);
	assert.equal(
		concurrent.sql
			.prepare("SELECT COUNT(*) AS n FROM evidence_cursor_keys")
			.get()?.["n"],
		1,
	);
	assert.equal(
		new ObservationOutbox(concurrent).evidenceCursorOffset(
			scope,
			processes[0]?.stdout.trim() ?? null,
		),
		7,
	);
	using otherStore = fixture();
	seedJob(otherStore, "other-store");
	assert.throws(
		() =>
			readEvidencePage(otherStore.outbox, scope, {
				cursor: first.nextCursor,
			}),
		invalid,
	);
});
