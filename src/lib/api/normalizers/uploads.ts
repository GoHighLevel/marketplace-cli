import { isRecord } from '../response.js'

/* The upload endpoint returns either [{fileName, fileUrl}] or {files: {name: url}}. */
export function normalizeUploadResponse(response: unknown): Record<string, string> {
  if (Array.isArray(response)) {
    const map: Record<string, string> = {}
    for (const file of response) {
      const entry = isRecord(file) ? normalizeUploadEntry(file.fileName, file.fileUrl) : undefined
      if (!entry) {
        throw new Error('File upload API returned an unexpected response.')
      }
      if (Object.hasOwn(map, entry.name)) {
        throw new Error(`File upload API returned a duplicate file name: ${entry.name}`)
      }
      map[entry.name] = entry.url
    }
    return map
  }
  if (isRecord(response) && isRecord(response.files)) {
    const map: Record<string, string> = {}
    for (const [name, url] of Object.entries(response.files)) {
      const entry = normalizeUploadEntry(name, url)
      if (!entry) throw new Error('File upload API returned an unexpected response.')
      map[entry.name] = entry.url
    }
    return map
  }
  throw new Error('File upload API returned an unexpected response.')
}

function normalizeUploadEntry(name: unknown, url: unknown): { name: string; url: string } | undefined {
  if (typeof name !== 'string' || !name.trim() || typeof url !== 'string' || !url.trim()) return undefined
  try {
    if (!['http:', 'https:'].includes(new URL(url).protocol)) return undefined
    return { name, url }
  } catch {
    return undefined
  }
}
