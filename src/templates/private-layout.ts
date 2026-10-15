import { z } from "zod";
import {
	colorSchema,
	contains,
	fingerprint,
	parse,
	positiveSchema,
	rectSchema,
	refSchema,
	requireCore,
	revisionSchema,
} from "../composition/primitives.js";
import type { Digest } from "../composition/primitives.js";

const slotSchema = z
	.object({
		id: refSchema,
		kind: z.enum(["artwork", "text", "overlay", "shape", "guide"]),
		bounds: rectSchema,
		required: z.boolean(),
		minFontMm: positiveSchema,
		maxFontMm: positiveSchema,
		allowedFonts: z.array(refSchema).max(16).readonly(),
		allowCrop: z.boolean(),
		maxRotation: z.number().min(0).max(180),
		fits: z
			.array(z.enum(["contain", "cover", "exact"]))
			.min(1)
			.readonly(),
	})
	.strict()
	.readonly();
export const layoutSchema = z
	.object({
		privateVersion: z.literal(1),
		id: refSchema,
		revision: revisionSchema,
		productRef: refSchema,
		policyRevision: revisionSchema,
		units: z.literal("mm"),
		origin: z.literal("top-left"),
		width: positiveSchema,
		height: positiveSchema,
		orientation: z.enum(["portrait", "landscape", "square"]),
		trim: rectSchema,
		bleed: rectSchema,
		safe: rectSchema,
		minDpi: z.number().positive().max(2400),
		profile: z.enum(["srgb", "icc", "cmyk", "pdf-x"]),
		transparency: z.enum(["allow", "forbid"]),
		exports: z
			.array(z.enum(["svg", "png", "pdf"]))
			.min(1)
			.readonly(),
		fonts: z.array(refSchema).min(1).max(16).readonly(),
		slots: z.array(slotSchema).min(1).max(256).readonly(),
		background: colorSchema,
		includeProofGuides: z.boolean(),
		allowedWarnings: z.array(refSchema).max(64).readonly(),
	})
	.strict()
	.readonly();
export type PrivateLayout = z.infer<typeof layoutSchema>;
export function resolveLayout(value: unknown): PrivateLayout {
	const layout = parse(layoutSchema, value);
	const page = { x: 0, y: 0, width: layout.width, height: layout.height };
	requireCore(
		contains(page, layout.bleed) &&
			contains(layout.bleed, layout.trim) &&
			contains(layout.trim, layout.safe),
		"INVALID_GEOMETRY",
		"layout.rectangles",
	);
	requireCore(
		layout.orientation ===
			(layout.width === layout.height
				? "square"
				: layout.width > layout.height
					? "landscape"
					: "portrait"),
		"INVALID_GEOMETRY",
		"layout.orientation",
	);
	requireCore(
		new Set(layout.slots.map((s) => s.id)).size === layout.slots.length &&
			new Set(layout.fonts).size === layout.fonts.length &&
			new Set(layout.exports).size === layout.exports.length,
		"INVALID_INPUT",
		"layout.duplicates",
	);
	for (const slot of layout.slots)
		requireCore(
			contains(page, slot.bounds) &&
				slot.minFontMm <= slot.maxFontMm &&
				slot.allowedFonts.every((f) => layout.fonts.includes(f)) &&
				(slot.kind !== "text" || slot.allowedFonts.length > 0),
			"INVALID_GEOMETRY",
			`slots.${slot.id}`,
		);
	return layout;
}
export class PrivateLayoutRegistry {
	readonly revisions: readonly {
		readonly layout: PrivateLayout;
		readonly hash: Digest;
	}[];
	constructor(values: readonly unknown[]) {
		this.revisions = Object.freeze(
			values.map((value) => {
				const layout = resolveLayout(value);
				return Object.freeze({ layout, hash: fingerprint(layout) });
			}),
		);
		requireCore(
			new Set(this.revisions.map((r) => `${r.layout.id}/${r.layout.revision}`))
				.size === values.length,
			"REVISION_CONFLICT",
			"registry",
		);
	}
}

