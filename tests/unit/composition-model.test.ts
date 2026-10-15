import { test } from "node:test";
import assert from "node:assert/strict";
import {
	composeArtifact,
	imagePlacement,
	parseComposition,
	renderSvgWithFonts,
} from "../../src/composition/private-model.js";
import { parseAsset } from "../../src/assets/private-assets.js";
import {
	CompositionError,
	digest,
	fingerprint,
	parse,
} from "../../src/composition/primitives.js";
import {
	PrivateLayoutRegistry,
	compareTemplateCompatibility,
	launchRoster,
	resolveLayout,
	resolveSandboxValidationTemplate,
	sandboxValidationTemplate,
	sandboxValidationTemplateHash,
	stubFitsSandboxValidation,
} from "../../src/templates/private-layout.js";
import {
	formatField,
	layoutText,
	textFieldSchema,
	pinFont,
} from "../../src/typography/private-text.js";
import {
	fixtureArtifact,
	fixtureInput,
	fixtureLayout,
	fixtureFonts,
	artworkPng,
	safeLogo,
	syntheticPorts,
	privateRef,
	fontPins,
	binding,
} from "../fixtures/composition/corpus.js";

const typed = (code: string) => (error: unknown) =>
	error instanceof CompositionError && error.code === code;
test("replays the same resolved inputs without changing source bytes or calling generation", async () => {
	const f = await fixtureArtifact();
	const again = await composeArtifact(
		f.input,
		f.layout,
		f.fonts,
		f.ports,
		1001,
	);
	assert.equal(again.compositionHash, f.artifact.compositionHash);
	assert.equal(again.renderHash, f.artifact.renderHash);
	assert.equal(f.state.generationCalls, 0);
	const source = again.assets.find((a) => a.binding.purpose === "artwork");
	assert.ok(source);
	assert.deepEqual(Buffer.from(source.sourceBase64, "base64"), f.art);
	assert.equal(source.binding.digest, source.renderDigest);
	assert.ok(Object.isFrozen(again.model.input.nodes));
});
test("changes composition identity when exact text changes while preserving the artwork", async () => {
	const f = await fixtureArtifact(),
		input = fixtureInput(f.art, safeLogo, "D’Arcy 0001");
	const changed = await composeArtifact(
		input,
		f.layout,
		f.fonts,
		f.ports,
		1000,
	);
	assert.notEqual(changed.compositionHash, f.artifact.compositionHash);
	assert.deepEqual(changed.sourceArtworkHashes, f.artifact.sourceArtworkHashes);
	assert.equal(f.state.generationCalls, 0);
});
test("excludes guide layers from ordinary output and explicitly includes them in a proof", async () => {
	const f = await fixtureArtifact();
	const proof = renderSvgWithFonts(
		f.artifact.model,
		f.artifact.assets,
		f.artifact.texts,
		f.fonts,
		true,
	);
	assert.ok(!f.artifact.svg.includes('data-guide="safe"'));
	assert.ok(proof.includes('data-guide="safe"'));
});
for (const [label, mutate] of [
	[
		"duplicate IDs",
		(input: ReturnType<typeof fixtureInput>) => ({
			...input,
			nodes: [...input.nodes, input.nodes[0]],
		}),
	],
	[
		"unsupported blends",
		(input: ReturnType<typeof fixtureInput>) => ({
			...input,
			nodes: input.nodes.map((n) => ({ ...n, blend: "color-dodge" })),
		}),
	],
	[
		"timestamps",
		(input: ReturnType<typeof fixtureInput>) => ({
			...input,
			timestamp: "2026-10-10",
		}),
	],
	[
		"URL source references",
		(input: ReturnType<typeof fixtureInput>) => ({
			...input,
			designRef: "https://invalid/private",
		}),
	],
	[
		"subprecision transforms",
		(input: ReturnType<typeof fixtureInput>) => ({
			...input,
			nodes: input.nodes.map((n) => ({
				...n,
				transform: { ...n.transform, x: 0.0000001 },
			})),
		}),
	],
	[
		"executable fields",
		(input: ReturnType<typeof fixtureInput>) => ({ ...input, run: () => 0 }),
	],
] as const)
	test(`rejects ${label} at the private composition boundary`, () => {
		const art = artworkPng();
		assert.throws(
			() => parseComposition(mutate(fixtureInput(art)), fixtureLayout()),
			typed("INVALID_INPUT"),
		);
	});
