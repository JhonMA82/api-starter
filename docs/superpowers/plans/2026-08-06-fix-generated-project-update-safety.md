# fix-generated-project-update-safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproducibly verify O1–O8 and fix confirmed gaps so `generator:diff` / `generator:update` / `generator:adopt` share a single canonical version truth, enforce registry sequencing, preserve structured merges, validate with rollback, and document only real behavior.

**Architecture:** Keep the existing three-way compare engine as primary; add a thin `starter-version` authority, a validated `resolveTargetVersion` gate, registry path authority on top of `buildUpdatePlan`, an explicit structured dispatcher that fails closed, corrected `adopt` hashing, and an allow-list validation runner with atomic backups. No remote fetch, no runtime coupling.

**Tech Stack:** Bun 1.3.14, TypeScript 7.0.2, Hono/better-auth (untouched), `node:fs` + `node:child_process.execSync` with timeout, SHA-256 hashing, Biome, `bun test`.

---
change: fix-generated-project-update-safety
design-doc: docs/superpowers/specs/2026-08-06-fix-generated-project-update-safety-design.md
base-ref: 16d8820b6631a25963da9b9ae05dac453b5be9d2
---

## Global Constraints

- `packageManager: bun@1.3.14`, `.bun-version=1.3.14`, exact pins (no `^`).
- `bun.lock` never hand-edited; `bun install --frozen-lockfile`.
- Domain ← application ← http dependency direction; `modules/*` no `@consulting/auth` import.
- Errors RFC 9457 with `code`/`requestId`/`instance`, no stack leak.
- No `api-starter` runtime dep in generated projects; `apps/api/src/server.ts` only Bun touch.
- Dry-run never mutates; manifest bump only after all steps+validations; second run idempotent.
- No global `--force`.

## File Structure Decisions

- New: `generator/src/starter-version.ts` – canonical root/version helpers; consumed by `manifest.ts`, `registry.ts`, `diff/update/adopt`.
- Modified: `generator/src/manifest.ts` (delegate, drop fallback), `generator/updates/registry.ts` (derive STARTER_VERSION), `generator/src/file-strategies.ts` (dispatcher + throw), `generator/src/update-plan.ts` (manual-migration + unsupported structured → conflict), `generator/src/diff-project.ts` + `update-project.ts` (version gate + registry surface + dispatch), `generator/src/adopt-project.ts` (canonical hash + materializable guard), optional `generator/src/validate-post.ts` (allow-list runner extracted from update-project).
- Docs: `docs/verification-generated-project-update-vnext.md` (matrix), `docs/updating-generated-projects.md` (honesty).
- Tests: `generator/tests/version-truth.test.ts`, `registry-integration.test.ts`, `file-strategies.test.ts`, `adopt.test.ts`, `post-validations.test.ts`, `version-sync.test.ts`, `e2e-update.test.ts`, helper `generator/tests/helpers/tmp-project.ts`.

### Task 1: Baseline snap and verification harness

**Files:**
- Create: `docs/verification-generated-project-update-vnext.md` (skeleton)
- Create: `generator/tests/helpers/tmp-project.ts`
- Modify: none yet

**Interfaces:**
- Consumes: git/package.json state
- Produces: verification report path, helper `createTempProject({profile,features,version}) -> {dir, manifest}` + `hashFile`, `assertNoWrites`

- [ ] **Step 1: Record baseline state**

Collect in verification doc preamble:
```bash
git status --short; git branch --show-current; git log -1 --oneline; cat package.json | grep version; bun --version
bun run generator:validate; bun run lint; bun run typecheck; bun test 2>&1 | tail -n 50
```
Commit skeleton with table header `| ID | Observation | State | Evidence | Action |`.

- [ ] **Step 2: Implement tmp-project helper**

`generator/tests/helpers/tmp-project.ts` exports:
```ts
export function createTempProject(opts:{profile:string,features:string[], version?:string}): {dir:string, manifest:Manifest}
export function cleanup(dir:string): void
export function writePersonalization(dir:string, patch:{packageJson?:object, env?:string, files?:Record<string,string>}): void
```

- [ ] **Step 3: Verify baseline passes**

