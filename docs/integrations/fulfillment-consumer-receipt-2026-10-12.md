# Fulfillment consumer receipt: 2026-10-12

Refs #19. This is a bounded evidence reconciliation, not PP-12F completion, Product approval, supplier eligibility, or a release decision.

## Change in dependency state

The full-bundle consumer is no longer missing. Fulfillment [PR #43](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/pull/43) merged at `a1c04e6424626475c7c6db3d397cc6e3392c1600` on 2026-10-12 at 13:13:06 UTC. Its [post-merge owner receipt](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/issues/10#issuecomment-6125115725) reports actual preferred-corpus consumption, 664 checks across 16 suites, 166 package checks, and 14 direct verifiers. These are the consumer owner's executions, not a fresh Print-side execution.

The corresponding [actual-main workflow](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/actions/runs/38254152312), job `114827745608`, completed successfully. Step 21, "Verify the ProductionBundle consumer over the owner package and the real corpus bytes", completed successfully. The [immutable consumer documentation](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/blob/a1c04e6424626475c7c6db3d397cc6e3392c1600/docs/production-bundle.md) defines the best result as `integrity_passed_blocked`, not an eligible or approved package.

This supersedes only the implementation-missing description of this dependency. It does not replace earlier receipts, transfer acceptance authority, or satisfy every criterion of #19.

## Exact component and input pins

| Component | Identity and scope |
| --- | --- |
| Print source selected for these bytes | `01a7b13813b27e5b925b1363543c2577e860ffff`, tree `82f3296bdb5dfb204245efa23f0a393c6438d266` |
| Producer Linux run | [38216826905](https://github.com/Jevelopers-neatHack-2026/print-production/actions/runs/38216826905) |
| Preferred artifact | [11733229451](https://github.com/Jevelopers-neatHack-2026/print-production/actions/runs/38216826905/artifacts/11733229451), `pp16-bundle-handoff-1`, 6,437,762 bytes |
| Archive SHA-256 | `eb9af5b9aae788561d2a7f8f67f3fce579cb53323751856e079f8c77db4d0300` |
| CORPUS.json SHA-256 | `d3e5560d1f7030ac4bf1d7164530a1137234acd1ebedd39043c356bf5604949f` |
| Bundle hash | `sha256:ca9c78c3ac7823ea2b81b395a6f91acae2abe0b347f65bcf0ff067dce7993ea4` |
| Fulfillment consumer | `a1c04e6424626475c7c6db3d397cc6e3392c1600`; owner-recorded tree `42a4b8bdacfa66b4784a82408db3ad8fecdfebf0` |
| Shared package, both components | `@jevelopers/shared-contracts@0.9.7`, source `d432ad5c895a67155affeaa05cd8423c758d95c3` |
| Shared archive SHA-256 | `771a9f565ea9df87a4c08e6e6d5ede422d2a5926182a95be082dc8ed7b8c4c43` |
| Consumer runtime | [Node 24.21.0 / npm 11.19.0](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/blob/a1c04e6424626475c7c6db3d397cc6e3392c1600/package.json) |

The [selected-source producer receipt](https://github.com/Jevelopers-neatHack-2026/print-production/issues/19#issuecomment-6120259940) remains the provenance anchor. Print main `89b5dd63c0a23dc27e62cfc235daa40dfe6d2002` was the repository baseline inspected for this reconciliation; its later source changes do not relabel the earlier rendered bytes.

The earlier artifact `11727002342`, producer `82b8b4cc319e9d086a5731c30b57013b2c3e95ae`, remains historical evidence. Its archive SHA-256 is `e806e15abe8bd6f85b745a8f7698e3e223409ec73bc7025046a806fccd32bc9f`; its CORPUS.json SHA-256 is `6fbbcd129f100d07e0b42491e29dfdd26a1944b1c31a181e70a13715d0d55849`. Neither that artifact nor a newer main revision is substituted for the preferred consumer input above.

## Independent byte-custody reinspection

On 2026-10-12, the author downloaded the preferred archive and independently checked its exact outer digest, 65 safe regular members, all 64 declared file lengths and SHA-256 hashes, seven actual variant differences, and eight nested ZIP inventories and member bytes. No files were extracted or changed, and neither the renderer nor the consumer SDK was executed by this reinspection. Execution was auxiliary Python 3.13.5, offline, against recorded synthetic producer output.

| Variant | Independently observed difference from the baseline |
| --- | --- |
| valid | None; byte integrity only |
| tampered-payload | `hash-mismatch:lineage.json` |
| tampered-manifest | `hash-mismatch:manifest.json` |
| tampered-detached | `hash-mismatch:detached.json` |
| missing-payload | `missing:lineage.json` |
| missing-manifest | `missing:manifest.json` |
| extra-file | `extra:extra.bin` |

Each nested archive contains exactly `lineage.json`, `manifest.json`, `output.pdf`, `output.png`, `output.svg`, and `preflight.json`, with bytes equal to the baseline members. The negative variants intentionally leave the nested archive unchanged; checking only archive.zip would miss their outer-file differences.

The following self-contained reproduction checks those byte-custody claims. Download the exact artifact through authorized GitHub access, then replace `/path/to/preferred.zip`. It has no provider calls and does not perform canonical schema or semantic-hash validation.

```sh
python3 - /path/to/preferred.zip <<'PY'
import hashlib, io, json, stat, sys, zipfile
from pathlib import Path

def require(ok, message):
    if not ok:
        raise ValueError(message)

def digest(value):
    return hashlib.sha256(value).hexdigest()

def members(value):
    require(len(value) <= 16 * 1024 * 1024, "archive limit")
    with zipfile.ZipFile(io.BytesIO(value)) as archive:
        entries = archive.infolist()
        require(len(entries) <= 100, "entry-count limit")
        require(sum(e.file_size for e in entries) <= 32 * 1024 * 1024, "inflated limit")
        result = {}
        for entry in entries:
            name = entry.filename
            require(name and "\\" not in name and "\x00" not in name and ":" not in name, "unsafe name")
            require(all(p not in ("", ".", "..") for p in name.split("/")), "unsafe path")
            require(name not in result and not entry.is_dir(), "duplicate or directory")
            require(stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG), "nonregular member")
            require(not entry.flag_bits & 1, "encrypted member")
            require(entry.compress_type in (0, 8), "unsupported compression")
            require(entry.file_size <= 16 * 1024 * 1024, "member limit")
            result[name] = archive.read(entry)
        return result

path = Path(sys.argv[1])
require(path.stat().st_size <= 16 * 1024 * 1024, "input limit")
raw = path.read_bytes()
require(digest(raw) == "eb9af5b9aae788561d2a7f8f67f3fce579cb53323751856e079f8c77db4d0300", "archive digest")
files = members(raw)
require(digest(files["CORPUS.json"]) == "d3e5560d1f7030ac4bf1d7164530a1137234acd1ebedd39043c356bf5604949f", "corpus digest")
corpus = json.loads(files["CORPUS.json"])
expected = {"valid": [], "tampered-payload": ["hash-mismatch:lineage.json"],
    "tampered-manifest": ["hash-mismatch:manifest.json"],
    "tampered-detached": ["hash-mismatch:detached.json"],
    "missing-payload": ["missing:lineage.json"],
    "missing-manifest": ["missing:manifest.json"], "extra-file": ["extra:extra.bin"]}
seen, checked = {"CORPUS.json"}, 0
inventories = [("bundle/", corpus["baseline_inventory"]), ("bundle/", corpus["control_inventory"])]
inventories += [("variants/" + v["id"] + "/", v["inventory"]) for v in corpus["variants"]]
for prefix, inventory in inventories:
    for entry in inventory:
        name = prefix + entry["name"]
        require(name not in seen, "duplicate declaration")
        value = files[name]
        require(len(value) == entry["length"] and digest(value) == entry["sha256"], "declared bytes")
        seen.add(name)
        checked += 1
require(seen == set(files) and len(files) == 65 and checked == 64, "exact inventory")
base = {e["name"]: files["bundle/" + e["name"]] for e in corpus["baseline_inventory"]}
require({v["id"] for v in corpus["variants"]} == set(expected), "variant inventory")
for name, wanted in expected.items():
    prefix = "variants/" + name + "/"
    given = {p[len(prefix):]: b for p, b in files.items() if p.startswith(prefix)}
    actual = ["missing:" + n for n in base.keys() - given.keys()]
    actual += ["extra:" + n for n in given.keys() - base.keys()]
    actual += ["hash-mismatch:" + n for n in base.keys() & given.keys() if base[n] != given[n]]
    require(sorted(actual) == wanted, "variant delta: " + name)
inner_names = {"lineage.json", "manifest.json", "output.pdf", "output.png", "output.svg", "preflight.json"}
for prefix in ["bundle/"] + ["variants/" + n + "/" for n in expected]:
    inner = members(files[prefix + "archive.zip"])
    require(set(inner) == inner_names and all(b == base[n] for n, b in inner.items()), "nested bytes")
require(corpus["synthetic"] is True and corpus["accepted"] is False and corpus["handoffEligible"] is False, "scope")
print("PASS: 65 members; 64 declared lengths/hashes; 7 variant deltas; 8 nested ZIPs; eligibility remains blocked")
PY
```

This exact reproduction was executed with Python 3.13.5 against artifact `11733229451`: exit 0. It is not a passing claim for Print's Node/Chromium tests. Full pinned build, typecheck, format, renderer, recovery, and consumer SDK execution were not performed in the author container: direct clone failed DNS resolution, and Node 24.21.0/npm 11.19.0, Docker, and Entire were unavailable. Node 22.16.0/npm 10.9.2 were not substituted for qualification. Current-candidate CI and independent Print maintainer review remain required before merging this documentation change.

## Remaining owner inputs and acceptance

The fixture is synthetic 1200 x 600, 4 x 2 inch output. It is not GLOBAL-PHO-4X6, a trimmed Classic/Stamp, or evidence for matte, foil, holo, supplier bleed, or safe zones. The corpus retains `accepted: false`, `handoffEligible: false`, null Finance receipt, and empty usage references. The trusted commitment separately records `eligibility.state: blocked` and `eligibility.handoff_eligible: false`. The historical CORPUS.json word `accepted` for the valid variant is an integrity expectation only, not customer approval.

| Required next input | Accountable role and existing route |
| --- | --- |
| Exact composed-output approval, authenticated display association, immutable issuance/currentness, and approved assets | Product/frontend, Creative, Print, and Shared owners; [existing captain request](https://github.com/Jevelopers-neatHack-2026/print-production/issues/19#issuecomment-6124087077). The later Product design direction is not an issued grant or Print/Shared ACK. |
| Genuine selected spec/capability, customer SKU/finish/trim mapping, and a second real spec for stale-spec coverage | Product and Fulfillment owners; [PP #6](https://github.com/Jevelopers-neatHack-2026/print-production/issues/6), [FC #8](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/issues/8), and [FC #10](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/issues/10). |
| Canonical row scope and repair/reapproval representation | Shared and Product owners with Print; [PP #13](https://github.com/Jevelopers-neatHack-2026/print-production/issues/13), [PP #17](https://github.com/Jevelopers-neatHack-2026/print-production/issues/17), and [PP #12](https://github.com/Jevelopers-neatHack-2026/print-production/issues/12). |
| Local execution/pre-ingestion/delivery mapping and actual Finance gateway conformance | Finance and Print owners; [exact producer-row request](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/15#issuecomment-6121840286). Durable ingest implementation exists; missing provider/billable identities must not be invented. |
| Accepted replacement/adoption decision for legacy byte-helper limitations | Shared owner and actual consumers. `SC-PFB-PARENT-LEGACY009` remains a limitation of frozen 0.9.7; the consumer's defensive subset and separately reviewed private artifacts do not repair or repin it. |
| Official end-to-end acceptance and current-main PR37 Linux route | Existing Print captain/QA owner and integration-evals. The [current owner request](https://github.com/Jevelopers-neatHack-2026/print-production/issues/19#issuecomment-6124087077) is not answered by this byte-custody receipt. |

For PP-12F.7, retain the preferred-corpus input and the real consumer's bounded result as evidence, while keeping the approved-valid and stale-spec cases blocked. ART-03, ART-04, ART-05, #19, gate #3, and epic #1 are not marked complete here. No provider request, order, payment, deployment, source-package adoption, private transcript, customer data, or font bytes are part of this change.
