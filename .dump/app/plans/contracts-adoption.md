# Vendored contracts adoption ledger

**Status: living document.** Update the table in the same commit that changes a row. Measured
2026-09-14 in this working tree.

## 0. Why this file exists

`src/shared/contracts/` is a verbatim port of `pingdotgg/t3code/packages/contracts` (MIT, (c) 2026
T3 Tools Inc.), kept so the engine and feature ports have one vocabulary to land on. Until the human
settled the policy it read as dead weight: 0 importers outside the directory, and two competing
recommendations in the plan corpus, delete versus adopt per use. Ratified 2026-09-13:
**keep, absorb, and verify by document.** Most files are expected to be consumed by the ports, so the
job is to make each absorption visible rather than to delete the schemas on a count.

## 1. Measured shape

| Measure | Value | How to re-measure |
| --- | --- | --- |
| Files in `src/shared/contracts/` | 67 | `ls src/shared/contracts/*.ts \| wc -l` |
| Source files | 44 | same, minus `*.test.ts` |
| Source lines | 19,439 | `wc -l` over the same set |
| Test files | 23 | `ls src/shared/contracts/*.test.ts \| wc -l` |
| Test lines | 5,488 | same |
| Total lines | 24,927 | `wc -l src/shared/contracts/*.ts \| tail -1` |
| Importers outside the directory | 0 | the script in §4 |
| Tests that run | all 23 files | `vitest.config.ts` includes `src/**/*.test.ts`, excludes only `src/main/lib/runtime/*` |
| Declared dependency the schemas need | `effect@4.0.0-rc.112` in `package.json` `dependencies` | `node -p "require('./package.json').dependencies.effect"` |

Two facts change the delete-versus-keep arithmetic, and both were found while measuring rather than
arguing. First, the 23 `*.test.ts` files are inside `src/`, so `npm run test` already runs them: the
tree is not inert, it is a 5,488-line schema-validation corpus that keeps the ported definitions
parseable against the pinned `effect` version. Second, deleting the directory would delete that
coverage as a side effect, which is the wrong way to lose tests.

## 2. Adoption map

`internal refs` counts files in this directory that import the row, so a high number means the row is
load-bearing for the rest of the vocabulary, not that our app uses it. `Adopted by` names the roadmap
step expected to consume it, from `.dump/app/plans/2026-09-13-mauscode-roadmap.md`; `none yet` means no
step touches that domain today, so it stays available vocabulary and is adopted only when a step needs
the type, never for completeness.