Run `bun test generator/tests/helpers --run` expecting helpers load cleanly.

- [ ] **Step 4: Commit**

```bash
git add docs/verification-generated-project-update-vnext.md generator/tests/helpers/tmp-project.ts
git commit -m "chore: verification harness and baseline for update safety"
```

### Task 2: Canonical version source (O1, O7)

**Files:**
- Create: `generator/src/starter-version.ts`
- Modify: `generator/src/manifest.ts:1-80`, `generator/updates/registry.ts:1-10`

**Interfaces:**
- Consumes: `package.json` at starter root
- Produces: `getCanonicalStarterVersion(): string`, `getStarterRoot(): string`, `resolveTargetVersion(userTo?: string): string`

- [ ] **Step 1: Write failing test `version-truth.test.ts` for fallback removal**

```ts
import { expect, test } from "bun:test"
import { getCanonicalStarterVersion } from "../src/starter-version"
test("getCanonical matches package.json", () => {
  const v = getCanonicalStarterVersion()
  const pkg = JSON.parse(await Bun.file("package.json").text())
  expect(v).toBe(pkg.version)
})
```

Run: `bun test generator/tests/version-truth.test.ts` -> FAIL (module missing).

- [ ] **Step 2: Implement `starter-version.ts`**

```ts
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"
export function getStarterRoot(): string {
  const viaImport = fileURLToPath(new URL("../../", import.meta.url))
  if (existsSync(path.join(viaImport,"package.json"))) return viaImport
  try { return execSync("git rev-parse --show-toplevel",{encoding:"utf8"}).trim() } catch { return process.cwd() }
}
export function getCanonicalStarterVersion(): string {
  const pkgPath = path.join(getStarterRoot(),"package.json")
  const raw = readFileSync(pkgPath,"utf8")
  const v = (JSON.parse(raw) as {version?:string}).version
  if(!v) throw new Error("starter version missing")
  return v
}
export function resolveTargetVersion(userTo?: string): string {
  const canonical = getCanonicalStarterVersion()
  if(!userTo) return canonical
  if(userTo !== canonical) throw new Error(`version mismatch: --to ${userTo} != canonical ${canonical}`)
  return canonical
}
```

- [ ] **Step 3: Update `manifest.ts` to delegate and drop fallback**

Replace `getStarterVersion()` body with `return getCanonicalStarterVersion()` and `createManifest` fallback `"0.10.1"` with canonical or throw.

- [ ] **Step 4: Update `registry.ts` STARTER_VERSION**

```ts
import { getCanonicalStarterVersion } from "../src/starter-version"
export const STARTER_VERSION = getCanonicalStarterVersion()
```

Add guard if import circular, use lazy.

- [ ] **Step 5: Run test**

`bun test generator/tests/version-truth.test.ts` -> PASS

- [ ] **Step 6: Commit**

```bash
git add generator/src/starter-version.ts generator/src/manifest.ts generator/updates/registry.ts generator/tests/version-truth.test.ts
git commit -m "fix: canonical version source, remove fallback"
```

### Task 3: Wire --to validation into diff/update (O1)

**Files:**
- Modify: `generator/src/diff-project.ts: parseArgs + main`, `generator/src/update-project.ts: parseArgs + main + imports`

**Interfaces:**
- Consumes: `resolveTargetVersion`
- Produces: `toVersion === canonical` in JSON/human/manifest

- [ ] **Step 1: Write failing test for mismatch rejection**

```ts
test("diff --to mismatch fails read-only", async () => {
  const {dir}= createTempProject({profile:"minimal",features:[]})
  const preHashes = hashDir(dir)
  const proc = Bun.spawn(["bun","generator/src/diff-project.ts","--project",dir,"--to","99.0.0","--json"],{stdout:"pipe", stderr:"pipe"})
  await proc.exited
  expect(proc.exitCode).not.toBe(0)
  expect(hashDir(dir)).toEqual(preHashes)
})
```

Expected FAIL (still accepts 99.0.0).

- [ ] **Step 2: Patch diff-project.ts**

