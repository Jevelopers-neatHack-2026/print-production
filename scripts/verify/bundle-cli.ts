#!/usr/bin/env node
import { validatePrimitive } from "@jevelopers/shared-contracts";
import {
	CandidateFailure,
	checked,
	requireCandidate,
} from "../../src/api/canonical-values.js";
import { readBundleCommitment, verifyBundleDirectory } from "./bundle-input.js";

try {
	const args = process.argv.slice(2);
	const values = new Map<string, string>();
	for (let i = 0; i < args.length; i += 2) {
		const flag = args[i],
			value = args[i + 1];
		requireCandidate(
			flag !== undefined &&
				["--directory", "--commitment", "--tenant", "--project"].includes(
					flag,
				) &&
				value !== undefined &&
				!value.startsWith("--") &&
				!values.has(flag),
			"INVALID_INPUT",
		);
		values.set(flag, value);
	}
	requireCandidate(values.size === 4, "INVALID_INPUT");
	const scope = {
		tenant_id: checked(validatePrimitive("TenantId", values.get("--tenant"))),
		project_id: checked(
			validatePrimitive("ProjectId", values.get("--project")),
		),
	};
	const directory = values.get("--directory"),
		path = values.get("--commitment");
	requireCandidate(Boolean(directory) && Boolean(path), "INVALID_INPUT");
	const result = await verifyBundleDirectory(
		directory!,
		scope,
		await readBundleCommitment(path!),
	);
	process.stdout.write(
		`${JSON.stringify({ status: "verified", integrity: result.integrity, eligibility: result.eligibility, reasons: result.reasons, evidence_mode: result.evidence_mode, bundle_ref: { id: result.bundle.bundle_id, revision: result.bundle.bundle_version, content_hash: result.bundle.bundle_hash }, accepted: false, live_integration: false })}\n`,
	);
} catch (error) {
	process.stdout.write(
		`${JSON.stringify({ status: "failed", code: error instanceof CandidateFailure ? error.code : "INTEGRITY_FAILURE", accepted: false, live_integration: false })}\n`,
	);
	process.exitCode = 1;
}
