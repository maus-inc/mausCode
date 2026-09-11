import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  removeMcpServerByScope,
  type ClaudeConfig,
} from "./mcp-config";

const SERVER = { command: "node", args: ["server.js"] };

describe("removeMcpServerByScope", () => {
  it("removes a global server without mutating the input", () => {
    const config: ClaudeConfig = {
      mcpServers: { alpha: SERVER, beta: SERVER },
    };

    const result = removeMcpServerByScope(config, null, "alpha");

    assert.deepEqual(Object.keys(result.mcpServers ?? {}), ["beta"]);
    // Input is untouched.
    assert.deepEqual(Object.keys(config.mcpServers ?? {}), ["alpha", "beta"]);
  });

  it("treats a null scope as the global section", () => {
    const config: ClaudeConfig = { mcpServers: { alpha: SERVER } };
    const result = removeMcpServerByScope(config, null, "alpha");
    assert.deepEqual(result.mcpServers, {});
  });

  it("returns the same reference when there is nothing to remove", () => {
    const config: ClaudeConfig = { mcpServers: { alpha: SERVER } };
    assert.equal(
      removeMcpServerByScope(config, null, "missing"),
      config,
    );

    const bare: ClaudeConfig = {};
    assert.equal(removeMcpServerByScope(bare, null, "alpha"), bare);
  });

  it("removes a project server and keeps the project's other keys", () => {
    const config: ClaudeConfig = {
      projects: {
        "/repo": {
          hasTrustDialogAccepted: true,
          mcpServers: { alpha: SERVER, beta: SERVER },
        },
      },
    };

    const result = removeMcpServerByScope(config, "/repo", "alpha");
    const entry = result.projects?.["/repo"];

    assert.deepEqual(Object.keys(entry?.mcpServers ?? {}), ["beta"]);
    assert.equal(entry?.hasTrustDialogAccepted, true);
  });

  it("drops the mcpServers key when the last project server goes", () => {
    const config: ClaudeConfig = {
      projects: {
        "/repo": { hasTrustDialogAccepted: true, mcpServers: { alpha: SERVER } },
      },
    };

    const result = removeMcpServerByScope(config, "/repo", "alpha");
    const entry = result.projects?.["/repo"];

    assert.equal(entry !== undefined, true);
    assert.equal("mcpServers" in (entry ?? {}), false);
    assert.equal(entry?.hasTrustDialogAccepted, true);
  });

  it("drops the project entry entirely when removing leaves it empty", () => {
    const config: ClaudeConfig = {
      projects: {
        "/repo": { mcpServers: { alpha: SERVER } },
        "/other": { hasTrustDialogAccepted: true },
      },
    };

    const result = removeMcpServerByScope(config, "/repo", "alpha");

    assert.equal("/repo" in (result.projects ?? {}), false);
    assert.deepEqual(Object.keys(result.projects ?? {}), ["/other"]);
  });

  it("returns the same reference for an unknown project", () => {
    const config: ClaudeConfig = { projects: { "/repo": {} } };
    assert.equal(removeMcpServerByScope(config, "/nope", "alpha"), config);
  });

  it("preserves key order of the remaining servers", () => {
    const config: ClaudeConfig = {
      mcpServers: { one: SERVER, two: SERVER, three: SERVER },
    };
    const result = removeMcpServerByScope(config, null, "two");
    assert.deepEqual(Object.keys(result.mcpServers ?? {}), ["one", "three"]);
  });
});