Make `--to` optional; early `const canonical = resolveTargetVersion(to)` before `materializeToTemp`; use `canonical` for all outputs including `toVersion: canonical` and `buildUpdatePlan` toVersion override.

- [ ] **Step 3: Patch update-project.ts similarly**, ensure manifest bump uses `canonical`.

- [ ] **Step 4: Run version-truth suite**

`bun test generator/tests/version-truth.test.ts` now passes mismatch case.

- [ ] **Step 5: Commit**

```bash
git add generator/src/diff-project.ts generator/src/update-project.ts generator/tests/version-truth.test.ts
git commit -m "fix: bind --to to canonical, reject mismatches"
```

### Task 4: Registry path integration (O2)

**Files:**
- Modify: `generator/src/diff-project.ts`, `generator/src/update-project.ts`, `generator/src/update-plan.ts` (metadata passthrough), `generator/updates/registry.ts` (test fixtures exposure if needed)
- Create: `generator/tests/registry-integration.test.ts`

**Interfaces:**
- Consumes: `resolveUpdatePath`
- Produces: `updatePath` in JSON, blocking semantics, ordered execution

- [ ] **Step 1: Write failing test for missing path**

```ts
test("diff with missing path fails", async () => {
  // stub UPDATES to only 0.10.1->0.11.0, then request 0.9.0->0.11.0 via manifest version 0.9.0 fixture
})
```

- [ ] **Step 2: Implement registry calls**

In `diff-project.ts` after version resolve:
```ts
import { resolveUpdatePath } from "../updates/registry"
const updatePath = resolveUpdatePath(manifest.starter.version, canonical)
```
If throws, emit `valid:false` with error and exit 1. Include `updatePath: updatePath.map(u=>({id:u.id,from:u.from,to:u.to,breakingNotes:u.breakingNotes,requiresManual:u.requiresManual,postValidations:u.postValidations}))` in JSON and human lines.

In `update-project.ts` apply path: check `requiresManual` and `updatePlan.files.some(f=>f.classification==="manual-migration")` → block. Loop `for(const u of updatePath){ if(u.plan) ... }` collect.

- [ ] **Step 3: Dedupe appliedUpdates**

```ts
const ids = updatePath.map(u=>u.id)
const nextApplied = [...new Set([...manifest.appliedUpdates, ...ids])]
```

Write only after validations.

- [ ] **Step 4: Run registry-integration tests**

`bun test generator/tests/registry-integration.test.ts` -> PASS (cases: empty, missing, downgrade, manual block, rollback via injected throw, dedup)

- [ ] **Step 5: Commit**

```bash
git add generator/src/diff-project.ts generator/src/update-project.ts generator/tests/registry-integration.test.ts
git commit -m "fix: integrate registry path, block incomplete/manual"
```

### Task 5: Structured dispatch (O3)

**Files:**
- Modify: `generator/src/file-strategies.ts`, `generator/src/update-project.ts`, `generator/src/update-plan.ts`

**Interfaces:**
- Consumes: `mergePackageJson`, `mergeEnvExample`
- Produces: `applyFileOperation(opts)` throwing on unsupported

- [ ] **Step 1: Write failing test for preserve**

```ts
test("package.json merge preserves local script", () => {
  const cur = JSON.stringify({name:"x", scripts:{mine:"echo hi"}, dependencies:{lodash:"1.0.0"}},null,2)
  const next = JSON.stringify({dependencies:{"@consulting/auth":"2.0.0", lodash:"1.0.0", "drizzle-orm":"0.45.2"}},null,2)
  const out = JSON.parse(mergePackageJson(cur,next))
  expect(out.scripts.mine).toBe("echo hi")
})
```

Currently `update-project` still copies, test for copy path fails.

- [ ] **Step 2: Fix `mergePackageJson` to throw on parse error**

Replace `catch { return nextContent }` with `throw new GenerationError("invalid JSON")`.

- [ ] **Step 3: Add dispatcher**

```ts
export function applyFileOperation({operation, projectPath, canonicalPath}: ApplyOpts){
  if(operation.strategy==="structured"){
    if(projectPath.endsWith("package.json")) { /* merge */ }
    else if(projectPath.endsWith(".env.example")) { /* mergeEnv */ }
    else throw new GenerationError(`unsupported structured file ${operation.path}`)
  } else { copyFileSync(canonicalPath, projectPath) }
}
```

