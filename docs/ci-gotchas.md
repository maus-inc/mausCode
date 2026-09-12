# CI / lint gotchas (learned 2026-09-11, biome 2.5.x)

## Never put comments in `biome.json`

Biome silently ignores the whole config file when it contains `//` comments:
no config error is printed, defaults take over (semicolons forced, every
recommended rule becomes an error). Keep `biome.json` strict-JSON. Put rule
justifications in suppression comments at the usage site, or in this file.

## No suppression comment can precede an `asChild` slot child

`{/* biome-ignore ... */}` between a Radix `asChild` trigger and its element
is a second child at runtime: `Children.only` throws and the UI crashes
(verified with `React.Children.only([undefined, el])`). And `//` comments are
JSX text there, so they break the slot too. For the two current cases
(`agents-sidebar.tsx` chat rows) the rule is demoted to `warn` via a
`biome.json` override instead. Same reason: never put `{/* */}` between
`return (` and the returned element (parse error) — use `//` there.

## `noAssignInExpressions` vs the `while ((m = re.exec(s)))` idiom

Biome's rule is stricter than ESLint's `no-cond-assign`: the double-paren
regex-loop idiom must be restructured to prime-before-loop plus re-assign at
the loop tail. Six sites converted 2026-09-11; keep the pattern for new loops.
