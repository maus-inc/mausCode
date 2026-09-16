# 2026-09-16: the design skill set is vendored and mandated

Decision: UI and design work in this repository loads a fixed skill set before it
loads any code, the set lives in `.agents/skills/` as vendored content, and the
direction it needs arrives in a new root `DESIGN.md`. `AGENTS.md` carries the mandate,
`docs/design-skills.md` carries the routing and the limits, and `FULL-REVIEW.md`
section 15 makes review run the same check.

## What was installed

`npx skills add <owner>/<repo> -s '*' -a universal --copy -y`, one command per source,
33 new skills on top of the 6 already here. Each directory is upstream content,
byte-for-byte, and `skills-lock.json` records a folder hash per skill.

| Source | Commit | Skills |
| --- | --- | --- |
| `miqdadbadjuber/anti-slop` | `6eb854fb82c2b5eb9ed970669e59da037627c433` | `antislop`, `antislop-ui`, `antislop-copywriting`, `antislop-human`, `antislop-layoutmobile`, `antislop-code` |
| `pbakaus/impeccable` | `0a4e72a254f3b175c95b36b82e5f2e60fa63f116` | `impeccable`, with `reference/` (40 playbooks), `agents/`, `scripts/` |
| `emilkowalski/skills` | `85e8e2363b713506e1d5b6e07a0eb2da66be1bc3` | `animate`, `animate-expo`, `animation-vocabulary`, `apple-design`, `ask-sonner`, `emil-design-eng`, `find-animation-opportunities`, `improve-animations`, `mobile-native`, `pick-ui-library`, `prototype`, `review-animations`, `write-swift` |
| `nextlevelbuilder/ui-ux-pro-max-skill` | `15de38fb70bc80ae9276fa7703b48ae861a672e6` | `ui-ux-pro-max`, `ui-styling`, `design`, `design-system`, `brand`, `banner-design`, `slides` |
| `mblode/agent-skills` | `7042d4c8dd2ae63fc085c174a12e11965e61652d` | `ui-animation`, `ui-design`, `product-design`, `typography-audit`, `ui-verification`, `ax-audit` |

`ui-styling` ships 54 TTFs and `ui-ux-pro-max` ships a CSV and JSON database, so the
tree grew 15 MB across 649 files. They stay because both skills read those files as their rule
source, and a lean copy would break the reference paths. Nothing under `.agents/` is a
build input: `tsconfig.json` includes only `src/**/*`.

`npx antislop-ai` needs a TTY and exits 1 without one, so the install ran through the
package's own exported functions, `installSkills` and `updatePointers`, with these
answers: all six skills, project scope, the Antigravity target. That target is
`.agents/skills/`, which is where this repository keeps skills, and the block it
appended to `AGENTS.md` sits inside the `<!-- antislop:start -->` markers so a later
upstream install replaces it. The npm tarball publishes the same bodies with CRLF
endings; the GitHub copies are LF, and the LF copies are what shipped.

## What was refused

- `google-labs-code/stitch-skills`. `stitch::extract-design-md`, `code-to-design` and
  `generate-design` declare `stitch*:*` MCP tools and `web_fetch` in `allowed-tools`
  and drive a hosted service. A design path in this repository does not call a host we
  do not control, so the skills stay out and `DESIGN.md` was authored from source
  instead. Recorded per the refusal rule in `AGENTS.md`.
- `nextlevelbuilder`'s remote generators inside `design`, `banner-design`, `slides`
  and `brand`: `GEMINI_API_KEY`, `MUAPI_API_KEY`, Atlas Cloud. The skill bodies stay,
  the calls are out of bounds, and the limit is written into `docs/design-skills.md`.
- `impeccable`'s setup step. `skill/scripts/impeccable` is a launcher that `curl`s a
  release binary on first run, so it is never executed here. The skill's `SKILL.md`
  and `reference/` carry the value without it.
- Brand DESIGN.md libraries: `VoltAgent/awesome-design-md`,
  `kwakseongjae/oh-my-design`, `SpaceZephyr/brand-design-md`, `arumwu/design-md-skill`
  and 14 smaller ones found by search. They ship another company's identity as a
  default, which is the opposite of `docs/design-system-baseline.md`.
- `bergside/awesome-design-skills`. An index of preview images; the skills sit behind
  `npx typeui.sh pull`, which fetches from a host outside this project.
- 20 of the 26 `mblode/agent-skills`, the non-UI ones: `pr-*`, `autoship`, `seo`,
  `docs-writing`, `scaffold-*`, `agents-md`, `save-md`, `chat-history`, `tidy`,
  `dx-audit`, `readme-creator`, `presentation-creator`, `eli5`,
  `codebase-architecture`, `multi-tenant-architecture`, `agent-skills-creator`.
  The user scoped this to UI and design. A step that needs one installs it then.

## Lock verification and a finding

`computedHash` is a folder hash, sha256 over every file sorted by relative path, path
then bytes. The old `AGENTS.md` wording implied a `SKILL.md` hash, and no command
checked any of it, so `scripts/ci/verify-skills.mjs` plus `npm run skills:verify` now
owns that check.

Running it found drift that predates this change: `vercel-react-best-practices` and
`vercel-composition-patterns`, installed 2026-09-13, did not match their recorded
hashes. Cause, verified against `vercel-labs/agent-skills` at `main`: upstream added
`metadata.json` to each skill folder and the lock hashes were refreshed against that
tree, while `--copy` left the two local folders without the file. Both `metadata.json`
files are restored, so all 37 locked entries verify. Evidence: E3, `node
scripts/ci/verify-skills.mjs` run on this tree, and E1, a clone of
`vercel-labs/agent-skills` at `main` compared file by file.

`unslop` and `find-skills` have no lock entry and never will, so the checker warns on
them instead of failing. `unslop` is `cursor/plugins` `pstack/skills/unslop` at
`c1c0a32802223f4be824112dd83d33ad29a8b26c` with one deliberate local edit: the
`disable-model-invocation: true` key is dropped and an `Invocation` section added, so
every chat loads it. Upstream is otherwise identical, verified by diff. That edit is
the reason a hash check would fail if someone ever locks it, and it stays.

## The two defects this pass found in the design source

- `src/renderer/components/ui/button.tsx` `brand` variant reads
  `--primary-gradient-start` and `--primary-gradient-end`. Neither is defined anywhere
  in the repo, so the gradient resolves to nothing. Out of scope here, so it is
  recorded rather than fixed.
- `globals.css` sets `--primary: 228 100% 50%`, which is `#0033ff`. The comment beside
  it claims `#0034FF`. The token is normative and the comment is one unit off.

Both are noted in `DESIGN.md` so a later step fixes the source and the document in the
same commit.
