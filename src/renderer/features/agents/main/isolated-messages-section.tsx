"use client"

import { useAtomValue } from "jotai"
import { memo } from "react"
import {
  type ImagePartLike,
  type Message,
  userMessageIdsPerChatAtom,
} from "../stores/message-store"
import type { ToolDisplayPart } from "../ui/agent-tool-registry"
import { IsolatedMessageGroup } from "./isolated-message-group"

// ============================================================================
// ISOLATED MESSAGES SECTION (LAYER 3)
// ============================================================================
// Renders ALL message groups by subscribing to userMessageIdsAtom.
// Only re-renders when a new user message is added (new conversation turn).
// Each group independently subscribes to its own data via IsolatedMessageGroup.
//
// During streaming:
// - This component does NOT re-render (userMessageIds don't change)
// - Individual groups don't re-render (their user msg + assistant IDs don't change)
// - Only the AssistantMessageItem for the streaming message re-renders
// ============================================================================

interface IsolatedMessagesSectionProps {
  subChatId: string
  chatId: string
  isMobile: boolean
  sandboxSetupStatus: "cloning" | "ready" | "error"
  stickyTopClass: string
  sandboxSetupError?: string
  onRetrySetup?: () => void
  onRollback?: (msg: Message | null) => void
  onFork?: (messageId: string) => void
  // Components passed from parent - must be stable references
  UserBubbleComponent: React.ComponentType<{
    messageId: string
    textContent: string
    imageParts: ImagePartLike[]
    skipTextMentionBlocks?: boolean
  }>
  ToolCallComponent: React.ComponentType<{
    icon: React.ComponentType<{ className?: string }>
    title: string
    isPending: boolean
    isError: boolean
  }>
  MessageGroupWrapper: React.ComponentType<{ children: React.ReactNode; isLastGroup?: boolean }>
  toolRegistry: Record<
    string,
    { icon: React.ComponentType<{ className?: string }>; title: (part: ToolDisplayPart) => string }
  >
}

function areSectionPropsEqual(
  prev: IsolatedMessagesSectionProps,
  next: IsolatedMessagesSectionProps,
): boolean {
  return (
    prev.subChatId === next.subChatId &&
    prev.chatId === next.chatId &&
    prev.isMobile === next.isMobile &&
    prev.sandboxSetupStatus === next.sandboxSetupStatus &&
    prev.stickyTopClass === next.stickyTopClass &&
    prev.sandboxSetupError === next.sandboxSetupError &&
    prev.onRetrySetup === next.onRetrySetup &&
    prev.onRollback === next.onRollback &&
    prev.onFork === next.onFork &&
    prev.UserBubbleComponent === next.UserBubbleComponent &&
    prev.ToolCallComponent === next.ToolCallComponent &&
    prev.MessageGroupWrapper === next.MessageGroupWrapper &&
    prev.toolRegistry === next.toolRegistry
  )
}

export const IsolatedMessagesSection = memo(function IsolatedMessagesSection({
  subChatId,
  chatId,
  isMobile,
  sandboxSetupStatus,
  stickyTopClass,
  sandboxSetupError,
  onRetrySetup,
  onRollback,
  onFork,
  UserBubbleComponent,
  ToolCallComponent,
  MessageGroupWrapper,
  toolRegistry,
}: IsolatedMessagesSectionProps) {
  // Per-subchat selector - split panes render fully independently.
  const userMsgIds = useAtomValue(userMessageIdsPerChatAtom(subChatId))

  return (
    <>
      {userMsgIds.map((userMsgId) => (
        <IsolatedMessageGroup
          key={userMsgId}
          userMsgId={userMsgId}
          subChatId={subChatId}
          chatId={chatId}
          isMobile={isMobile}
          sandboxSetupStatus={sandboxSetupStatus}
          stickyTopClass={stickyTopClass}
          sandboxSetupError={sandboxSetupError}
          onRetrySetup={onRetrySetup}
          onRollback={onRollback}
          onFork={onFork}
          UserBubbleComponent={UserBubbleComponent}
          ToolCallComponent={ToolCallComponent}
          MessageGroupWrapper={MessageGroupWrapper}
          toolRegistry={toolRegistry}
        />
      ))}
    </>
  )
}, areSectionPropsEqual)
