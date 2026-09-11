# DeepSource performance and antipattern categories

Recorded 2026-09-11.

## What is publicly enumerable, and what is not

DeepSource reports 4.7k active issues for this repository: 4.2k antipattern,
288 performance, 8 security. Only the security category is readable without a
session. The issues page renders its totals server-side, but filtered lists and
per-occurrence pages redirect to login, and there is no public API.

The checker directory at deepsource.com/directory/javascript is public and
lists all 470-plus checkers, but it does not group them by category. Telling
which of the 288 performance findings apply to this repository would mean
opening each checker page to read its category, then grepping for its pattern.
Guessing rule IDs from memory is worse than saying the boundary exists.

## What was checked locally instead

The performance patterns DeepSource flags most often were searched for directly
across `src/`. All of them came back empty.

| pattern | check | result |
| --- | --- | --- |
| `document.write` | grep | none |
| synchronous `XMLHttpRequest` | grep for `new XMLHttpRequest` and 3-arg `open(..., false)` | none |
| `eval` and `new Function` | grep | none |
| `JSON.parse(JSON.stringify(...))` deep clone | grep | none |
| `.bind(this)` in render | grep across renderer tsx | none |
| `for...in` over arrays | grep | none |

One `new RegExp` appears in `src/renderer/features/mentions/search/cache.ts`,
built from an escaped pattern inside a cached lookup. It is not in a hot loop.

So the 288 performance findings are unlikely to be the classic browser
performance set. The plausible remainder is React-specific, such as inline
function and object literals in JSX and missing memoisation. Those need the
actual occurrence list to fix correctly, because fixing them by hand across
4.2k antipattern findings would be churn without a way to confirm the count
moved.

## What would unblock this

A logged-in session on app.deepsource.com, or the project's DeepSource API
token, would give the per-occurrence list with file and line. With that, the
288 performance findings are enumerable and can be fixed and re-verified the
same way the security ones were.

## Security category, for contrast

The 8 JS-0440 findings were enumerable by grep, because JS-0440 flags every
`dangerouslySetInnerHTML` and nothing else. The grep count of 8 across 6 files
at `origin/main` matched DeepSource exactly, which is what made it safe to work
from grep alone. Six are now removed. The two that remain are the mermaid SVG
injection points, which carry a skipcq with the reason inline.
