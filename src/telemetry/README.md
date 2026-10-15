# telemetry

Immutable local staged observations and a durable outbox are implemented in
observations.ts. See [durability](../../docs/durability/README.md).
These are not UsageEvent or a ledger. Canonical mapping, real finance intake,
EvaluationEvidence and Neatlogs remain blocked.

`evidence-page.ts` is a read-only adapter over `ObservationOutbox.list`. It
returns a deterministic page (`pp.telemetry.staged-observation-page` v2) whose
envelope states the data is local, staged, unmapped and non-authoritative, with
an allowlisted observation projection (observation/operation/execution-attempt/
job/publication references; measured or unknown metrics as recorded;
environment=local, billingMode=unclassified, producerBuildDigest=null). It
does not export the global event sequence or page offset. The
SHA-256 `integrity.payloadDigest` commits to the canonical (sorted-key) JSON of
everything except `integrity`; `verifyEvidencePage` rechecks it and returns false for malformed pages. Canonicalization
fails closed (`INVALID_INPUT`) on non-JSON data such as undefined, non-finite
numbers, sparse arrays, accessors or cycles, and metrics are projected field by
field so unexpected runtime properties never reach evidence. Pagination uses
a deterministic encrypted, scope-bound `nextCursor`; it hides both the
sequence and the unkeyed scope digest. The cursor key is stored in the private
owner-only database. Each read is capped by the configured page size (at most
1,000 rows), and token holders cannot forge caller-selected offsets. Callers still
own authorization and broader request-budget policy. Version 1 pages and
cursors are rejected. Delivery status is not included
(`deliveryStatus: "not_included"`); the adapter reads observations only and
makes no delivery claim. The digest is a local integrity check, not a signature
or approved receipt; the adapter never mutates the outbox, and does not derive
tenant, project or build from a scope digest. No tenant/project digest is
exported. Request and row-key digests are not exported (unkeyed hashes
permit dictionary and cross-scope equality disclosure); private joins stay in
the DB. `verifyEvidencePage` also enforces the strict envelope (exact keys and
fixed provenance values) so a forger who recomputes the digest is still
rejected. Page verification does not make evidence authoritative; only cursor
validation uses the private key.

Cursor cryptography uses AES-256-GCM with a 128-bit authentication tag and a
128-bit nonce derived by HMAC-SHA-256 from the fixed-width scope/sequence
plaintext. Encryption and nonce derivation use distinct labeled HMAC keys
from a random 256-bit store key; AAD binds the token to the v2 protocol.
Equal positions in the same store/scope yield equal tokens. Different positions
have an approximate nonce-collision probability of n(n-1)/2^129 for n distinct
positions under one key. The implementation does not enforce an aggregate
issuance budget; callers must bound use. Cursor equality,
page sizes, recorded times and exported IDs remain observable.

The key table is added transactionally when an old version-1 database opens.
The first outbox instance initializes the key under the database's immediate
transaction, so concurrent instances on an existing database share it. The current
base also retains bounded cold-open WAL setup retries before schema initialization
(`src/internal/durability-wal.ts`). The cursor-key regression deliberately tests
first-key initialization on an existing database; the separate
`durability-bootstrap.test.ts` constructor corpus covers concurrent cold opens.
Exhausting the bounded WAL wait still fails closed with STORAGE. These are
distinct checks, and the earlier PR46 cold-open failures remain historical
evidence at their original revisions. Update, delete and replacement are blocked
by triggers; reopen keeps the key. The key and backups of the DB
must stay private. There is no key rotation or expiry, and copying the whole DB
also copies its cursor authority. The export read itself does not change delivery
state; constructing an outbox may initialize private cursor-key storage.

The adapter is a trusted local library. Code holding the outbox can call its
cursor minting method with an offset and can read any supplied valid scope.
Authenticate and authorize the scope before calling it, and never expose the
minting method or raw outbox/database API as an untrusted endpoint. Cursor
validation is not a substitute for authorization, and a recomputed page digest
can still verify without establishing who produced the page.
