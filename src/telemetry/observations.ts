import { z } from "zod";
import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	randomBytes,
} from "node:crypto";
import {
	check,
	codes,
	parse,
	idSchema,
	digestSchema,
	newId,
	scopeKey,
	DurabilityError,
	type DurabilityDatabase,
	type Id,
	type Scope,
	type Code,
} from "../internal/durability.js";

export const observationKinds = [
	"planned",
	"execution_started",
	"succeeded",
	"failed",
	"retryable",
	"interrupted",
	"cancelled",
	"partially_succeeded",
	"published",
] as const;
export type ObservationKind = (typeof observationKinds)[number];
const observationSchema = z
	.object({
		sequence: z.number(),
		id: idSchema,
		operation: idSchema,
		attempt: idSchema.nullable(),
		kind: z.enum(observationKinds),
		code: z.enum(codes).nullable(),
		publication: idSchema.nullable(),
		bytes: z.number().nullable(),
		duration_ms: z.number().nullable(),
		recorded: z.number(),
	})
	.readonly();
const joinsSchema = z
	.object({
		scope: digestSchema,
		request: digestSchema,
		job: idSchema.nullable(),
		row: digestSchema.nullable(),
		row_count: z.number().nullable(),
	})
	.readonly();
type Measurement<U extends string> = {
	readonly unit: U;
	readonly value: number | null;
	readonly completeness: "measured" | "unknown";
};
export type Observation = z.infer<typeof observationSchema> &
	z.infer<typeof joinsSchema> & {
		readonly stagingVersion: 1;
		readonly environment: "local";
		readonly billingMode: "unclassified";
		readonly producerBuildDigest: null;
		readonly metrics: {
			readonly outputBytes: Measurement<"byte">;
			readonly duration: Measurement<"millisecond">;
			readonly rows: Measurement<"row">;
		};
	};
export type Measurements = {
	readonly bytes?: number;
	readonly durationMs?: number;
};

export function eventCapacity(db: DurabilityDatabase): number {
	db.requireTransaction();
	const count = db.sql
		.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status!='delivered'")
		.get();
	check(typeof count?.["n"] === "number", "INTEGRITY");
	return db.limits.maxPendingEvents - count["n"];
}

export function observe(
	db: DurabilityDatabase,
	operation: Id,
	kind: ObservationKind,
	attempt: Id | null = null,
	code: Code | null = null,
	publication: Id | null = null,
	measurements: Measurements = {},
): Id {
	db.requireTransaction();
	check(eventCapacity(db) > 0, "LIMIT");
	const id = newId();
	db.sql
		.prepare(
			"INSERT INTO observations(id,operation,attempt,kind,code,publication,bytes,duration_ms,recorded) VALUES(?,?,?,?,?,?,?,?,?)",
		)
		.run(
			id,
			operation,
			attempt,
			kind,
			code,
			publication,
			measurements.bytes ?? null,
			measurements.durationMs ?? null,
			db.now(),
		);
	db.sql.prepare("INSERT INTO outbox(event) VALUES(?)").run(id);
	return id;
}