test("rejects getters before invoking them", () => {
	let calls = 0;
	const value = {
		get privateVersion() {
			calls++;
			return 1;
		},
	};
	assert.throws(
		() => parseComposition(value, fixtureLayout()),
		typed("INVALID_INPUT"),
	);
	assert.equal(calls, 0);
});
test("preserves historical layout revisions and detects same-revision collisions", () => {
	const l = fixtureLayout(),
		registry = new PrivateLayoutRegistry([
			l,
			{ ...l, revision: "fixture-2", background: "#ff0000" },
		]);
	assert.notEqual(registry.revisions[0]?.hash, registry.revisions[1]?.hash);
	assert.throws(
		() => new PrivateLayoutRegistry([l, { ...l, background: "#ff0000" }]),
		typed("REVISION_CONFLICT"),
	);
	assert.equal(registry.revisions[0]?.layout.background, "#ffffff");
});
for (const patch of [
	{ units: "px" },
	{ width: 0 },
	{ orientation: "portrait" },
	{ safe: { x: 0, y: 0, width: 200, height: 20 } },
	{ trim: { x: 0, y: 0, width: 300, height: 40 } },
])
	test(`rejects invalid layout geometry ${JSON.stringify(patch)}`, () =>
		assert.throws(
			() => resolveLayout({ ...fixtureLayout(), ...patch }),
			CompositionError,
		));
test("blocks compatibility when mandatory supplier inputs are unknown", () => {
	const l = fixtureLayout();
	assert.equal(compareTemplateCompatibility(l, l, null).state, "unknown");
	assert.ok(launchRoster.every((row) => row.state === "pending"));
});
test("records the Prodigi sandbox validation template: GLOBAL-PHO-4X6, 6x4 in landscape at 300 dpi, 1800x1200 sRGB JPG", () => {
	const t = sandboxValidationTemplate;
	assert.equal(t.purpose, "sandbox-validation");
	assert.equal(t.customerFacing, false);
	assert.equal(t.supplier, "prodigi");
	assert.equal(t.sku, "GLOBAL-PHO-4X6");
	assert.equal(t.printArea, "default");
	assert.equal(t.orientation, "landscape");
	assert.deepEqual(
		[
			t.widthIn,
			t.heightIn,
			t.widthMm,
			t.heightMm,
			t.widthPx,
			t.heightPx,
			t.dpi,
		],
		[6, 4, 152.4, 101.6, 1800, 1200, 300],
	);
	assert.deepEqual(
		[t.profile, t.format, t.sizing, t.fullBleed, t.finish],
		["srgb", "jpg", "fillPrintArea", true, "lustre"],
	);
	assert.equal(t.finishBasis, "published-family-only");
	assert.deepEqual([t.bleed, t.safe], ["unknown", "unknown"]);
	assert.deepEqual(
		[t.destinationCountry, t.shippingMethod],
		["US", "Standard"],
	);
	assert.equal(t.customerMapping, "open-product-decision");
	assert.match(t.decisionRef, /0003-owner-delegated-decisions-2026-10-12/);
	assert.ok(Object.isFrozen(t));
	assert.equal(sandboxValidationTemplateHash, fingerprint(t));
});
test("the 1650x600 stub artwork fits on the sandbox validation sheet; oversize or rotated-oversize art does not", () => {
	assert.ok(stubFitsSandboxValidation({ widthPx: 1650, heightPx: 600 }));
	assert.ok(stubFitsSandboxValidation({ widthPx: 1800, heightPx: 1200 }));
	assert.equal(
		stubFitsSandboxValidation({ widthPx: 1801, heightPx: 600 }),
		false,
	);
	assert.equal(
		stubFitsSandboxValidation({ widthPx: 600, heightPx: 1650 }),
		false,
	);
	assert.equal(stubFitsSandboxValidation({ widthPx: 0, heightPx: 600 }), false);
	assert.equal(
		stubFitsSandboxValidation({ widthPx: 1650.5, heightPx: 600 }),
		false,
	);
});
test("the sandbox validation template is not a launch format and leaves the customer mapping open", () => {
	assert.ok(launchRoster.every((row) => row.state === "pending"));
	assert.ok(
		!launchRoster.some(
			(row) => (row.product as string) === sandboxValidationTemplate.id,
		),
	);
	const ticket = launchRoster.find(
		(row) => row.product === "commemorative-ticket",
	);
	assert.match(ticket?.reason ?? "", /customer print-tier mapping/);
	assert.match(ticket?.reason ?? "", /open product decision/);
});
for (const patch of [
	{ widthPx: 1650 },
	{ heightMm: 100 },
	{ orientation: "portrait" },
	{ customerFacing: true },
	{ purpose: "launch" },
	{ profile: "cmyk" },
	{ bleed: { x: 0, y: 0, width: 1, height: 1 } },
	{ customerMapping: "decided" },
	{ extra: 1 },
])
	test(`rejects an invalid sandbox validation template ${JSON.stringify(patch)}`, () =>
		assert.throws(
			() =>
				resolveSandboxValidationTemplate({
					...sandboxValidationTemplate,
					...patch,
				}),
			CompositionError,
		));
