import { test } from "node:test";
import assert from "node:assert/strict";
import {
	mkdtemp,
	writeFile,
	symlink,
	rm,
	mkdir,
	readFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { safeProductionFilename } from "@jevelopers/shared-contracts/production-operations";
import { readResource } from "../../src/runtime/resources.js";
import {
	readBoundedRegularFile,
	readBundleCommitment,
	verifyBundleDirectory,
} from "../../scripts/verify/bundle-input.js";
import { ownerFixture } from "../fixtures/canonical-production/owner.js";

async function temporary(run: (root: string) => Promise<void>) {
	const root = await mkdtemp(join(tmpdir(), "pp-readonly-bundle-"));
	try {
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("CLI verifies a synthetic valid bundle while keeping eligibility blocked", async () =>
	temporary(async (root) => {
		// Use the unchanged 0.9.7 owner's synthetic byte fixture, not a renderer
		// or a stubbed verifier. Its commitment supplies no external authority.
		const fixture = z
			.object({
				accepted: z.literal(false),
				live_integration: z.literal(false),
				cases: z.array(
					z.object({ id: z.string(), context: z.unknown().optional() }),
				),
			})
			.parse(
				JSON.parse(
					(
						await readResource(
							"node_modules/@jevelopers/shared-contracts/fixtures/ProductionBundleRef.json",
						)
					).toString(),
				),
			);
		const context = z
			.object({
				scope: z.object({
					tenant_id: z.string().uuid(),
					project_id: z.string().uuid(),
				}),
				byte_files: z.record(z.string(), z.string()),
				trusted_commitment: z.unknown(),
			})
			.parse(
				fixture.cases.find((c) => c.id === "production-independent-bindings")
					?.context,
			);
		const directory = join(root, "bundle"),
			commitmentPath = join(root, "publication.json");
		await mkdir(directory);
		const original = new Map<string, Buffer>();
		for (const [filename, encoded] of Object.entries(context.byte_files)) {
			assert.ok(safeProductionFilename(filename));
			const bytes = Buffer.from(encoded, "base64"),
				path = join(directory, filename);
			await writeFile(path, bytes);
			original.set(path, bytes);
		}
		assert.equal(original.size, 9);
		const commitmentBytes = Buffer.from(
			JSON.stringify(context.trusted_commitment),
		);
		await writeFile(commitmentPath, commitmentBytes);
		original.set(commitmentPath, commitmentBytes);
		const commitment = await readBundleCommitment(commitmentPath);
		const cli = fileURLToPath(
			new URL("../../scripts/verify/bundle-cli.js", import.meta.url),
		);
		const { stdout, stderr } = await promisify(execFile)(process.execPath, [
			cli,
			"--directory",
			directory,
			"--commitment",
			commitmentPath,
			"--tenant",
			context.scope.tenant_id,
			"--project",
			context.scope.project_id,
		]);
		assert.equal(stderr, "");
		const receipt = JSON.parse(stdout);
		assert.equal(receipt.status, "verified");
		assert.equal(receipt.integrity, "passed");
		assert.equal(receipt.eligibility, "blocked");
		assert.equal(receipt.accepted, false);
		assert.equal(receipt.live_integration, false);
		assert.equal(receipt.evidence_mode, "byte_verification_only");
		assert.deepEqual(receipt.reasons, ["OWNER_ACCEPTANCE_PENDING"]);
		assert.deepEqual(receipt.bundle_ref, {
			id: commitment.bundle_ref.id,
			revision: commitment.bundle_ref.revision,
			content_hash: commitment.bundle_ref.content_hash,
		});
		for (const [path, bytes] of original)
			assert.deepEqual(await readFile(path), bytes);
	}));

test("CLI rejects incomplete, duplicate and unknown arguments with safe typed output", async () => {
	const cli = fileURLToPath(
		new URL("../../scripts/verify/bundle-cli.js", import.meta.url),
	);
	for (const args of [
		[],
		["--directory", "/private/sentinel", "--directory", "again"],
		["--unknown", "/private/sentinel"],
	]) {
		try {
			await promisify(execFile)(process.execPath, [cli, ...args]);
			assert.fail("invalid arguments succeeded");
		} catch (error) {
			assert.ok(
				error instanceof Error &&
					"stdout" in error &&
					"stderr" in error &&
					"code" in error,
			);
			assert.equal(error.code, 1);
			assert.equal(error.stderr, "");
			assert.deepEqual(JSON.parse(String(error.stdout)), {
				status: "failed",
				code: "INVALID_INPUT",
				accepted: false,
				live_integration: false,
			});
		}
	}
});
test("bounded reads preserve exact bytes and reject oversized files and links", async () =>
	temporary(async (root) => {
		const path = join(root, "bytes");
		await writeFile(path, "unchanged");
		assert.equal(
			(await readBoundedRegularFile(path, 9)).toString(),
			"unchanged",
		);
		await assert.rejects(readBoundedRegularFile(path, 8));
		const link = join(root, "link");
		await symlink(path, link);
		await assert.rejects(readBoundedRegularFile(link, 9));
		await assert.rejects(readBoundedRegularFile(root, 9));
		assert.equal((await readFile(path)).toString(), "unchanged");
	}));
test("commitments use canonical owner schema parsing including duplicate rejection", async () =>
	temporary(async (root) => {
		const commitment = await ownerFixture("ProductionBundleRef");
		const path = join(root, "trust.json"),
			text = JSON.stringify(commitment);
		await writeFile(path, text);
		assert.deepEqual(await readBundleCommitment(path), commitment);
		await writeFile(
			path,
			text.replace(/^\{/, '{"contract":"ProductionBundleRef",'),
		);
		await assert.rejects(readBundleCommitment(path));
		await writeFile(path, Buffer.from([0xff]));
		await assert.rejects(readBundleCommitment(path));
	}));
for (const kind of ["missing", "extra", "directory", "symlink"] as const)
	test(`read-only verification rejects ${kind} inventory without altering inputs`, async () =>
		temporary(async (root) => {
			const commitment = await ownerFixture("ProductionBundleRef");
			const pins = await ownerFixture("ProductionExecutionPins");
			const scope = { tenant_id: pins.tenant_id, project_id: pins.project_id };
			if (kind === "extra")
				await writeFile(join(root, "extra.txt"), "unchanged");
			if (kind === "directory") await mkdir(join(root, "nested"));
			if (kind === "symlink") await symlink(root, join(root, "linked"));
			await assert.rejects(verifyBundleDirectory(root, scope, commitment));
			if (kind === "extra")
				assert.equal(
					(await readFile(join(root, "extra.txt"))).toString(),
					"unchanged",
				);
		}));
