import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { join } from "node:path";
import { parseContractVersion } from "@jevelopers/shared-contracts";
import type { ProductionBundleRef } from "@jevelopers/shared-contracts";
import {
	productionArchiveLimits as limits,
	safeProductionFilename,
	verifyProductionBundleFiles,
} from "@jevelopers/shared-contracts/production-operations";
import type { ProductionScope } from "@jevelopers/shared-contracts/production-operations";
import { checked, requireCandidate } from "../../src/api/canonical-values.js";

export async function readBoundedRegularFile(path: string, maximum: number) {
	const file = await open(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const stat = await file.stat();
		requireCandidate(
			stat.isFile() && stat.size <= maximum,
			"INTEGRITY_FAILURE",
		);
		// One extra byte detects growth without an unbounded readFile allocation.
		const bytes = Buffer.alloc(stat.size + 1);
		let length = 0;
		while (length < bytes.length) {
			const read = await file.read(
				bytes,
				length,
				bytes.length - length,
				length,
			);
			if (read.bytesRead === 0) break;
			length += read.bytesRead;
		}
		requireCandidate(length === stat.size, "INTEGRITY_FAILURE");
		return bytes.subarray(0, length);
	} finally {
		await file.close();
	}
}

export async function readBundleCommitment(
	path: string,
): Promise<ProductionBundleRef> {
	const bytes = await readBoundedRegularFile(path, limits.manifest_bytes);
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	return checked(parseContractVersion("ProductionBundleRef", "1.0.0", text));
}

/** Checks retained bytes only. The caller must independently authenticate the commitment/scope. */
export async function verifyBundleDirectory(
	directory: string,
	scope: ProductionScope,
	commitment: ProductionBundleRef,
) {
	requireCandidate((await lstat(directory)).isDirectory(), "INTEGRITY_FAILURE");
	const files: { filename: string; bytes: Buffer }[] = [];
	let total = 0;
	const maximumTotal =
		limits.payload_bytes +
		limits.archive_bytes +
		limits.manifest_bytes +
		limits.detached_bytes;
	const entries = await opendir(directory);
	for await (const entry of entries) {
		requireCandidate(
			files.length < limits.outer_descriptors &&
				entry.isFile() &&
				safeProductionFilename(entry.name),
			"INTEGRITY_FAILURE",
		);
		const maximum =
			entry.name === "archive.zip"
				? limits.archive_bytes
				: entry.name === "manifest.json"
					? limits.manifest_bytes
					: entry.name === "detached.json"
						? limits.detached_bytes
						: limits.entry_bytes;
		const bytes = await readBoundedRegularFile(
			join(directory, entry.name),
			maximum,
		);
		total += bytes.length;
		requireCandidate(total <= maximumTotal, "INTEGRITY_FAILURE");
		files.push({ filename: entry.name, bytes });
	}
	return checked(
		verifyProductionBundleFiles(files, {
			scope,
			trusted_commitment: commitment,
		}),
		"INTEGRITY_FAILURE",
	);
}