test("compares dimensions, product, DPI, font, profile and exports against injected constraints", async () => {
	const f = await fixtureArtifact();
	assert.equal(
		compareTemplateCompatibility(f.layout, f.layout, f.constraints).state,
		"supported",
	);
	for (const patch of [
		{ productRef: privateRef("wrong-product") },
		{ width: 99 },
		{ minDpi: 900 },
		{ fonts: [] },
		{ profiles: [] },
		{ exports: [] },
		{ bleed: { x: 1, y: 1, width: 99, height: 48 } },
	])
		assert.equal(
			compareTemplateCompatibility(f.layout, f.layout, {
				...f.constraints,
				...patch,
			}).state,
			"unsupported",
		);
});
for (const name of [
	"Zoë O’Connor",
	"D'Arcy 0007",
	"Café Ångström",
	"  Alice  Smith  ",
	"Anne\nMarie",
	"A very long exact attendee name that wraps across multiple measured lines",
])
	test(`preserves exact field values and leading zeros for ${JSON.stringify(name)}`, async () => {
		const f = await fixtureArtifact(name);
		const text = f.artifact.texts[0];
		assert.ok(text?.state === "measured");
		assert.equal(text.formattedValue, name);
		assert.equal(text.sourceValue, name);
		assert.equal(
			text.lines.map((l) => l.value).join(""),
			name.replaceAll("\n", ""),
		);
		const serial = f.artifact.texts[1];
		assert.ok(serial?.state === "measured");
		assert.equal(serial.formattedValue, "Seat 0007 • Serial 000123");
	});