- [ ] **Step 4: Update `update-plan.ts` to emit conflict for unsupported structured**

If `getFileStrategy(rel)==="structured"` and not in allow-list, push `conflict` with reason `"no safe merger for structured file"` otherwise classify normal.

- [ ] **Step 5: Wire in `update-project.ts`** replace copy for `update-safe` with dispatcher + hash final content.

- [ ] **Step 6: Run suite**

`bun test generator/tests/file-strategies.test.ts` PASS.

- [ ] **Step 7: Commit**

```bash
git add generator/src/file-strategies.ts generator/src/update-plan.ts generator/src/update-project.ts generator/tests/file-strategies.test.ts
git commit -m "fix: structured dispatch failing closed"
```

### Task 6: Adopt correctness (O4)

**Files:**
- Modify: `generator/src/adopt-project.ts`
- Create: `generator/tests/adopt.test.ts`

**Interfaces:**
- Consumes: `getCanonicalStarterVersion`, `getFileStrategy`
- Produces: correct `baselineHash`+`strategy`, materializable guard

- [ ] **Step 1: Write failing test for hash**

Create baseline temp, modify one file, adopt with --baseline canonical, assert manifest entry equals baseline hash not local.

- [ ] **Step 2: Fix adopt**

Change `managedFiles[rel] = {baselineHash: projectHash}` to `baselineHash` canonical, `strategy: getFileStrategy(rel)`. Add guard `if(baseline !== getCanonicalStarterVersion()) throw new GenerationError("baseline ... not materializable")`.

- [ ] **Step 3: Report missing**

Ensure missing loop reports and skips managedFiles.

- [ ] **Step 4: Run**

`bun test generator/tests/adopt.test.ts` PASS.

- [ ] **Step 5: Commit**

```bash
git add generator/src/adopt-project.ts generator/tests/adopt.test.ts
git commit -m "fix: adopt stores canonical hash and strategy"
```

### Task 7: Post-validations & rollback (O5)

**Files:**
- Create: `generator/src/validate-post.ts` (or inline in update-project)
- Modify: `generator/src/update-project.ts`
- Create: `generator/tests/post-validations.test.ts`

**Interfaces:**
- Consumes: projectDir, extraIds from registry
- Produces: `{ok, failedId, output}` with timeout

- [ ] **Step 1: Write failing test for validation rollback**

Spawn temp project, inject type error file into canonical, run update --apply, expect rollback.

- [ ] **Step 2: Implement runner**

```ts
export const VALIDATIONS: Record<string,{cmd:string, required:"required"|"optional"} > = {
  typecheck:{cmd:"bun x tsc --noEmit", required:"required"},
  lint:{cmd:"bun run lint", required:"optional"},
  test:{cmd:"bun test --runInBand", required:"optional"},
}
export function runPostValidations(projectDir:string, extra:string[]): {ok:boolean, failed?:string} { ... execSync with timeout }
```

Dry-run guard: skip in diff and `update` without --apply.

- [ ] **Step 3: Wire into update apply**: union registry `postValidations` + base `["typecheck"]`, call runner, on `!ok` throw → rollback.

- [ ] **Step 4: Run**

`bun test generator/tests/post-validations.test.ts` PASS.

- [ ] **Step 5: Commit**

```bash
git add generator/src/validate-post.ts generator/src/update-project.ts generator/tests/post-validations.test.ts
git commit -m "fix: allow-list validations with rollback"
```

### Task 8: Version sync guard and DB honesty (O7/O8)

**Files:**
- Modify: `generator/updates/registry.ts`, `generator/src/update-plan.ts`
- Create: `generator/tests/version-sync.test.ts`
- Modify: `docs/updating-generated-projects.md`

**Interfaces:**
- Produces: sync guard, manual-migration classification

- [ ] **Step 1: Write failing sync test**

```ts
test("STARTER_VERSION sync", () => { expect(STARTER_VERSION).toBe(JSON.parse(readFileSync("package.json","utf8")).version) })
```

