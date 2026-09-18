/**
 * Draft-side conversions into the shared queued-message vocabulary (roadmap
 * step 08). The rows themselves live in the main process; these helpers turn
 * what the composer holds into the payload `queue.add` takes, and describe the
 * selection types the composer drafts with.
 */

import type {
  QueuedDiffTextContext,
  QueuedFile,
  QueuedImage,
  QueuedPastedText,
  QueuedTextContext,
} from "../../../../shared/queue-item"
import type { UploadedFile, UploadedImage } from "../hooks/use-agents-file-upload"
import type { PastedTextFile } from "../hooks/use-pasted-text-files"

export type { QueuedDiffTextContext, QueuedFile, QueuedImage, QueuedPastedText, QueuedTextContext }

// Text context selected from assistant messages
export interface SelectedTextContext {
  id: string
  text: string
  sourceMessageId: string
  preview: string // Truncated for display (~50 chars)
  createdAt: Date
}

// Text context selected from diff sidebar
export interface DiffTextContext {
  id: string
  text: string
  filePath: string
  lineNumber?: number
  lineType?: "old" | "new"
  preview: string // Truncated for display
  createdAt: Date
}

// Helper to convert UploadedImage to QueuedImage
export function toQueuedImage(img: UploadedImage): QueuedImage {
  return {
    id: img.id,
    url: img.url,
    mediaType: img.mediaType || "image/png",
    filename: img.filename,
    base64Data: img.base64Data,
  }
}

// Helper to convert UploadedFile to QueuedFile
export function toQueuedFile(file: UploadedFile): QueuedFile {
  return {
    id: file.id,
    url: file.url,
    filename: file.filename,
    mediaType: file.type,
    size: file.size,
  }
}

// Helper to convert SelectedTextContext to QueuedTextContext
export function toQueuedTextContext(ctx: SelectedTextContext): QueuedTextContext {
  return {
    id: ctx.id,
    text: ctx.text,
    sourceMessageId: ctx.sourceMessageId,
  }
}

// Helper to convert DiffTextContext to QueuedDiffTextContext
export function toQueuedDiffTextContext(ctx: DiffTextContext): QueuedDiffTextContext {
  return {
    id: ctx.id,
    text: ctx.text,
    filePath: ctx.filePath,
    lineNumber: ctx.lineNumber,
    lineType: ctx.lineType,
  }
}

// Helper to convert PastedTextFile to QueuedPastedText
export function toQueuedPastedText(pt: PastedTextFile): QueuedPastedText {
  return {
    id: pt.id,
    filePath: pt.filePath,
    filename: pt.filename,
    size: pt.size,
    preview: pt.preview,
    kind: pt.kind,
  }
}

// Helper to create a truncated preview from text
export function createTextPreview(text: string, maxLength: number = 50): string {
  const trimmed = text.trim().replace(/\s+/g, " ")
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength)}...`
}
