/**
 * Ported from pingdotgg/t3code packages/contracts (MIT, (c) 2026 T3 Tools Inc.).
 * T3 product identifiers kept verbatim so ported tests stay faithful; see README.md.
 */
import { describe, expect, it } from "vitest";

import {
  EnvironmentAuthInvalidError,
  EnvironmentInternalError,
  EnvironmentOperationForbiddenError,
  EnvironmentRequestInvalidError,
  EnvironmentResourceNotFoundError,
  EnvironmentScopeRequiredError,
} from "./environmentHttp.ts";

const traceId = "trace-1";

describe("environment HTTP errors", () => {
  // A client squashes the cause and shows `message`; an empty one becomes a generic
  // "The environment request failed." that names nothing the reader can act on.
  it("each carries a message that names its reason", () => {
    const errors = [
      new EnvironmentRequestInvalidError({
        code: "invalid_request",
        reason: "invalid_command",
        traceId,
      }),
      new EnvironmentAuthInvalidError({
        code: "auth_invalid",
        reason: "missing_credential",
        traceId,
      }),
      new EnvironmentScopeRequiredError({
        code: "insufficient_scope",
        requiredScope: "orchestration:read",
        traceId,
      }),
      new EnvironmentOperationForbiddenError({
        code: "operation_forbidden",
        reason: "current_session_revoke_not_allowed",
        traceId,
      }),
      new EnvironmentResourceNotFoundError({
        code: "not_found",
        reason: "thread_not_found",
        traceId,
      }),
      new EnvironmentInternalError({
        code: "internal_error",
        reason: "orchestration_snapshot_failed",
        traceId,
      }),
    ] as const;
    const details = [
      "invalid_command",
      "missing_credential",
      "orchestration:read",
      "current_session_revoke_not_allowed",
      "thread_not_found",
      "orchestration_snapshot_failed",
    ];
    errors.forEach((error, index) => {
      expect(error.message).toContain(details[index]);
    });
  });
});