| File | Lines | Internal refs | Adopted by |
| --- | --- | --- | --- |
| `agentSessions.ts` | 121 | 3 | step 17, step 19, step 26 |
| `assets.ts` | 300 | 4 | step 25, step 31 |
| `assistantCitations.ts` | 36 | 1 | step 9 |
| `auth.ts` | 359 | 5 | step 45 |
| `background.ts` | 115 | 4 | step 7, step 8 |
| `baseSchemas.ts` | 175 | 42 | step 3 |
| `browserImport.ts` | 170 | 2 | step 33, step 34 |
| `browserProfile.ts` | 104 | 6 | step 33, step 34 |
| `desktopAppActivation.ts` | 58 | 2 | step 32, step 33 |
| `desktopBootstrap.ts` | 29 | 1 | step 3, step 32 |
| `device.ts` | 551 | 3 | step 33, step 34 |
| `editor.ts` | 228 | 4 | step 18, step 25 |
| `environment.ts` | 218 | 10 | step 33, step 34 |
| `environmentHttp.ts` | 627 | 2 | step 27, step 33 |
| `filesystem.ts` | 72 | 4 | step 25, step 36 |
| `git.ts` | 465 | 5 | step 14, step 21 |
| `index.ts` | 48 | 0 | step 3 |
| `ipc.ts` | 1602 | 3 | step 3, step 12 |
| `keybindings.ts` | 193 | 5 | step 6 |
| `model.ts` | 229 | 4 | step 12, step 35 |
| `orchestration.ts` | 2252 | 12 | step 19, step 20 |
| `preview.ts` | 359 | 6 | step 18, step 25 |
| `previewAutomation.ts` | 952 | 4 | step 21, step 36 |
| `project.ts` | 302 | 4 | step 15, step 31 |
| `provider.ts` | 159 | 3 | step 12, step 35 |
| `providerInstance.ts` | 154 | 18 | step 12, step 35 |
| `providerRuntime.ts` | 1291 | 3 | step 12, step 35 |
| `providerSetup.ts` | 91 | 2 | step 11, step 35 |
| `providerUsageLimits.ts` | 172 | 4 | step 36 |
| `pullRequest.ts` | 1266 | 6 | step 13, step 15, step 16 |
| `relay.ts` | 1126 | 2 | step 33, step 34 |
| `relayClient.ts` | 68 | 2 | step 33, step 34 |
| `remoteAccess.ts` | 73 | 2 | step 34 |
| `resourceTelemetry.ts` | 526 | 2 | step 41 |
| `review.ts` | 58 | 3 | step 25 |
| `rpc.ts` | 1416 | 2 | step 3, step 12 |
| `server.ts` | 866 | 3 | step 3, step 12 |
| `settings.ts` | 1409 | 6 | step 4, step 11, step 25 |
| `sourceControl.ts` | 192 | 5 | step 14, step 21 |
| `t3ProjectFile.ts` | 100 | 2 | step 15, step 31 |
| `terminal.ts` | 386 | 4 | step 18, step 26 |
| `usage.ts` | 219 | 2 | step 36 |
| `usageLimitSourceId.ts` | 14 | 3 | step 36 |
| `vcs.ts` | 288 | 5 | step 14, step 21 |

## 3. Rules that follow from the policy

- A step that needs one of these types imports it and changes its row from `step NN` to
  `step NN (adopted, YYYY-MM-DD)`. The row is the audit trail; a PR that adopts types and does not
  update this file has an incomplete change.
- An adopted file must be reconciled with our naming rules: `global/naming.md` is the authority, and
  T3 identifiers survive only inside comments and licence headers, per the verbatim-port rule in
  `docs/backend-porting-recipe.md` §0.
- Never edit an unadopted file to satisfy a lint or a style preference. It is a vendored copy; its
  shape is upstream's, and churn here destroys the ability to diff against the source.
- Do not delete a file because its importer count is 0. The count is the point of the ledger, not a
  verdict.
- The `*.test.ts` files are ported tests and stay faithful to upstream. If a test disagrees with our
  intended behaviour, that is a porting decision to record in `.dump/app/decisions/`, not a test to
  rewrite in place.

## 4. Re-measuring

Run this from the repository root. It prints per-file line counts, external importers and internal
references, and is the same measurement that produced the table above.

```sh
node - <<'JS'
const fs = require("fs"), path = require("path");
const dir = "src/shared/contracts";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts")).sort();
const all = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) all.push(p);
  }
})("src");
const ext = Object.fromEntries(files.map((f) => [f, 0]));
for (const p of all) {
  const src = fs.readFileSync(p, "utf8");
  for (const imp of src.match(/from\s+"[^"]*contracts\/[A-Za-z0-9_.\-]+"/g) || []) {
    const name = imp.match(/contracts\/([A-Za-z0-9_.\-]+)"/)[1];
    if (name in ext && !p.startsWith(dir)) ext[name] += 1;
  }
}
for (const f of files) console.log(`${f}\t${ext[f]}`);
JS
```

A non-zero external count is the only state that proves a row is live. Record the date in §1 when the
numbers move.

## 5. Open rows

- `filesystem`, `editor`, `terminal`, `preview`, `settings`, `project` and `t3ProjectFile` are mapped to
  candidate owners, not confirmed ones. The steps that own those surfaces should either adopt the row or
  record why the local type stays, in `.dump/app/decisions/`.
- If a future audit decides the vocabulary is genuinely unwanted, the removal is one commit here plus
  the typecheck delta in `.dump/app/benchmarks/`, not a per-file argument.
