# Decision: OpenSpec changes scaffolded manually (CLI unavailable)

Date: 2026-09-11. Status: accepted, revisit when the CLI is obtainable.

## Finding

The `openspec` CLI is not installed in this environment and cannot be installed from
any verified source right now: npm `openspec` is a stub (0.0.0), `@openspec/cli`
does not exist, and `github.com/openspecio/openspec` (the URL in the npm stub's
metadata) returns 404.

## Decision

Scaffold OpenSpec changes by hand following `openspec/AGENTS.md` exactly
(`proposal.md`, `tasks.md`, `design.md` where needed, `specs/<capability>/spec.md`
with `## ADDED|MODIFIED|REMOVED Requirements` and one `#### Scenario:` minimum per
requirement). Every change's `tasks.md` carries a validation task for an environment
with the CLI.

## Consequence

`openspec validate --strict` has not been run for `add-runtime-protocol-v0`. The
proposal's format was matched to the documented conventions by hand; CI or a dev
machine with the real CLI must validate before the change is archived.
