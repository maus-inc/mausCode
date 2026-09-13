---
name: Bug report
about: Something a user or an agent tried to do and the app did not do
title: "Bug: "
labels: bug
assignees: ""
---

<!--
Short on purpose. A bug report must let someone reproduce the defect, not explain it.
Fixes to a confirmed defect need a regression test that fails on the current tree, so
include the command or scenario that shows it failing. If the fix turns out to need a plan,
file it as a roadmap step instead and link it from here.
-->

## What happened

One paragraph. What you did, what the app did, what you expected instead.

## Reproduce

1.
2.
3.

Observed:

Expected:

## Environment

| Field | Value |
| --- | --- |
| Build | dev, `bun run dev`, or packaged version |
| OS | |
| Branch and SHA | |
| Engine path | legacy SDK, native runtime, or a compatibility agent |
| Provider and model | |

## Evidence

Paste or attach what the machine saw. Console output, main-process log lines, the tRPC
procedure and payload shape, a screenshot of the wrong surface. Redact tokens.

## Where it comes from

Only if you already traced it. Give `path:line` and the level you reached: read only,
consumer traced, reproduced, or reproduced with real user data. If you did not trace it,
write "untraced" and leave it to whoever picks this up.

## Related

Issues, roadmap steps, and the `.dump` file that already covers this area.