// Resolved private constraints supplied by the future canonical adapter; this is not a supplier catalog.
export const constraintsSchema = z
	.object({
		specRef: refSchema,
		revision: revisionSchema,
		sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
		productRef: refSchema,
		width: positiveSchema,
		height: positiveSchema,
		bleed: rectSchema,
		safe: rectSchema,
		minDpi: z.number().positive(),
		profiles: z.array(z.enum(["srgb", "icc", "cmyk", "pdf-x"])).readonly(),
		exports: z.array(z.enum(["svg", "png", "pdf"])).readonly(),
		fonts: z.array(refSchema).readonly(),
		transparency: z.enum(["allow", "forbid"]),
		requiredChecks: z
			.array(z.enum(["dimensions", "content", "fonts", "container", "profile"]))
			.min(1)
			.readonly(),
	})
	.strict()
	.readonly();
export type ResolvedConstraints = z.infer<typeof constraintsSchema>;
export function resolveConstraints(value: unknown): ResolvedConstraints {
	const resolved = parse(constraintsSchema, value);
	requireCore(
		contains(
			{ x: 0, y: 0, width: resolved.width, height: resolved.height },
			resolved.bleed,
		) && contains(resolved.bleed, resolved.safe),
		"INVALID_GEOMETRY",
		"constraints.rectangles",
	);
	return resolved;
}
export function compareTemplateCompatibility(
	source: PrivateLayout,
	target: PrivateLayout,
	constraints: ResolvedConstraints | null,
) {
	const changed = fingerprint(source) !== fingerprint(target);
	const reasons: string[] = [];
	if (!constraints)
		return Object.freeze({
			state: "unknown" as const,
			reasons: ["SPEC_UNKNOWN"],
			relayout: changed,
			reapproval: changed,
		});
	if (target.productRef !== constraints.productRef)
		reasons.push("PRODUCT_MISMATCH");
	if (
		target.width !== constraints.width ||
		target.height !== constraints.height
	)
		reasons.push("DIMENSIONS_MISMATCH");
	if (fingerprint(target.bleed) !== fingerprint(constraints.bleed))
		reasons.push("BLEED_MISMATCH");
	if (!contains(constraints.safe, target.safe)) reasons.push("SAFE_MISMATCH");
	if (target.minDpi < constraints.minDpi) reasons.push("DPI_MISMATCH");
	if (
		!constraints.profiles.includes(target.profile) ||
		target.profile !== "srgb"
	)
		reasons.push("PROFILE_UNSUPPORTED");
	if (!target.exports.every((e) => constraints.exports.includes(e)))
		reasons.push("EXPORT_UNSUPPORTED");
	if (!target.fonts.every((f) => constraints.fonts.includes(f)))
		reasons.push("FONT_UNSUPPORTED");
	if (target.transparency === "allow" && constraints.transparency === "forbid")
		reasons.push("TRANSPARENCY_MISMATCH");
	return Object.freeze({
		state: reasons.length ? ("unsupported" as const) : ("supported" as const),
		reasons: Object.freeze(reasons.sort()),
		relayout: changed,
		reapproval: changed,
	});
}
export const launchRoster = Object.freeze([
	Object.freeze({
		product: "commemorative-ticket",
		state: "pending",
		reason:
			"Required P0: approved layout and roster decision absent; the customer print-tier mapping (finish, Classic 2x5.5 in and Stamp 2x3 in, trim) is an open product decision. The Prodigi sandbox validation template is not this format",
	}),
	Object.freeze({
		product: "postcard",
		state: "pending",
		reason: "P1 enable/defer decision absent",
	}),
	Object.freeze({
		product: "card",
		state: "pending",
		reason: "P1 enable/defer decision absent",
	}),
	Object.freeze({
		product: "art-print",
		state: "pending",
		reason: "P1 enable/defer decision absent",
	}),
]);

