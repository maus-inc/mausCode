import { relations } from "drizzle-orm"
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { createId } from "../utils"

// ============ PROJECTS ============
export const projects = sqliteTable("projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  // Git remote info (extracted from local .git)
  gitRemoteUrl: text("git_remote_url"),
  gitProvider: text("git_provider"), // "github" | "gitlab" | "bitbucket" | null
  gitOwner: text("git_owner"),
  gitRepo: text("git_repo"),
  // Custom project icon (absolute path to local image file)
  iconPath: text("icon_path"),
  // --- Transplanted from erenbertr/1code (Apache-2.0): rail/status features ---
  // Custom accent color for visual differentiation (hex string e.g. "#ef4444")
  accentColor: text("accent_color"),
  // User-defined ordering in the projects rail (lower = earlier). Default 0; ties fall back to updatedAt DESC.
  sortOrder: integer("sort_order").notNull().default(0),
  // Whether this project appears in the leftmost rail. Hidden projects still
  // show on the all-projects page. Default true so existing rows behave as before.
  showInRail: integer("show_in_rail", { mode: "boolean" }).notNull().default(true),
})

export const projectsRelations = relations(projects, ({ many }) => ({
  chats: many(chats),
}))

// ============ CHATS ============
export const chats = sqliteTable(
  "chats",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    name: text("name"),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    // Last time the user opened/viewed this chat. Used to compute "unseen" status
    // (chat counts as unseen when subChat activity is newer than this timestamp).
    // Null = never viewed. Transplanted from erenbertr/1code (Apache-2.0).
    lastViewedAt: integer("last_viewed_at", { mode: "timestamp" }),
    // Worktree fields (for git isolation per chat)
    worktreePath: text("worktree_path"),
    branch: text("branch"),
    baseBranch: text("base_branch"),
    // PR tracking fields
    prUrl: text("pr_url"),
    prNumber: integer("pr_number"),
    // Custom accent color for visual differentiation (hex string e.g. "#ef4444").
    // Transplanted from erenbertr/1code (Apache-2.0).
    accentColor: text("accent_color"),
  },
  (table) => [index("chats_worktree_path_idx").on(table.worktreePath)],
)

export const chatsRelations = relations(chats, ({ one, many }) => ({
  project: one(projects, {
    fields: [chats.projectId],
    references: [projects.id],
  }),
  subChats: many(subChats),
}))

// ============ SUB-CHATS ============
export const subChats = sqliteTable("sub_chats", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name"),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  sessionId: text("session_id"), // Claude SDK session ID for resume
  streamId: text("stream_id"), // Track in-progress streams
  mode: text("mode").notNull().default("agent"), // "plan" | "ask" | "edit" | "agent" | "turbo"
  // Canonical provider binding ("claude-code" | "codex" | "gemini" | "openrouter" | "cursor").
  // NULL = legacy row: renderer falls back to message-metadata inference + lazy backfill.
  provider: text("provider"),
  messages: text("messages").notNull().default("[]"), // JSON array
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
})

export const subChatsRelations = relations(subChats, ({ one }) => ({
  chat: one(chats, {
    fields: [subChats.chatId],
    references: [chats.id],
  }),
}))

