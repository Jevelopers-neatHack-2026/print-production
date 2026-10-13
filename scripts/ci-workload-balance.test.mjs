import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { baselineFiles } from "./ci-workload-baseline.mjs";
import { fixtureWorkload } from "./ci-workload-fixture.mjs";
import {
	digest,
	groups,
	selectGroup,
	workloadPlan,
} from "./ci-workload-plan.mjs";

const exporter = "dist/tests/unit/exporter-conformance-controls.test.js";
const dispatcher = "dist/tests/unit/durability-dispatcher.test.js";
const future = "dist/tests/integration/new-pdf.test.js";

// All generated test bodies are synthetic scheduling fixtures, not renderer proof.
async function fixture(t) {
	const root = await fixtureWorkload();
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const path of [exporter, future]) {
		const code = "import {test} from 'node:test'; test('synthetic',()=>{});";
		await writeFile(join(root, path), code);
		const source = path.replace("dist/", "").replace(/js$/, "ts");
		await writeFile(join(root, source), code);
	}
	return root;
}

test("routes nested verifiers within the same three groups", async (t) => {
	const plan = await workloadPlan(await fixture(t));
	const group = (path) => plan.files.find((file) => file.path === path).group;
	assert.deepEqual(groups, ["cli", "private", "standalone"]);
	assert.equal(group(exporter), "private");
	assert.equal(group(dispatcher), "standalone");
	assert.equal(group(future), "standalone");
	assert.equal(
		group("dist/tests/integration/production-output-cli.test.js"),
		"cli",
	);
	assert.equal(
		group("dist/tests/unit/production-output-dispatcher.test.js"),
		"private",
	);
	assert.equal(
		group("dist/tests/unit/durability-independent-tests.test.js"),
		"private",
	);
});

test("preserves every file and hash after reassignment", async (t) => {
	const root = await fixture(t);
	const plan = await workloadPlan(root);
	const union = groups.flatMap((group) => selectGroup(plan, group));
	const expected = [...baselineFiles, exporter, future].sort();
	assert.deepEqual(union.map((file) => file.path).sort(), expected);
	assert.equal(new Set(union.map((file) => file.path)).size, expected.length);
	for (const file of union)
		assert.equal(file.digest, digest(await readFile(join(root, file.path))));
	const previous = plan.files.map((file) => {
		if (file.path === exporter) return { ...file, group: "standalone" };
		if (file.path === dispatcher) return { ...file, group: "private" };
		return file;
	});
	assert.notEqual(plan.unionDigest, digest(JSON.stringify(previous)));
	assert.deepEqual(await workloadPlan(root), plan);
	assert.ok(Object.isFrozen(plan.files) && plan.files.every(Object.isFrozen));
});

for (const path of [exporter, dispatcher]) {
	for (const fault of ["missing-source", "missing-compiled", "symlink"]) {
		test(`rejects ${fault} for reassigned ${path}`, async (t) => {
			const root = await fixture(t);
			const compiled = join(root, path);
			const source = join(root, path.replace("dist/", "").replace(/js$/, "ts"));
			if (fault === "missing-source") await rm(source);
			else {
				await rm(compiled);
				if (fault === "symlink") await symlink(source, compiled);
			}
			await assert.rejects(workloadPlan(root));
		});
	}
}

test("executes every synthetic file once through the rebalanced plan", {
	timeout: 120000,
}, async (t) => {
	const root = await fixture(t);
	const plan = await workloadPlan(root);
	const environment = Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) => !key.startsWith("NODE_TEST_"),
		),
	);
	assert.ok(!environment.NODE_OPTIONS);
	const counts = {
		tests: 0,
		pass: 0,
		fail: 0,
		cancelled: 0,
		skipped: 0,
		todo: 0,
	};
	for (const group of groups) {
		const { stdout } = await promisify(execFile)(
			process.execPath,
			[
				"--test",
				"--test-reporter=tap",
				"--test-concurrency=1",
				...selectGroup(plan, group).map((file) => file.path),
			],
			{
				cwd: root,
				env: environment,
				signal: t.signal,
				timeout: 60000,
				maxBuffer: 4 * 1024 * 1024,
			},
		);
		for (const key of Object.keys(counts)) {
			const pattern = new RegExp(`^# ${key} (\\d+)$`, "gm");
			const matches = [...stdout.matchAll(pattern)];
			assert.equal(matches.length, 1);
			counts[key] += Number(matches[0][1]);
		}
	}
	assert.deepEqual(counts, {
		tests: baselineFiles.length + 444 + 2,
		pass: baselineFiles.length + 444 + 2,
		fail: 0,
		cancelled: 0,
		skipped: 0,
		todo: 0,
	});
});
