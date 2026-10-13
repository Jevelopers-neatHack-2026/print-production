# Production API adapters

The package root exports the PP-01A calibration surface only (`renderCalibration`,
`verifyRuntime`, `VerificationFailure`). The separate
`@jevelopers/print-production/candidate` entry point exports
`createCandidateProductionOperations` from [candidate.ts](candidate.ts).

Its six methods use the frozen shared-contracts 0.9.7 development package and bind
to real local composition, inspection, exports, compatibility checks, batch jobs
and status reads through injected host ports. The factory reports
`status: "unaccepted-development"` and `accepted: false`; supplier eligibility and
complete PP-01B acceptance remain blocked. No local schema replaces the owner package.

See the [operation table and host requirements](../../docs/contracts/candidate-adapter.md),
[runtime setup](../../docs/runtime/README.md), and [repository overview](../../README.md).