- [ ] **Step 2: In update-plan classify migrations/**

If `rel.startsWith("migrations/")` and `canonicalHash !== baselineHash` and `projectHash !== baselineHash` → `manual-migration`; same for `_journal.json`.

- [ ] **Step 3: Rewrite docs/updating...md** – state real --to source, list only package.json/.env.example merges, enumerate validations, add Limitations.

- [ ] **Step 4: Run**

`bun test generator/tests/version-sync.test.ts` PASS.

- [ ] **Step 5: Commit**

```bash
git add generator/updates/registry.ts generator/src/update-plan.ts generator/tests/version-sync.test.ts docs/updating-generated-projects.md
git commit -m "fix: version sync guard, manual-migration, docs honesty"
```

### Task 9: E2E full cycle + edges (O1–O8 verification)

**Files:**
- Create: `generator/tests/e2e-update.test.ts`

**Interfaces:**
- Consumes: tmp-project helper, diff/update/doctor binaries
- Produces: temp-dir evidence

- [ ] **Step 1: Write E2E test covering happy path + idempotence + rollback**

Steps: create fixture at canonical-1 fake version (use manifest override to simulate prior), personalize, doctor, diff assert, resolve conflict, update --apply assert merges/hashes/appliedUpdates/backup, repeat idempotence, inject validation failure via bad TS file and assert rollback.

- [ ] **Step 2: Add edge matrix within same file** (fictitious --to, downgrade, missing path, .env untouched, upstream-removed-but-customized, upstream-new-but-local-different, copy-fail rollback via mocked copyFileSync throw, subdirectory, JSON stability)

- [ ] **Step 3: Run**

`bun test generator/tests/e2e-update.test.ts --timeout 60000` -> PASS (may be skipped if external DB required branches marked)

- [ ] **Step 4: Commit**

```bash
git add generator/tests/e2e-update.test.ts
git commit -m "test: e2e update cycle and edge matrix"
```

### Task 10: Verification report population

**Files:**
- Modify: `docs/verification-generated-project-update-vnext.md`

- [ ] **Step 1: Fill O1–O8 rows with CONFIRMED/PART/REJECT and evidence lines (file:line, command output snippets, hashes)**

Example row:
```
| O1 | --to not bound | CONFIRMED | diff-project.ts:30, update-project.ts:78 via `bun run generator:diff --to 99.0.0` echoes 99 | canonical gate added in starter-version.ts |
```

- [ ] **Step 2: Run full verification command set and paste outputs**

`bun run generator:validate; bun run lint; bun x tsc --noEmit; bun test` -> log in report.

- [ ] **Step 3: Commit**

```bash
git add docs/verification-generated-project-update-vnext.md
git commit -m "docs: verification matrix O1-O8 with evidence"
```

### Task 11: Final validation and smoke

**Files:**
- Check: `git diff --check`, `git status --short`, `bun.lock` unchanged

- [ ] **Step 1: Run `bun run lint`, `bun x tsc --noEmit`, `bun test --coverage` clean** – record PASS.

- [ ] **Step 2: Manual smoke in temp root**

```bash
TMP=$(mktemp -d)
bun run create:project -- --profile minimal --output $TMP/smoke --force
bun run generator:doctor -- --project $TMP/smoke --json
bun run generator:diff -- --project $TMP/smoke --to $(jq -r .version package.json) --json
bun run generator:update -- --project $TMP/smoke --to $(jq -r .version package.json) --apply --json
bun run generator:diff -- --project $TMP/smoke --json  # idempotent
```

Verify no writes on dry-run, correct bump.

- [ ] **Step 3: No runtime dep grep**

`rg -n "api-starter" apps/api/src packages modules --glob '!*manifest*' || echo "clean"`

- [ ] **Step 4: Commit if docs touched, else no commit needed**

### Task 12: Guard and review

**Files:**
- none

- [ ] **Step 1: Ensure all tasks.md checked**

- [ ] **Step 2: Run `comet guard fix-generated-project-update-safety build --apply`**

- [ ] **Step 3: Request lightweight review (`review_mode: standard`) before verify**