// ============ CLAUDE CODE CREDENTIALS ============
// Stores encrypted OAuth token for Claude Code integration
// DEPRECATED: Use anthropicAccounts for multi-account support
export const claudeCodeCredentials = sqliteTable("claude_code_credentials", {
  id: text("id").primaryKey().default("default"), // Single row, always "default"
  oauthToken: text("oauth_token").notNull(), // Encrypted with safeStorage
  connectedAt: integer("connected_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  userId: text("user_id"), // Desktop auth user ID (for reference)
})

// ============ QWEN CREDENTIALS ============
// mausCode-held Qwen Code credentials (upstream has no CLI login command:
// `qwen auth` was removed, so auth is API key + endpoint injected per-run
// via --auth-type/--openai-api-key/--openai-base-url flags). Single row.
export const qwenCredentials = sqliteTable("qwen_credentials", {
  id: text("id").primaryKey().default("default"), // Single row, always "default"
  authType: text("auth_type").notNull().default("openai"),
  apiKey: text("api_key").notNull(), // Encrypted with safeStorage (token-crypto)
  baseUrl: text("base_url"), // OpenAI-compatible endpoint override
  model: text("model"), // Default model id for this credential
  label: text("label"), // User-visible preset label (e.g. "Coding Plan (intl)")
  connectedAt: integer("connected_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
})

export const clineCredentials = sqliteTable("cline_credentials", {
  id: text("id").primaryKey().default("default"), // Single row, always "default"
  provider: text("provider").notNull().default("openrouter"), // Cline -P id
  apiKey: text("api_key"), // Encrypted (token-crypto); null for local runtimes
  baseUrl: text("base_url"), // Custom OpenAI-compatible endpoint (openai-native)
  model: text("model"), // Default model id for this credential
  label: text("label"), // User-visible preset label (e.g. "OpenRouter")
  connectedAt: integer("connected_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
})

export const openclawCredentials = sqliteTable("openclaw_credentials", {
  id: text("id").primaryKey().default("default"), // Single row, always "default"
  provider: text("provider").notNull().default("openai"), // Held provider id (env-var injection)
  apiKey: text("api_key"), // Encrypted (token-crypto)
  model: text("model"), // Default model ref for this credential
  label: text("label"), // User-visible preset label (e.g. "OpenAI")
  connectedAt: integer("connected_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
})

export const rooCredentials = sqliteTable("roo_credentials", {
  id: text("id").primaryKey().default("default"), // Single row, always "default"
  provider: text("provider").notNull().default("openrouter"), // Held provider id (env-var injection)
  apiKey: text("api_key"), // Encrypted (token-crypto)
  model: text("model"), // Default model ref for this credential
  label: text("label"), // User-visible preset label (e.g. "OpenRouter")
  connectedAt: integer("connected_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
})

// ============ RUNS ============
// One row per agent turn, owned by the main process. Status vocabulary and
// legal transitions live in src/shared/run-state.ts and
// src/main/lib/runs/run-state.ts (roadmap step 07).
export const runs = sqliteTable(
  "runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    subChatId: text("sub_chat_id")
      .notNull()
      .references(() => subChats.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("running"),
    startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    endedAt: integer("ended_at", { mode: "timestamp" }),
    stopReason: text("stop_reason"),
    approvalPending: integer("approval_pending", { mode: "boolean" }).notNull().default(false),
    engine: text("engine"), // "legacy" | "native"
    provider: text("provider"),
    model: text("model"),
    // Newest run_events.seq for this run. Lets a consumer compare cursors
    // without reading the event table.
    lastSeq: integer("last_seq").notNull().default(0),
  },
  (table) => [
    index("runs_sub_chat_id_idx").on(table.subChatId),
    index("runs_status_idx").on(table.status),
  ],
)

export const runsRelations = relations(runs, ({ one, many }) => ({
  subChat: one(subChats, {
    fields: [runs.subChatId],
    references: [subChats.id],
  }),
  events: many(runEvents),
}))

// ============ RUN EVENTS ============
// Append-only transition log per run. (run_id, seq) is unique and seq is
// monotonically increasing per run, which is what makes cursor replay
// possible. Payload is JSON text and carries state facts, not transcripts.
export const runEvents = sqliteTable(
  "run_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull(),
    payload: text("payload").notNull().default("{}"),
    at: integer("at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("run_events_run_id_seq_uq").on(table.runId, table.seq)],
)

export const runEventsRelations = relations(runEvents, ({ one }) => ({
  run: one(runs, {
    fields: [runEvents.runId],
    references: [runs.id],
  }),
}))

// ============ QUEUE ITEMS ============
// One row per queued message, owned by the main process (roadmap step 08).
// `payload` is the JSON the renderer sent and the store never interprets.
// `position` carries gaps so an insert does not rewrite another row, and the
// status vocabulary lives in src/shared/queue-item.ts.
export const queueItems = sqliteTable(
  "queue_items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    subChatId: text("sub_chat_id")
      .notNull()
      .references(() => subChats.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    status: text("status").notNull().default("pending"),
    payload: text("payload").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    dispatchedAt: integer("dispatched_at", { mode: "timestamp" }),
    /**
     * The window session that took this row. A claim may only be handed over
     * by its owner, and a claim whose owner never reached the hand-off can be
     * taken over, which is what unsticks a queue after a window dies. The
     * value is the renderer session token, not a window id, because a reload
     * keeps the window and replaces the session.
     */
    claimedBy: text("claimed_by"),
    /**
     * When the claiming window passed the payload to the engine. Null means
     * the message never left, which is what lets recovery requeue a row
     * without risking a second send, and what lets a stuck claim be taken over
     * safely. Set once, immediately before the send.
     */
    handedAt: integer("handed_at", { mode: "timestamp" }),
  },
  // Covers both ordering queries: they filter one sub-chat and sort by the
  // position the index already holds, so SQLite reads the head without a sorter.
  (table) => [
    index("queue_items_sub_chat_position_idx").on(table.subChatId, table.position, table.createdAt),
  ],
)

export const queueItemsRelations = relations(queueItems, ({ one }) => ({
  subChat: one(subChats, {
    fields: [queueItems.subChatId],
    references: [subChats.id],
  }),
}))

// ============ ANTHROPIC ACCOUNTS (Multi-account support) ============
// Stores multiple Anthropic OAuth accounts for quick switching
export const anthropicAccounts = sqliteTable("anthropic_accounts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  email: text("email"), // User's email from OAuth (if available)
  displayName: text("display_name"), // User-editable label
  oauthToken: text("oauth_token").notNull(), // Encrypted with safeStorage
  connectedAt: integer("connected_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  desktopUserId: text("desktop_user_id"), // Reference to mausCode control-plane user
})

// Native-engine custom provider endpoints (daemon-level: the stock daemon honors
// endpoint overrides only via process env, so these are applied at daemon launch)
export const nativeEndpointSettings = sqliteTable("native_endpoint_settings", {
  id: text("id").primaryKey().default("singleton"), // Single row
  openaiBaseUrl: text("openai_base_url"), // Custom OpenAI-compatible endpoint (https?://…)
  anthropicBaseUrl: text("anthropic_base_url"), // Custom Anthropic endpoint (https?://…)
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
})

// Tracks which Anthropic account is currently active
export const anthropicSettings = sqliteTable("anthropic_settings", {
  id: text("id").primaryKey().default("singleton"), // Single row
  activeAccountId: text("active_account_id"), // References anthropicAccounts.id
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
})

// ============ TYPE EXPORTS ============
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Chat = typeof chats.$inferSelect
export type NewChat = typeof chats.$inferInsert
export type SubChat = typeof subChats.$inferSelect
export type NewSubChat = typeof subChats.$inferInsert
export type ClaudeCodeCredential = typeof claudeCodeCredentials.$inferSelect
export type NewClaudeCodeCredential = typeof claudeCodeCredentials.$inferInsert
export type AnthropicAccount = typeof anthropicAccounts.$inferSelect
export type NewAnthropicAccount = typeof anthropicAccounts.$inferInsert
export type AnthropicSettings = typeof anthropicSettings.$inferSelect
export type NativeEndpointSettings = typeof nativeEndpointSettings.$inferSelect
export type Run = typeof runs.$inferSelect
export type NewRun = typeof runs.$inferInsert
export type RunEvent = typeof runEvents.$inferSelect
export type NewRunEvent = typeof runEvents.$inferInsert
export type QueueItemRow = typeof queueItems.$inferSelect
export type NewQueueItemRow = typeof queueItems.$inferInsert
