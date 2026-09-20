# Credential storage design options

## Approved direction

On 2026-09-20 the human selected the dedicated Credential storage settings page. Both options preserve existing reads and gate new, replacement, and refreshed writes, as the human already approved.

The comparison is [the local HTML prototype](2026-09-20-secret-storage-options.html). It contains no real keys, storage reads, persistence, remote scripts, or telemetry. All status values are labeled simulations. The theme and simulated keyring state can be changed, and the consent, cancellation, refusal, save-error, recovery, and consent-revocation paths can be explored.

| Direction | Mechanism | Trade-off |
| --- | --- | --- |
| Within Models, recommended | Put one app-wide credential-storage block above the existing model connection controls | Reuses the existing destination and keeps the decision near a save. The copy must explain that the policy also covers app sign-in and other credentials |
| Dedicated settings page | Add Credential storage to settings navigation | Gives the app-wide policy a clear destination and room for details. Adds navigation and separates the policy from provider setup |

The recommendation is design judgment, not a measured usability result.

## Design read

The operator needs to know why a credential cannot be saved, restore OS encryption when possible, and understand the consequence before permitting plaintext. The required interruption is the first decision to allow plaintext writes on this device. The default is refusal, not an enabled switch.

The design retains the existing desktop settings density, fonts, semantic colors, compact controls, and 8px settings-card radius. Taste dials are low variance, low motion, and high information density. The comparison does not change the product's identity or introduce a new visual system.

The fixed baseline is `DESIGN.md` and `docs/design-system-baseline.md`, especially sections 1, 2, 3.1, 3.6, and 3.8. Static CSS in the throwaway HTML transcribes those tokens. Application implementation must use the existing shared components and semantic classes instead of copying these raw values into app code.

## Common behavior

- Status names the actual failure or backend, not a blanket claim that all keys are encrypted.
- New-write policy is separate from the storage mode of existing records.
- One explicit confirmation names the device-wide permission, readable-file risk, persistence of consent, and the fact that revocation does not remove saved plaintext.
- Encryption wins whenever it is available. Consent is permission for fallback, not a request to disable encryption.
- Cancellation changes nothing. A failed consent save does not grant permission.
- Refusal preserves an unsaved entry in memory where the existing form remains open. It must not put the entry into localStorage.
- Existing encrypted data that cannot be decrypted stays on disk. It must not be treated as plaintext.
- A provider dialog must not open a second dialog. Implement an inline explanation or sequence the existing modal before the shared consent decision.
- An OS keyring becoming available does not imply that older plaintext was converted. The example plaintext row remains plaintext after recovery in the prototype.
- The confirmation uses the shared AlertDialog in application code. The standalone prototype uses native dialog semantics and explicitly returns focus to its trigger.

Product-design rules used include `rule/name-object-scope-consequence`, `rule/preserve-user-input`, `rule/no-nested-modals`, `rule/cover-reachable-states`, `rule/keyboard-complete-flow`, and `rule/smallest-intervention`.

## Research basis

The [research handoff](2026-09-20-step11-ownership-handoff-01a0c098.md) records the source inventory and primary-source pass.

- [Electron 39.4.0](https://raw.githubusercontent.com/electron/electron/v39.4.0/docs/api/safe-storage.md) requires the distinction between a usable OS keyring and Linux `basic_text`. It also limits the promise to platform-specific protection.
- [VS Code](https://code.visualstudio.com/docs/configure/settings-sync) provides precedent for keyring repair guidance and a warning about an explicit unprotected fallback.
- [JetBrains](https://www.jetbrains.com/help/idea/reference-ide-settings-password-safe.html) provides precedent for making password-storage policy findable in settings.
- [W3C](https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/examples/alertdialog/) informs confirmation naming, least-destructive initial focus, Escape, and focus restoration.

These are design references, not evidence that the prototype or final app has passed a browser test.

## Skill effects and overrides

- Antislop runs During. UI, human, copywriting, code, and layoutmobile rules prohibit fabricated status claims and require actual keyboard and viewport verification before shipping.
- Impeccable shape, operate, and craft-floor keep the interface task-focused. Craft-floor was revisited immediately before writing the prototype.
- Design-taste-frontend and redesign-existing-projects preserve the incumbent layout. Their marketing font swaps, texture, and large motion ideas do not apply to dense settings.
- UI UX Pro Max and product-design require a recovery path and named consequences.
- UI-design Options requires genuinely different placement choices. Its remote `ui.sh` toolbar and instruction to edit application files are refused. AGENTS requires a local `.dump` prototype before app edits.
- UI-design's Tailwind 4 utilities, 16px desktop body default, ellipsis character, replacement icon set, and larger default radii do not override this repository's Tailwind 3, typography, ASCII dots, shared icons, and radius baseline.
- Unslop applies to all visible strings and this record.
- UI-verification requires rendered evidence. A missing browser does not become a pass.
- No skill launcher, remote image generator, remote UI script, project dependency installation, or skill update ran.

## Evidence and remaining gates

The HTML source and JavaScript syntax can be inspected without application dependencies. The comparison is not an Electron run and does not establish that any credential write is protected.

The standalone prototype passed browser checks at widths 360, 800, and 1280 in light and dark themes. Consent, cancellation, Tab wrapping, Escape focus restoration, failed consent persistence, recovery labels, revocation, and horizontal overflow were checked. The probe caught and fixed a Tab-focus escape before rerunning the same assertions. Screenshots and results are in `secret-storage-prototype-evidence/`. The [verification record](../audits/2026-09-20-secret-storage-verification.md) names the tools and limits. Computed contrast, screen-reader testing, and actual Electron behavior remain unverified. These prototype results are not application evidence.

The six UI delivery gates remain pending for application implementation. The prototype is for choosing the design, not a shipping verdict. The dedicated settings page is approved. Storage, legacy compatibility, and runtime contract details still require the security proposal.
