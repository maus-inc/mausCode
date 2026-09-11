# RE-RECORD — mausCode

**Owner: human (product owner). Do not ship these as-is.**

The three demo GIFs below are screen recordings of the **1Code** UI — the old
product name and 1Code branding are baked into the footage. A logo or string
swap cannot fix them; they must be re-recorded on a ready mausCode release
(first release where the app is visually final: logo, themes, onboarding).

| File | Content (as recorded in 1Code) |
|---|---|
| `worktree.gif` | Worktree/workspace flow; "1Code" wordmark visible in sidebar |
| `plan-mode.gif` | Plan-mode demo |
| `cursor-ui.gif` | Editor integration demo |

Status as of 2026-09-11: files are still referenced nowhere in `src/` — they
are staged assets. When re-recording:

1. Record at 2x on a retina-equivalent display, dark theme as primary.
2. Replace in place (same filenames) so any future import path keeps working.
3. Delete this file once all three are mausCode recordings.