const deliverySchema = z.object({
	event: idSchema,
	fence: z.number().int(),
	attempts: z.number().int(),
});
export type DeliveryClaim = {
	readonly event: Observation;
	readonly fence: number;
	readonly transport: Id;
	readonly number: number;
};
export class ObservationOutbox {
	private readonly cursorKey: Buffer;
	constructor(private readonly db: DurabilityDatabase) {
		this.cursorKey = this.db.transaction(() => {
			const stored = this.db.sql
				.prepare("SELECT key FROM evidence_cursor_keys WHERE id=1")
				.get();
			if (stored) {
				const key = stored["key"];
				check(key instanceof Uint8Array && key.byteLength === 32, "INTEGRITY");
				return Buffer.from(key);
			}
			const key = randomBytes(32);
			this.db.sql
				.prepare("INSERT INTO evidence_cursor_keys(id,key) VALUES(1,?)")
				.run(key);
			return key;
		});
	}
	/**
	 * Build a deterministic, encrypted cursor scoped to this private store and
	 * caller scope. The sequence and unkeyed scope digest stay out of the token.
	 * This is a trusted in-process minting API, not a caller authorization gate.
	 */
	createEvidenceCursor(scope: Scope, sequence: number): string {
		check(Number.isSafeInteger(sequence) && sequence >= 0, "INVALID_INPUT");
		const plain = Buffer.alloc(40);
		Buffer.from(scopeKey(scope), "hex").copy(plain, 0);
		plain.writeBigUInt64BE(BigInt(sequence), 32);
		const encryptionKey = createHmac("sha256", this.cursorKey)
			.update("pp-evidence-cursor-encryption-v2", "ascii")
			.digest();
		const nonceKey = createHmac("sha256", this.cursorKey)
			.update("pp-evidence-cursor-nonce-v2", "ascii")
			.digest();
		// Separate PRF keys keep encryption and deterministic nonce derivation
		// independent. A repeated plaintext repeats the entire token; distinct
		// plaintexts have the birthday collision bound of a 128-bit nonce.
		const nonce = createHmac("sha256", nonceKey)
			.update(plain)
			.digest()
			.subarray(0, 16);
		const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
		cipher.setAAD(Buffer.from("pp.telemetry.evidence-cursor.v2", "ascii"));
		const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
		return `v2:${Buffer.concat([nonce, encrypted, cipher.getAuthTag()]).toString("base64url")}`;
	}
	/**
	 * Decode only cursors issued by this private store for this caller scope.
	 * Invalid, legacy, cross-store and cross-scope tokens share one failure.
	 */
	evidenceCursorOffset(scope: Scope, cursor: string | null): number {
		if (cursor === null) return 0;
		try {
			check(
				typeof cursor === "string" && /^v2:[A-Za-z0-9_-]{96}$/.test(cursor),
				"INVALID_INPUT",
			);
			const encoded = cursor.slice(3);
			const bytes = Buffer.from(encoded, "base64url");
			check(bytes.toString("base64url") === encoded, "INVALID_INPUT");
			check(bytes.length === 72, "INVALID_INPUT");
			const encryptionKey = createHmac("sha256", this.cursorKey)
				.update("pp-evidence-cursor-encryption-v2", "ascii")
				.digest();
			const nonce = bytes.subarray(0, 16);
			const tag = bytes.subarray(bytes.length - 16);
			const decipher = createDecipheriv("aes-256-gcm", encryptionKey, nonce);
			decipher.setAAD(Buffer.from("pp.telemetry.evidence-cursor.v2", "ascii"));
			decipher.setAuthTag(tag);
			const plain = Buffer.concat([
				decipher.update(bytes.subarray(16, bytes.length - 16)),
				decipher.final(),
			]);
			check(
				plain.length === 40 &&
					plain.subarray(0, 32).toString("hex") === scopeKey(scope),
				"INVALID_INPUT",
			);
			const sequence = Number(plain.readBigUInt64BE(32));
			check(Number.isSafeInteger(sequence), "INVALID_INPUT");
			return sequence;
		} catch {
			throw new DurabilityError("INVALID_INPUT");
		}
	}
	private event(row: unknown): Observation {
		const event = parse(observationSchema, row);
		const joins = parse(
			joinsSchema,
			this.db.sql
				.prepare(
					"SELECT o.scope,o.request,COALESCE(r.job,j.id) AS job,r.row_key AS row,CASE WHEN r.job IS NOT NULL THEN 1 WHEN j.id IS NOT NULL THEN (SELECT COUNT(*) FROM rows WHERE job=j.id) ELSE NULL END AS row_count FROM operations o LEFT JOIN rows r ON r.operation=o.id LEFT JOIN jobs j ON j.operation=o.id WHERE o.id=?",
				)
				.get(event.operation),
		);
		return {
			...event,
			...joins,
			stagingVersion: 1,
			environment: "local",
			billingMode: "unclassified",
			producerBuildDigest: null,
			metrics: {
				outputBytes: {
					unit: "byte",
					value: event.bytes,
					completeness: event.bytes === null ? "unknown" : "measured",
				},
				duration: {
					unit: "millisecond",
					value: event.duration_ms,
					completeness: event.duration_ms === null ? "unknown" : "measured",
				},
				rows: {
					unit: "row",
					value: joins.row_count,
					completeness: joins.row_count === null ? "unknown" : "measured",
				},
			},
		};
	}
	list(
		scope: Scope,
		after = 0,
		limit = this.db.limits.pageSize,
	): readonly Observation[] {
		check(
			Number.isSafeInteger(after) &&
				after >= 0 &&
				Number.isSafeInteger(limit) &&
				limit > 0 &&
				limit <= this.db.limits.pageSize,
			"LIMIT",
		);
		return this.db.sql
			.prepare(
				"SELECT e.* FROM observations e JOIN operations o ON o.id=e.operation WHERE o.scope=? AND e.sequence>? ORDER BY e.sequence LIMIT ?",
			)
			.all(scopeKey(scope), after, limit)
			.map((row) => this.event(row));
	}
	claim(): DeliveryClaim | null {
		return this.db.transaction(() => {
			const now = this.db.now();
			this.db.sql
				.prepare(
					"UPDATE outbox SET status='exhausted',lease=NULL WHERE status='sending' AND lease<=? AND attempts>=?",
				)
				.run(now, this.db.limits.maxDeliveryAttempts);
			const active = this.db.sql
				.prepare(
					"SELECT COUNT(*) AS n FROM outbox WHERE status='sending' AND lease>?",
				)
				.get(now);
			check(typeof active?.["n"] === "number", "INTEGRITY");
			if (active["n"] >= this.db.limits.concurrency) return null;
			const row = this.db.sql
				.prepare(
					"SELECT event,fence,attempts FROM outbox WHERE ((status='pending' AND due<=?) OR (status='sending' AND lease<=?)) AND attempts<? ORDER BY rowid LIMIT 1",
				)
				.get(now, now, this.db.limits.maxDeliveryAttempts);
			if (!row) return null;
			const item = parse(deliverySchema, row);
			const fence = item.fence + 1;
			this.db.sql
				.prepare(
					"UPDATE outbox SET status='sending',fence=?,attempts=attempts+1,lease=? WHERE event=?",
				)
				.run(fence, now + this.db.limits.leaseMs, item.event);
			const transport = newId();
			this.db.sql
				.prepare("INSERT INTO transports(id,event,fence) VALUES(?,?,?)")
				.run(transport, item.event, fence);
			const event = this.event(
				this.db.sql
					.prepare("SELECT * FROM observations WHERE id=?")
					.get(item.event),
			);
			return { event, fence, transport, number: item.attempts + 1 };
		});
	}
	settle(claim: DeliveryClaim, accepted: boolean): void {
		this.db.transaction(() => {
			const now = this.db.now();
			const row = this.db.sql
				.prepare(
					"SELECT attempts FROM outbox WHERE event=? AND fence=? AND status='sending' AND lease>?",
				)
				.get(claim.event.id, claim.fence, now);
			check(row !== undefined, "STALE_CLAIM");
			check(
				this.db.sql
					.prepare(
						"SELECT id FROM transports WHERE id=? AND event=? AND fence=? AND outcome='uncertain'",
					)
					.get(claim.transport, claim.event.id, claim.fence) !== undefined,
				"STALE_CLAIM",
			);
			const attempts = parse(z.number(), row["attempts"]);
			const status = accepted
				? "delivered"
				: attempts >= this.db.limits.maxDeliveryAttempts
					? "exhausted"
					: "pending";
			this.db.sql
				.prepare("UPDATE outbox SET status=?,lease=NULL,due=? WHERE event=?")
				.run(
					status,
					now + this.db.limits.backoffMs * 2 ** (attempts - 1),
					claim.event.id,
				);
			this.db.sql
				.prepare(
					"UPDATE transports SET outcome=? WHERE id=? AND event=? AND fence=?",
				)
				.run(
					accepted ? "accepted" : "retryable",
					claim.transport,
					claim.event.id,
					claim.fence,
				);
		});
	}
	requeue(event: Id): void {
		this.db.transaction(() => {
			const result = this.db.sql
				.prepare(
					"UPDATE outbox SET status='pending',attempts=0,due=0,fence=fence+1 WHERE event=? AND status='exhausted'",
				)
				.run(event);
			check(result.changes === 1, "STALE_CLAIM");
		});
	}
	async deliverOne(
		sink: (
			event: Observation,
			transport: Id,
			signal: AbortSignal,
		) => Promise<void>,
		signal: AbortSignal,
	): Promise<boolean> {
		if (signal.aborted) return false;
		const claim = this.claim();
		if (!claim) return false;
		const deadline = AbortSignal.any([
			signal,
			AbortSignal.timeout(this.db.limits.leaseMs),
		]);
		try {
			await new Promise<void>((resolve, reject) => {
				const abort = () => reject(new DurabilityError("CANCELLED"));
				deadline.addEventListener("abort", abort, { once: true });
				if (deadline.aborted) abort();
				else
					Promise.resolve()
						.then(() => sink(claim.event, claim.transport, deadline))
						.then(
							() => {
								deadline.removeEventListener("abort", abort);
								resolve();
							},
							(error) => {
								deadline.removeEventListener("abort", abort);
								reject(error);
							},
						);
			});
		} catch (error) {
			if (error instanceof Error) {
				this.settle(claim, false);
				return true;
			}
			this.settle(claim, false);
			throw new DurabilityError("STORAGE");
		}
		this.settle(claim, true);
		return true;
	}
}
