/**
 * Shared image staging: decode base64 chat attachments into per-turn temp
 * files for backends whose protocols want file paths (opencode file parts,
 * codex app-server `localImage` inputs, cursor-print prompt references).
 * Best-effort cleanup never fails a turn.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

export type StagedImage = {
  base64Data?: string
  mediaType?: string
  filename?: string
}

function imageExtensionForMediaType(mediaType: string): string {
  const subtype = mediaType.split("/")[1]?.split(";")[0]?.trim()
  if (subtype && /^[a-z0-9]+$/i.test(subtype)) {
    return subtype.toLowerCase()
  }
  return "png"
}

export async function writeImageTempFiles(
  images: StagedImage[] | undefined,
  tag: string,
): Promise<{ paths: string[]; cleanup: () => Promise<void> }> {
  const noFiles = { paths: [], cleanup: async () => {} }
  if (!images || images.length === 0) {
    return noFiles
  }

  const dir = await mkdtemp(join(tmpdir(), `mauscode-${tag}-`))
  const cleanup = async () => {
    try {
      await rm(dir, { recursive: true, force: true })
    } catch {
      // Best effort: temp files must never fail the turn.
    }
  }

  try {
    const paths: string[] = []
    for (let index = 0; index < images.length; index++) {
      const image = images[index]
      if (!image?.base64Data || !image.mediaType) continue
      const extension = imageExtensionForMediaType(image.mediaType)
      // Index-prefixed: duplicate client filenames must not overwrite.
      const safeName =
        image.filename && image.filename.trim().length > 0
          ? `${index}-${basename(image.filename)}`
          : `image-${index}.${extension}`
      const filePath = join(dir, safeName)
      await writeFile(filePath, Buffer.from(image.base64Data, "base64"))
      paths.push(filePath)
    }
    return { paths, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
