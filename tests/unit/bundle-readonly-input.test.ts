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
