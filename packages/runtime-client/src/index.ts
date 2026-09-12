/**
 * TypeScript SDK for the jcode harness API.
 *
 * ```ts
 * import { JcodeClient } from "@1jehuang/jcode-sdk";
 * const client = await JcodeClient.connect({ clientName: "my-app/1.0" });
 * const session = await client.createSession(process.cwd());
 * const turn = await client.run(session.session_id, "hello");
 * console.log(turn.text);
 * client.close();
 * ```
 */

export { bundledJcodeBinary, platformBinaryPackage } from "./binary.js"
export type {
  ConnectOptions,
  FileContent,
  FileStatus,
  GlobalEventsOptions,
  RunOptions,
  RunStructuredOptions,
  RuntimeInfo,
  SendMessageOptions,
  StructuredTurnResult,
  Transport,
  TurnResult,
} from "./client.js"
export { JcodeClient, unixSocketTransport } from "./client.js"
export { HarnessError } from "./errors.js"
export * from "./framing.js"
export type { LaunchedInstance, LaunchOptions } from "./launch.js"
export {
  inheritCredentials,
  launchInstance,
  userAppConfigDir,
  userJcodeHome,
} from "./launch.js"
export * from "./protocol.js"
export * from "./sockets.js"
export type {
  StructuredOutputAttempt,
  StructuredOutputSchema,
  StructuredValidationIssue,
} from "./structured.js"
export { StructuredOutputError } from "./structured.js"
