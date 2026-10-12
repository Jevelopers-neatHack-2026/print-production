<a href="https://github.com/Jevelopers-neatHack-2026/print-production">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-night.svg">
    <img alt="print-production — Print composition and manifests. TicketStub banner showing crop marks, a registration target and bleed guides around a stub sheet." src="docs/assets/readme/banner-day.svg" width="100%">
  </picture>
</a>

# print-production

Print composition, personalization, output and manifest engines for TicketStub, with a pinned offline calibration harness. The package is private development software; local mechanics and scoped conformance do not establish supplier eligibility or a product release.

<p>
  <a href="https://github.com/Jevelopers-neatHack-2026"><img alt="TicketStub ecosystem" src="https://img.shields.io/badge/TicketStub-ecosystem-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="#status"><img alt="Status: private local mechanics; external acceptance blocked" src="https://img.shields.io/badge/status-private%20mechanics%20%7C%20acceptance%20blocked-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href=".nvmrc"><img alt="Node.js 24.21.0" src="https://img.shields.io/badge/node-24.21.0-26302A?style=flat-square&labelColor=17140F"></a>
  <a href="docs/runtime/pins.json"><img alt="Chromium 156.0.8078.4 via Playwright 1.64.0, pinned" src="https://img.shields.io/badge/chromium-156.0.8078.4-7CC6D2?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [Architecture and ownership](#architecture-and-ownership) · [Quickstart](#quickstart) · [Configuration](#configuration) · [Checks](#checks) · [Module map](#module-map) · [Docs](#docs) · [Related](#related-repositories)

## Status

The package has a strict Node 24 / TypeScript ESM runtime foundation and private local engines. Current local work includes:

- Offline Chromium calibration renders a synthetic 4 × 2 inch Latin fixture to PNG/PDF, independently checks both outputs and compares normalized repeats.
- Private composition, typography, asset, template, preflight and repair mechanics; local rendering, output inspection, CSV batches and archives; exact dependency, font and browser pins live in [`pins.json`](docs/runtime/pins.json).
- `pp-verify` runs the calibration and private test suites. Private suites can pass their local checks while still reporting `external-blocked`; release exits 1 with `RELEASE_INCOMPLETE` until its outside contracts and acceptance evidence are available.

