# Questions

Decisions that belong to a human, with a recommendation for each.

## Open

### Mermaid diagram rendering got stricter

`src/renderer/components/mermaid-block.tsx` changed from
`securityLevel: "loose"` to `"strict"`. Mermaid diagrams in this app come from
agent-authored markdown, including files read out of repositories the user did
not write, and `loose` lets a diagram embed raw HTML and bind click handlers
that run in the Electron renderer.

The cost is visible: a diagram label written as `<br/>` now displays the
literal characters instead of breaking the line, and `click` directives stop
working.

Options:

1. Keep `"strict"`. Mermaid's default. Untrusted diagram source cannot execute
   anything. Some labels lose formatting.
2. Use `"antiscript"`. HTML labels render, `<script>` is stripped. Keeps the
   formatting, but Mermaid's own docs describe it as weaker than `strict` and
   it still allows markup injection such as `<img onerror>`.
3. Use `"sandbox"`. Renders each diagram in an iframe. Strongest isolation, but
   adds an iframe per diagram, which costs memory and complicates the existing
   zoom and fullscreen controls.

Recommendation is option 1, which is what the branch does. Option 3 is worth
revisiting if users report broken labels, since mausCode's memory budget is a
stated product constraint and an iframe per diagram works against it.

Reversible with a one-line change. Nothing else depends on it.

## Not blocking, worth a decision soon

### Whether the two static analysis dashboards are both kept

SonarCloud reports 1836 open issues and DeepSource reports 4.7k active issues on
the same commit. They overlap on the React rules. Working both lists would
duplicate effort. Pick one as the gate and use the other for cross-checks.

### Product identity still says 1Code

`package.json` is `21st-desktop` version 0.0.72, description "1Code - UI for
parallel work with AI agents", author `21st.dev`, homepage `https://21st.dev`,
build `appId` `dev.21st.agents`, `productName` `1Code`, publish URL
`https://cdn.21st.dev/releases/desktop`. `CONTRIBUTING.md` is titled
"Contributing to 1Code". `CLAUDE.md` describes the product as "21st Agents".
`src/main/lib/config.ts` and `src/main/index.ts` both resolve the API base to
`https://21st.dev`. The deep link scheme is `twentyfirst-agents`.

This is the rebrand domain and it is untouched here. Naming, the URL scheme,
and the appId are user-facing and partly irreversible, since changing `appId`
orphan existing installs' local data.
