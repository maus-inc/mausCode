/**
 * Native runtime wire contract shared by main and renderer.
 *
 * The native transport reuses the existing AskUserQuestion UI: daemon
 * permission requests arrive as `ask-user-question` chunks whose toolUseId
 * carries the prefix below, and answer sites route on it (see
 * features/agents/lib/approval-routing.ts).
 */
export const NATIVE_QUESTION_PREFIX = "native:"

/** Prefix for native-transport error texts (renderer categorizes on it). */
export const NATIVE_ERROR_PREFIX = "NATIVE_"
