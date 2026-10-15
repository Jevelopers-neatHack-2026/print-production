# Rebalance the existing CI workload groups

Refs #3 (PP-12). This is a scheduling correction, not release acceptance or a
claim that every historical cancellation has the same cause.

## Change and invariants

The fixed three-job plan now places
`dist/tests/unit/exporter-conformance-controls.test.js` in `private`, and
`dist/tests/unit/durability-dispatcher.test.js` in `standalone`. The latter uses
the existing default assignment. Everything else keeps its previous assignment.
The exporter controls invoke repeated real CLI conformance runs; concentrating
them with all other standalone files left that job with little time margin.

There are still exactly three workload jobs (`cli`, `private`, `standalone`).
All source and compiled test discovery, baseline membership, file hashes,
per-file serialization, test bodies, negative controls, deadlines, native
runtime and renderer pins, 15 validation phases, and final receipt checks are
unchanged. No new provider call, job, application retry or release capability is
introduced. The plan's union digest changes because group membership is part of
its input. Old receipts are not reusable for the new plan.

Every group still uses the same runner and a separate nonce-bound evidence
root. Reassigning a file changes the sibling files in that process and the
relative execution order, so full native validation remains necessary. Files
must not acquire dependencies on evidence left by unrelated earlier files.

## Observed evidence versus projection

The input is the actual successful [PR45 run 38286729677](https://github.com/Jevelopers-neatHack-2026/print-production/actions/runs/38286729677),
commit `c1230bdcccab3d08cc9afd5bf3888ea19ae5c79e`, attempt 1, and its
[union artifact 11766431314](https://github.com/Jevelopers-neatHack-2026/print-production/actions/runs/38286729677/artifacts/11766431314).
The ZIP SHA-256 is
`f0def6f82bc6a8258130ba8af8575838922f472fbbc5f368e98bea7594089269`.
The receipt contains 80 files and 786 passing tests, with zero failures,
cancellations, skips or TODOs. Its union digest is
`888459f701540536d1a7fd436d9874c6282366546f711ebb03cc4a7e4f652d13`.
These remain observations of that historical revision, not this candidate.

| Group | Recorded sum of file durations (minutes) | Reassignment projection (minutes) |
| --- | ---: | ---: |
| cli | 23.11 | 23.11 |
| private | 12.47 | 17.19 |
| standalone | 24.54 | 19.82 |

The right column reuses the original per-file durations; it is **not a new
execution** or a performance guarantee. Both columns exclude common setup and
validation phases, waiting for runners, and scheduling variation. All 80 files
and all 786 tests remain in this calculation. The latest base additionally
contains PR51's storage tests, which this historical receipt did not execute.

The separate [PR48 run 38278521736](https://github.com/Jevelopers-neatHack-2026/print-production/actions/runs/38278521736)
retains its cancelled standalone job and missing mandatory final receipt.
Its [diagnostic record](https://github.com/Jevelopers-neatHack-2026/print-production/pull/48#issuecomment-6129429594)
shows the exporter-control file taking about 17 minutes, followed by other files,
with storage custody beginning before cancellation near the unchanged 40-minute
job limit. A file-boundary summary is not a test pass. Neither that cancellation
nor any prior failure is converted to success by the projection above.

## Regression coverage

`ci-workload-balance.test.mjs` adds nine tests using explicitly synthetic bodies:
exact reassignment within the same three groups; exhaustive file/hash
preservation and deterministic changed union identity; missing-source,
missing-compiled and symlink controls for both reassigned files; and actual
native child execution of all 50 generated files (494 synthetic cases) through
the selected groups. Each child uses the test's cancellation signal and a
bounded timeout. These tests are automatically included by the unchanged
`ci-workload-*.test.mjs` CI command.

The existing plan test's `private` file count changes from 3 to 2 only for its
older 49-file synthetic fixture, which has no exporter-control file. Its total
inventory assertions are unchanged; the moved dispatcher remains in the union.
The new fixture includes the exporter-control file and tests its assignment.
No production test is removed or weakened.

## Verification and limits

In an isolated source snapshot, auxiliary Node 22.16.0 executed the new suite
against the original plan: 7 passes and 2 expected scheduling-regression failures,
exit 1. Against the corrected plan: 9 passes, zero failures/cancellations/skips/
TODOs, exit 0. All 494 generated cases execute successfully in both versions;
the difference is scheduling, not newly established renderer conformance.
The original failure remains retained. Syntax checks pass for all three changed
JavaScript modules. Original source blobs were checked against GitHub before
editing.

The author container lacks pinned Node 24.21.0/npm 11.19.0, Biome 2.5.15, Docker,
and the installed full repository dependencies. The required graph search and
clone were attempted; the graph executable was absent and cloning failed DNS.
This snapshot is not a full checkout. Biome, the Zod-dependent existing workload
suite, the full build/typecheck, and real rendering/storage/consumer tests were
not executed locally. Auxiliary success does not satisfy those requirements.

Required qualification on the exact native candidate:

```sh
npm ci
npm run build
npm run typecheck
npm run format:check
node --test --test-concurrency=1 scripts/ci-workload-*.test.mjs
```

Then execute the unchanged workflow's complete `cli`, `private`, `standalone`
and aggregate phases in its pinned offline Linux environment. Require the exact
current revision/run/attempt, all selected files and hashes, all three successful
jobs, every required phase, the full test union, and final runtime proof. Preserve
failed and cancelled attempts separately. Independent Print review and affected
main post-merge verification remain required. No Product, Fulfillment, Finance,
shared-contracts or integration-evals acknowledgement is supplied by this patch.
