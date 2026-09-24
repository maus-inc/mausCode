// @vitest-environment jsdom
/**
 * The Prompt Suggestions switch has a name a screen reader can say.
 *
 * The row's title is a sibling `<span>`, not a `<label>` pointing at the
 * control, and the Switch ships no name of its own — so without the
 * `aria-label` this PR added, the control exposed an unnamed `role="switch"`
 * and assistive technology had nothing to call it.
 */
import { render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { AgentsPreferencesTab } from "./agents-preferences-tab"

// Every query and mutation the tab opens resolves to an empty result: the
// assertion is about the control's accessible name, and the network behind
// the data does not decide that. The fake answers at any depth, so
// `trpc.claudeSettings.getIncludeCoAuthoredBy.useQuery` and friends all land
// without a provider.
vi.mock("../../../lib/trpc", () => {
  const empty = {
    data: undefined,
    isLoading: false,
    isError: false,
    isSuccess: false,
    isPending: false,
    refetch: () => {},
    mutate: () => {},
    mutateAsync: async () => ({}),
  }
  const fakeTrpc = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "useQuery" || prop === "useMutation") return () => empty
          return fakeTrpc()
        },
      },
    )
  return { trpc: fakeTrpc(), trpcClient: fakeTrpc() }
})

it("names the Prompt Suggestions switch for assistive technology", () => {
  render(<AgentsPreferencesTab />)
  expect(screen.getByRole("switch", { name: "Prompt Suggestions" })).toBeTruthy()
})