// Sandbox validation template (PP-03, #6). The owner-delegated decision is integration-evals
// planning/decisions/0003-owner-delegated-decisions-2026-10-12.md, rows R1-R3. It names the single Prodigi product used for the
// first owner-approved sandbox product-details read, quote and test order. It is NOT a launch format and not on launchRoster:
// it never makes the commemorative ticket (or any customer format) eligible, and the customer print-tier mapping is still open.
const MM_PER_IN = 25.4;
const inchesSchema = z.number().positive().max(100);
export const sandboxValidationTemplateSchema = z
	.object({
		privateVersion: z.literal(1),
		id: refSchema,
		revision: revisionSchema,
		purpose: z.literal("sandbox-validation"),
		customerFacing: z.literal(false),
		supplier: z.literal("prodigi"),
		sku: z.string().regex(/^[A-Z0-9][A-Z0-9-]*$/),
		decisionRef: z.string().min(1).max(200),
		printArea: z.literal("default"),
		orientation: z.enum(["portrait", "landscape", "square"]),
		widthIn: inchesSchema,
		heightIn: inchesSchema,
		widthMm: positiveSchema,
		heightMm: positiveSchema,
		widthPx: z.number().int().positive(),
		heightPx: z.number().int().positive(),
		dpi: z.number().int().positive().max(2400),
		profile: z.literal("srgb"),
		format: z.literal("jpg"),
		sizing: z.literal("fillPrintArea"),
		fullBleed: z.literal(true),
		// Not published by the supplier and not decided here; bleed and safe area stay unknown until the product-details read.
		bleed: z.literal("unknown"),
		safe: z.literal("unknown"),
		finish: z.literal("lustre"),
		finishBasis: z.literal("published-family-only"),
		destinationCountry: z.string().regex(/^[A-Z]{2}$/),
		shippingMethod: z.literal("Standard"),
		customerMapping: z.literal("open-product-decision"),
	})
	.strict()
	.readonly();
export type SandboxValidationTemplate = z.infer<
	typeof sandboxValidationTemplateSchema
>;
export function resolveSandboxValidationTemplate(
	value: unknown,
): SandboxValidationTemplate {
	const t = parse(sandboxValidationTemplateSchema, value);
	requireCore(
		t.widthMm === Math.round(t.widthIn * MM_PER_IN * 1e6) / 1e6 &&
			t.heightMm === Math.round(t.heightIn * MM_PER_IN * 1e6) / 1e6,
		"INVALID_GEOMETRY",
		"sandboxValidation.mm",
	);
	requireCore(
		t.widthPx === t.widthIn * t.dpi && t.heightPx === t.heightIn * t.dpi,
		"INVALID_GEOMETRY",
		"sandboxValidation.pixels",
	);
	requireCore(
		t.orientation ===
			(t.widthIn === t.heightIn
				? "square"
				: t.widthIn > t.heightIn
					? "landscape"
					: "portrait"),
		"INVALID_GEOMETRY",
		"sandboxValidation.orientation",
	);
	return t;
}
export const sandboxValidationTemplate = Object.freeze(
	resolveSandboxValidationTemplate({
		privateVersion: 1,
		id: "prodigi-sandbox-validation-global-pho-4x6",
		revision: "2026-10-12.1",
		purpose: "sandbox-validation",
		customerFacing: false,
		supplier: "prodigi",
		sku: "GLOBAL-PHO-4X6",
		decisionRef:
			"integration-evals planning/decisions/0003-owner-delegated-decisions-2026-10-12.md R1-R3",
		printArea: "default",
		orientation: "landscape",
		widthIn: 6,
		heightIn: 4,
		widthMm: 152.4,
		heightMm: 101.6,
		widthPx: 1800,
		heightPx: 1200,
		dpi: 300,
		profile: "srgb",
		format: "jpg",
		sizing: "fillPrintArea",
		fullBleed: true,
		bleed: "unknown",
		safe: "unknown",
		finish: "lustre",
		finishBasis: "published-family-only",
		destinationCountry: "US",
		shippingMethod: "Standard",
		customerMapping: "open-product-decision",
	}),
);
export const sandboxValidationTemplateHash = fingerprint(
	sandboxValidationTemplate,
);
/**
 * Does stub artwork of this pixel size fit on the validation sheet without scaling? It is composed on the 6x4 sheet, not
 * trimmed to the stub: fitting says nothing about trim, which belongs to the open customer print-tier decision.
 */
export function stubFitsSandboxValidation(
	stub: { readonly widthPx: number; readonly heightPx: number },
	template: SandboxValidationTemplate = sandboxValidationTemplate,
): boolean {
	return (
		Number.isInteger(stub.widthPx) &&
		Number.isInteger(stub.heightPx) &&
		stub.widthPx > 0 &&
		stub.heightPx > 0 &&
		stub.widthPx <= template.widthPx &&
		stub.heightPx <= template.heightPx
	);
}
