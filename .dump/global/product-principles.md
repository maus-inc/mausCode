# Product principles

Durable statement of what mausCode optimises for. `AGENTS.md` carries the binding rules;
this file carries the reasons, so a rule can be argued with evidence rather than taste.

1. **Local-first is the product, not a mode.** Everything works with no control plane, no
   account and no network. Hosted features are additive and env-gated. A change that makes a
   local path depend on a remote service is rejected on sight.
2. **Performance is a reviewable claim.** Startup, memory, render cost, turn latency and
   file weight are measured, recorded in `.dump/<domain>/benchmarks/`, and defended by a
   baseline. A perf adjective with no number is not an argument. The runtime inherits
   upstream numbers, single session around 27.8 MB and time-to-first-frame around 14 ms, and
   must not regress them.
3. **One product, one identity.** `src/shared/app-identity.ts` is the only source of
   product naming. Inherited names appear in provenance files and read-only legacy detection,
   never in user-visible strings.
4. **The agent may not widen its own authority.** Approvals, sandbox, egress and credential
   scope change only through the capability manifest in `docs/backend-porting-recipe.md`
   §7, and `bypassPermissions` is never portable. Deny by default for destructive, network
   and exfiltration classes.
5. **Unattended work needs evidence.** A background or scheduled run may not declare success.
   It ships a changeset, a test result or a log excerpt, and it may only accumulate memory,
   never rewrite or delete what a user recorded.
6. **Root causes, not patches.** A fix that hides a symptom is a second defect waiting to
   happen. Name the mechanism, fix the owner of the behaviour, delete what is dead.
7. **The tree is the truth.** When a document disagrees with the code, the code wins and the
   same change corrects the document.
8. **Memory is a feature of the repository.** `.dump` is durable engineering memory. Read it
   before you decide, write it after you decide, and delete it when it rots.
