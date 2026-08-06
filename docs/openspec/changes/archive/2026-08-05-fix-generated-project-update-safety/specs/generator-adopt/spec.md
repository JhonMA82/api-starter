## ADDED Requirements

### Requirement: Adopt stores canonical baselineHash with real strategy

For each file that exists in the materialized baseline of the declared `--baseline` version, `generator:adopt` SHALL set `manifest.managedFiles[rel].baselineHash` to `hashFileContent(baselineContent)` (canonical), SHALL set `strategy` to `getFileStrategy(rel)` (not always `managed`), and SHALL report divergence as `customized` vs `intact` without persisting the local hash as if it were canonical. The manifest SHALL NOT contain a `currentHash` field unless the schema explicitly supports it.

#### Scenario: Customized file retains canonical hash
- **WHEN** baseline contains `apps/api/src/app.ts` with hash `sha256:aaa` but local file has `sha256:bbb`
- **THEN** adopt writes `baselineHash: sha256:aaa` for that path, reports `customized: apps/api/src/app.ts`, and future `diff` correctly classifies upstream change as `conflict`

#### Scenario: Intact file stores canonical hash
- **WHEN** local file equals baseline content
- **THEN** adopt writes `baselineHash` equal to that canonical hash and reports no divergence for that file

#### Scenario: Strategy reflects file type
- **WHEN** adopt processes `package.json`
- **THEN** its entry has `strategy: "structured"` not `managed`

### Requirement: Adopt validates baseline materializability

`generator:adopt` SHALL accept only a `--baseline` version that can be materialized from the current checkout (either the verified canonical version or a snapshot/fixture that truly represents that historical tag). If the requested baseline cannot be materialized, it SHALL fail with a clear error, SHALL NOT create `.api-starter/manifest.json`, and SHALL NOT claim the result represents a historical version it did not materialize.

#### Scenario: Unmaterializable baseline is rejected
- **WHEN** `generator:adopt -- --project=/tmp/legacy --baseline=0.10.1` runs but `materializeToTemp` only produces the `0.11.0` checkout
- **THEN** adopt exits non-zero stating baseline `0.10.1` is not materializable from current checkout and no manifest is written (or caller must provide fixtures/snapshot to support it)

#### Scenario: Adopt supports only canonical version when no snapshot
- **WHEN** only canonical `0.11.0` is materializable and `--baseline=0.11.0` is given
- **THEN** adopt succeeds using that canonical tree; any other `--baseline` is rejected per above

### Requirement: Adopt handles missing expected files deterministically

If a file expected from the baseline is absent locally, `generator:adopt` SHALL report it as `missing: <rel>` and omit it from `managedFiles` (or explicitly handle per documented policy), so a future `update` does not silently add it back without surfacing intent.

#### Scenario: Missing expected file reported
- **WHEN** baseline has `apps/api/src/generated/foo.ts` but project deleted it
- **THEN** adopt reports `missing: apps/api/src/generated/foo.ts` and future `diff` shows `add` vs `conflict` per classification table without silently re-adding
