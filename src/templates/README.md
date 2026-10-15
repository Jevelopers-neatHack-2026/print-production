# templates

`private-layout.ts` implements private layout and constraint mechanics against
synthetic fixtures. No supplier specification or launch format is accepted.
See the [composition guide](../../docs/composition/README.md).

## Sandbox validation template (not a launch format)

`sandboxValidationTemplate` records the Prodigi product the owner delegated for
sandbox validation (integration-evals
`planning/decisions/0003-owner-delegated-decisions-2026-10-12.md`, rows R1-R3):

| Field | Value |
| --- | --- |
| SKU | Prodigi `GLOBAL-PHO-4X6`, 4 x 6 in (102 x 152 mm) lustre C-type photo print |
| Print area | `default`, landscape 6 x 4 in (152.4 x 101.6 mm) |
| Artwork | 1800 x 1200 px at 300 dpi, full bleed, sRGB, JPG, `fillPrintArea` |
| Destination, shipping | `US`, `Standard` |
| Bleed, safe area | `unknown`: not published and not decided here |

It is used only for the first owner-approved sandbox product-details read,
quote and test order. It is **not** on `launchRoster`, enables no format, and
the commemorative ticket stays `pending`.

The stub artwork (5.5 x 2 in at 300 dpi = 1650 x 600 px) fits inside the
1800 x 1200 px print area (`stubFitsSandboxValidation`). It is composed on
the 6 x 4 sheet, not trimmed to the stub.

**Still open:** the customer-facing print-tier mapping. Lustre is not matte,
the SKU has no foil or holo, and Classic 2 x 5.5 in and Stamp 2 x 3 in would
arrive as a 6 x 4 sheet. Finish naming, which variants map, and trim need an
explicit product decision before any launch format is enabled.

Prodigi's public C-types page (checked 2026-10-12, no API call) lists
`GLOBAL-PHO-4X6` at 102x152mm, fulfilled in the US among other regions, with
an optimal DPI of 300 and jpg or pdf files. Lustre is listed for the C-type
family, not per SKU (`finishBasis: "published-family-only"`). sRGB is the
decision's artwork policy. The page does not state it.