The separate `@jevelopers/print-production/candidate` surface binds all six typed operations to real local composition, inspection, export, batch and storage behavior against the frozen shared-contracts **0.9.7** private development candidate. PR30 implemented the adapters; PR33 independently reviewed and adopted the exact owner archive, with [postmerge six-operation and byte-verification evidence](https://github.com/Jevelopers-neatHack-2026/print-production/pull/33#issuecomment-6115833069) at `0ef7398bb94caacf6b48068747142883470fbdaf` on 2026-10-12. Review permits private development; `accepted:false` and `live_integration:false` remain. Synthetic authority is used in tests, supplier eligibility is blocked, and canonical visible batch rows are blocked by the candidate's eligibility requirement (PP#13.4). JobRef/status retains persisted row evidence with `batch:null`; canonical automatic repair scheduling, derived approval mapping and CSV activation remain unimplemented. See [candidate adapter availability and limits](docs/contracts/candidate-adapter.md). The calibration profile is sRGB; local output does not claim CMYK, PDF/X or printer certification.

PR39 supplies [actual Linux-rendered bundle bytes and integrity variants](docs/contracts/candidate-adapter.md#offline-consumer-handoff) for offline consumer development: integrity passed, eligibility blocked, synthetic approval authority. PR38 adds a private read-only exporter for staged local metering evidence, omitting raw request and row-key hashes. Its unsigned integrity digest supplies no canonical `UsageEvent`, Finance acknowledgement or access grant; see [local metering limits](docs/contracts/candidate-adapter.md#local-metering-evidence).

Historical runtime/pipeline evidence through 2026-10-12: PR20 merged at `e7e57bbb048c7c2a5529eed658c8d3ecf8b5ceac` with actual Linux proof and final source review disposition ROOT-R1 resolved. Pipeline PR23 merged at `e2c946b0c4f979227c19d0534ac71b5d5a85badb` with an explicit CI waiver; [PR29](https://github.com/Jevelopers-neatHack-2026/print-production/pull/29) merged at `f0afc32d2624a0aec1c74e50e07e70bab3e6c5fa` and changed CI child deadlines. [PR34](https://github.com/Jevelopers-neatHack-2026/print-production/pull/34) adopted Linux CI as authoritative calibration evidence at `99b9f3bd747a28a056f29baac66b6d2f867dd1e0`; [PR36](https://github.com/Jevelopers-neatHack-2026/print-production/pull/36) repaired the Linux owner positive-control image environment and close-listener race at `e17d290afbe43363af48a0d9d448d0cfe7ccfc98`. These receipts apply to their recorded revisions; they do not certify later main revisions or complete external acceptance. See [evidence and remaining acceptance](docs/runtime/README.md#evidence-and-remaining-acceptance).

The repository [release gate (PP-12)](https://github.com/Jevelopers-neatHack-2026/print-production/issues/3)
and [production handoff (PP-12F)](https://github.com/Jevelopers-neatHack-2026/print-production/issues/19)
remain open. Shared-contract acceptance, genuine input/approval authority, an approved
supplier specification and the selected app/fulfillment/Finance consumer evidence are
separate from local fixture success.

## Architecture and ownership

The candidate factory accepts an authenticated host and resolves immutable creative,
event, template and approval references. Private engines compose and inspect exact
content, export local files, and publish through the existing SQLite artifact/job
store. The candidate adapter maps those results into the frozen development contracts;
it preserves blocked eligibility when production prerequisites are missing.

| Boundary | Owner |
| --- | --- |
| Composition, typography, preflight, exports, immutable artifact bytes and local jobs | `print-production` |
| Image generation and immutable design versions | `creative-engine` |
| Researched facts and their source provenance | `event-intelligence` |
| Canonical cross-repository schemas | `shared-contracts` |
| Customer identity, approvals, order lifecycle and downloads | `getticketstub.com` |
| Supplier capabilities, quotes and order submission | `fulfillment-connectors` |
| Usage intake, budget and authoritative financial records | `cost-intelligence` |

See the [candidate operation table](docs/contracts/candidate-adapter.md) for all six
methods, and [ownership](docs/architecture/OWNERSHIP.md) for the intended integration.

## Quickstart

Use the official Node **24.21.0** bundle with bundled npm **11.19.0** ([`.nvmrc`](.nvmrc), [`package.json`](package.json) `engines`, `engine-strict` in [`.npmrc`](.npmrc)). The `preinstall` guard rejects other runtimes. Installation needs registry/CDN access; rendering and checks then use only local resources.

```sh
git clone https://github.com/Jevelopers-neatHack-2026/print-production.git
cd print-production
export TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8
npm ci
npm run browser:install
npm run build
```

Checksum verification of the Node bundle, platform profiles and the calibration profile are in the [runtime guide](docs/runtime/README.md#run).

There is no standalone web server or `npm start` command. The package root exposes
calibration helpers; the separate `./candidate` entry point exposes the development
production factory. Integration requires the host ports described in the
[candidate guide](docs/contracts/candidate-adapter.md).

## Configuration

No provider credentials are required for offline local checks. Use the committed
configuration rather than substituting host fonts, a global browser or a different
runtime patch.

| Setting | Meaning |
| --- | --- |
| [`.nvmrc`](.nvmrc), [`.node-version`](.node-version), [`.npmrc`](.npmrc), [`package.json`](package.json) | Exact Node/npm requirements and installation guard |
| [`docs/runtime/pins.json`](docs/runtime/pins.json) and [`package-lock.json`](package-lock.json) | Browser, platform, fonts, licenses and dependency identities |
| `TZ=UTC`, `LANG=C.UTF-8`, `LC_ALL=C.UTF-8` | Reproducible test locale and timezone |
| `--suite`, `--mode offline`, `--evidence-dir` | Required verifier arguments; use a dedicated local evidence directory |
| `PP_COMPOSITION_EVIDENCE_DIR` / `PP_DURABILITY_EVIDENCE_DIR` | Output directories for the standalone composition/durability test commands in their guides |

Linux rendering requires the pinned container and its enforced security controls;
an arbitrary Linux host or a matching environment string does not establish that
profile. The [runtime guide](docs/runtime/README.md) covers Linux and macOS separately.

## Checks

```sh
npm run typecheck
npm run format:check
npm test
npm run verify -- --suite runtime --mode offline --evidence-dir out/evidence/local-macos
```

Local macOS runs pass only on the exact pinned macOS profile; the Linux CI `runtime` workflow is the authoritative evidence. See [Authoritative evidence and the local macOS profile](docs/runtime/README.md#authoritative-evidence-and-the-local-macos-profile).

`--suite`, `--mode offline` and `--evidence-dir` are all mandatory; the runtime suite writes `runtime.json` and two renders under the evidence directory. Linux CI ([runtime workflow](.github/workflows/runtime.yml)) runs the bounded workloads and final verification in a digest-pinned Playwright image with networking disabled, including the Linux sandbox suites.

| Verifier suite | Result interpretation |
| --- | --- |
| `runtime` | Calibration only; exit 0 requires the pinned profile and its checks |
| `artifact-storage` | Scoped local storage adapter conformance; acceptance and live integration remain false |
| `exporters` | Scoped local output/manifest-byte conformance; supplier eligibility remains blocked |
| Other private leaf suites | Can complete their local checks and still exit 1 with `external-blocked` |
| `api-contracts` | External accepted API gate remains unimplemented |
| `release` | Exits 1 with `RELEASE_INCOMPLETE` while required leaves and external pins are missing |

`npm test` consumes the compiled tests, so rerun `npm run build` after source changes.
`format:check` covers the configured source/configuration paths; it is not a Markdown
lint command. Exact suite definitions are in the
[registry](src/exporters/private-suite-registry.ts).

## Module map

| Path | State | Details |
| --- | --- | --- |
| [`src/runtime/`](docs/runtime/README.md), `src/index.ts` | Local runtime implemented | Pinned offline calibration; the package root exports runtime verification only. |
| [`src/composition/`](docs/composition/README.md), `src/templates/`, `src/typography/`, `src/assets/`, `src/preflight/`, `src/repair/` | Private local mechanics | Synthetic inputs and private adapters; no approved supplier roster or canonical production contracts. |
| `src/exporters/`, `src/personalization/`, `src/manifests/`, `src/storage/`, `src/jobs/` | Private output and batch mechanics | Local files, inspection, CSV/batches, archives and durable storage; no handoff-eligible bundle. See [production output](docs/production-output/README.md). |
| [`src/api/`](docs/contracts/candidate-adapter.md) | Six development adapters implemented | Frozen unaccepted shared-contracts candidate; real local bundle integrity, blocked supplier eligibility and canonical row publication. |
| [`scripts/verify/`](scripts/verify/dispatcher.ts) | Local suites; release blocked | Private checks run locally; external integration gates remain open. |
| [`scripts/security/`](scripts/security/README.md) | Accepted runtime foundation | ROOT-R1 resolved in reviewed/merged PR20; Linux CI is authoritative under PR34; revision-specific evidence is linked above. |

## Docs

- [PP-01A runtime: run, calibration profile, evidence and limits](docs/runtime/README.md)
- [Private composition mechanics and limits](docs/composition/README.md)
- [Private output, CSV, archive and acceptance holds](docs/production-output/README.md)
- [Durability, restart and staged observations](docs/durability/README.md)
- [Candidate adapter behavior and limits](docs/contracts/candidate-adapter.md)
- [Linux renderer security policy and ROOT-R1 diagnosis](scripts/security/README.md)
- [Repository responsibilities and interfaces](docs/architecture/OWNERSHIP.md) · [acceptance view](docs/architecture/ACCEPTANCE.md)
- [Architecture reference](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md) · [implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)

Architecture integration documents the intended boundaries. It does not establish completed product functionality, passing implementation tests, connected sponsor tools, or live financial activity.

## Related repositories

- [creative-engine](https://github.com/Jevelopers-neatHack-2026/creative-engine): immutable design versions consumed for composition.
- [event-intelligence](https://github.com/Jevelopers-neatHack-2026/event-intelligence): verified event facts.
- [shared-contracts](https://github.com/Jevelopers-neatHack-2026/shared-contracts): canonical interfaces (PP-01B dependency).
- [fulfillment-connectors](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors): selected product requirements and supplier handoff.
- [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com): receives verified customer downloads.
- [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence): owns usage intake and financial records; canonical production metering remains a handoff requirement.
- [integration-evals](https://github.com/Jevelopers-neatHack-2026/integration-evals): owns master acceptance and composed evidence; local production receipts do not change its criteria.

## Contributing

Read [AGENTS.md](AGENTS.md) and the organization [contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Use a focused branch, neutral issue references and independent review of the exact diff. Preserve immutable dependency and evidence bytes. Acceptance states belong in the [integration-evals master checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md) after owner evidence review.

## License

No project-wide license file is present. The bundled fonts retain their
[SIL Open Font License](src/assets/fonts/OFL.txt), and the copied Playwright policy
retains its [upstream license](scripts/security/LICENSE.playwright). Those notices do
not establish a license for the entire repository.
