import { test } from "node:test";
import assert from "node:assert/strict";
import { CandidateRuntime } from "../../src/api/canonical-runtime.js";
import { ownerFixture } from "../fixtures/canonical-production/owner.js";
import {
	productionReferences,
	validateProductionResult,
} from "@jevelopers/shared-contracts/production-operations";
import type { ProductionRequestMap } from "@jevelopers/shared-contracts/production-operations";

// Isolate entry validation from rendering/storage. This is not a host acceptance fixture.
async function boundary(access = async () => true) {
	const pins = await ownerFixture("ProductionExecutionPins");
	const runtime: CandidateRuntime = Object.create(CandidateRuntime.prototype);
	Object.assign(runtime, {
		context: {
			scope: { tenant_id: pins.tenant_id, project_id: pins.project_id },
			authority: { actor_id: "synthetic-actor", audience: "print-production" },
			policy_version: "1.0.0",
			runtime: pins,
			environment: "test",
			clock: { now: () => "2026-10-10T12:05:00.000Z" },
		},
		host: { access },
		state: {
			expectations: (value: unknown) =>
				Object.fromEntries(productionReferences(value)),
			reconcile: () => {},
			put: () => {
				throw new Error("diagnostic storage unavailable");
			},
		},
	});
	return runtime;
}

for (const operation of [
	"composeArtifact",
	"personalizeArtifactBatch",
	"inspectArtifact",
	"exportArtifactBundle",
	"compareTemplateCompatibility",
	"getArtifactManifestStatus",
] as const) {
	test(`${operation} contains a throwing correlation getter without invoking it`, async () => {
		const runtime = await boundary();
		let calls = 0;
		const request = {
			get correlation_id() {
				calls++;
				throw new Error("private sentinel");
			},
		};
		const result = await runtime.entry(
			{
				context: runtime.context,
				operation,
				request: request as unknown as ProductionRequestMap[typeof operation],
			},
			async () => {
				assert.fail("invalid request reached work");
			},
		);
		assert.ok(!result.ok);
		assert.equal(result.error.code, "INVALID_INPUT");
		assert.equal(result.error.side_effects, "none");
		assert.equal(calls, 0);
		assert.ok(
			validateProductionResult(operation, result, runtime.context.scope).ok,
		);
		assert.ok(!JSON.stringify(result).includes("private sentinel"));
	});
}

test("revoked request proxies cannot escape the error boundary", async () => {
	const runtime = await boundary();
	const proxy = Proxy.revocable({}, {});
	proxy.revoke();
	const result = await runtime.entry(
		{
			context: runtime.context,
			operation: "inspectArtifact",
			request: proxy.proxy as ProductionRequestMap["inspectArtifact"],
		},
		async () => {
			assert.fail("invalid request reached work");
		},
	);
	assert.ok(!result.ok);
	assert.ok(
		validateProductionResult("inspectArtifact", result, runtime.context.scope)
			.ok,
	);
});

test("access awaits cannot replace the validated request or its nested references", async () => {
	const request = await ownerFixture("CompareTemplateRequest");
	const original = structuredClone(request);
	const runtime = await boundary(async () => {
		Object.assign(request.target_template_ref, {
			id: "123e4567-e89b-42d3-a456-000000000999",
		});
		Object.defineProperty(request, "correlation_id", {
			get() {
				throw new Error("late getter");
			},
		});
		return true;
	});
	const result = await runtime.entry(
		{
			context: runtime.context,
			operation: "compareTemplateCompatibility",
			request,
		},
		async (parsed) => {
			assert.deepEqual(parsed, original);
			return "observed-original";
		},
	);
	assert.deepEqual(result, { ok: true, value: "observed-original" });
});

test("work failures retain the original correlation after caller mutation", async () => {
	const request = await ownerFixture("CompareTemplateRequest");
	const correlation = request.correlation_id;
	const runtime = await boundary(async () => {
		Object.defineProperty(request, "correlation_id", {
			get() {
				throw new Error("late getter");
			},
		});
		return true;
	});
	const result = await runtime.entry(
		{
			context: runtime.context,
			operation: "compareTemplateCompatibility",
			request,
		},
		async () => {
			throw new Error("private work failure");
		},
	);
	assert.ok(!result.ok);
	assert.equal(result.error.diagnostic_ref.state, "unavailable");
	if (result.error.diagnostic_ref.state === "unavailable")
		assert.equal(result.error.diagnostic_ref.correlation_id, correlation);
	assert.ok(
		validateProductionResult(
			"compareTemplateCompatibility",
			result,
			runtime.context.scope,
		).ok,
	);
});