test("shapes complex RTL glyphs with the explicit licensed font", async () => {
	const f = await fixtureArtifact("مرحبا بالعالم", "Serial 000123", true),
		text = f.artifact.texts[0];
	assert.ok(text?.state === "measured");
	assert.equal(text.font.postscriptName, "NotoSansArabic-Regular");
	assert.ok(text.lines.every((l) => l.glyphs.every((g) => g !== 0)));
	assert.equal(text.overflow, false);
});
test("escapes approved display text so markup remains inert", async () => {
	const f = await fixtureArtifact('<script>alert("x")</script> & 000123');
	assert.ok(!f.artifact.svg.includes("<script>"));
	assert.ok(f.artifact.svg.includes("&lt;script&gt;"));
});
test("reports missing glyphs without using a host font", async () => {
	const f = await fixtureArtifact("名字"),
		text = f.artifact.texts[0];
	assert.ok(text?.state === "blocked");
	assert.equal(text.code, "GLYPH_MISSING");
});
test("reports missing fonts instead of substituting host fonts", async () => {
	const f = await fixtureArtifact(),
		node = f.artifact.model.input.nodes.find((n) => n.kind === "text");
	assert.ok(node?.kind === "text");
	const result = layoutText(node.field, []);
	assert.ok(result.state === "blocked");
	assert.equal(result.code, "FONT_MISSING");
});
test("selects fallback only from the explicit approved pinned order", async () => {
	const f = await fixtureArtifact("مرحبا", "000123", true),
		node = f.artifact.model.input.nodes.find((n) => n.kind === "text");
	assert.ok(node?.kind === "text");
	const result = layoutText(
		{
			...node.field,
			fontOrder: [
				privateRef("synthetic-latin"),
				privateRef("synthetic-arabic"),
			],
		},
		f.fonts,
	);
	assert.ok(result.state === "measured");
	assert.equal(result.fontDecision, "approved-fallback");
	assert.equal(result.font.ref, "synthetic-arabic");
});
test("blocks overflow without truncating an exact fact", async () => {
	const name = "W".repeat(600),
		f = await fixtureArtifact(name),
		text = f.artifact.texts[0];
	assert.ok(text?.state === "measured");
	assert.equal(text.overflow, true);
	assert.equal(text.lines.map((l) => l.value).join(""), name);
});
test("blocks missing required values and ambiguous control characters", async () => {
	const f = await fixtureArtifact("");
	assert.ok(f.artifact.texts[0]?.state === "blocked");
	const art = artworkPng(),
		input = fixtureInput(art, safeLogo, "Alice\tSmith");
	assert.throws(
		() => parseComposition(input, fixtureLayout()),
		typed("INVALID_INPUT"),
	);
});
test("formats only explicit locale, timezone and UTC values", async () => {
	const f = await fixtureArtifact(),
		node = f.artifact.model.input.nodes.find((n) => n.kind === "text");
	assert.ok(node?.kind === "text");
	const value = "2026-10-10T01:00:00Z",
		field = parse(textFieldSchema, {
			...node.field,
			source: {
				kind: "datetime",
				value,
				timezone: "America/New_York",
				locale: "en-US",
				options: {
					year: "numeric",
					month: "2-digit",
					day: "2-digit",
					hour: "2-digit",
					minute: "2-digit",
					hourCycle: "h23",
				},
			},
			sourceDigest: digest(value),
		});
	assert.equal(formatField(field), "10/09/2026, 21:00");
	assert.throws(
		() => formatField({ ...field, sourceDigest: digest("tampered") }),
		typed("RENDER_INTEGRITY"),
	);
	assert.throws(
		() =>
			formatField({
				...field,
				source: {
					...field.source,
					kind: "datetime",
					value: "2026-02-30T01:00:00Z",
					timezone: "UTC",
					locale: "en-US",
					options: {
						year: "numeric",
						month: "2-digit",
						day: "2-digit",
						hour: "2-digit",
						minute: "2-digit",
						hourCycle: "h23",
					},
				},
			}),
		CompositionError,
	);
});
test("rejects tampered pinned font bytes and license hashes", async () => {
	const fonts = await fixtureFonts(),
		font = fonts[0];
	assert.ok(font);
	assert.throws(
		() =>
			pinFont(
				fontPins.latin,
				Buffer.from(font.base64, "base64"),
				Buffer.from("fake OFL"),
			),
		typed("FONT_INVALID"),
	);
});
test("requires exact source digest binding before text can be measured", async () => {
	const f = await fixtureArtifact(),
		node = f.artifact.model.input.nodes.find((n) => n.kind === "text");
	assert.ok(node?.kind === "text");
	const result = layoutText(
		{ ...node.field, sourceDigest: digest("changed") },
		f.fonts,
	);
	assert.ok(result.state === "blocked");
	assert.equal(result.code, "TEXT_FORMAT");
	assert.notEqual(
		fingerprint(node.field),
		fingerprint({ ...node.field, sourceDigest: digest("changed") }),
	);
});
test("rejects a tampered raster before it can enter composition", async () => {
	const art = artworkPng(),
		fonts = await fixtureFonts(),
		input = fixtureInput(art),
		{ ports } = syntheticPorts(Buffer.from("changed"));
	await assert.rejects(
		composeArtifact(input, fixtureLayout(), fonts, ports, 1000),
		typed("ASSET_HASH"),
	);
});
test("quantizes computed aspect-preserving placement to fixed physical precision", async () => {
	const f = await fixtureArtifact(),
		node = f.artifact.model.input.nodes.find((n) => n.kind === "overlay");
	assert.ok(node?.kind === "overlay");
	const bytes = Buffer.from(
			safeLogo
				.toString()
				.replace('width="100"', 'width="150"')
				.replace('viewBox="0 0 100 100"', 'viewBox="0 0 150 100"'),
		),
		asset = parseAsset(
			binding("synthetic-aspect-logo", bytes, "overlay"),
			bytes,
		);
	const placement = imagePlacement({ ...node, asset: asset.binding }, asset);
	assert.deepEqual(placement, {
		x: 85,
		y: 8.333333,
		width: 8,
		height: 5.333333,
	});
});
