import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { inflateSync } from 'node:zlib'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg'])
const GIF_SIGNATURES = new Set(['GIF87a', 'GIF89a'])
const LOGO_MAX_SIZE_BYTES = 512_000
const PREVIEW_MAX_SIZE_BYTES = 5_000_000
const MAX_DECOMPRESSED_IMAGE_BYTES = 16_000_000
export const MAX_SCREENSHOTS_PER_PROFILE = 9

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
}

interface ImageDimensions {
  width: number
  height: number
}

export function sanitizeUploadFilename(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u202F\u00A0]/g, ' ')
    .trim()
  const lastDot = normalized.lastIndexOf('.')
  const base = lastDot > 0 ? normalized.slice(0, lastDot) : normalized
  const extension = lastDot > 0 ? normalized.slice(lastDot) : ''
  const safeBase = base
    .replace(/[^A-Za-z0-9._ -]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  const safeExtension = extension.replace(/[^A-Za-z0-9.]+/g, '').slice(0, 12)
  return `${safeBase || 'file'}${safeExtension}`
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngDimensions(data: Buffer): ImageDimensions | undefined {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (data.length < 45 || !data.subarray(0, 8).equals(signature)) return undefined

  let dimensions: ImageDimensions | undefined
  let bitDepth = 0
  let colorType = -1
  let interlace = -1
  let sawImageData = false
  let sawEnd = false
  const compressed: Buffer[] = []
  let offset = 8
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset)
    const end = offset + length + 12
    if (end > data.length) return undefined
    const type = data.toString('ascii', offset + 4, offset + 8)
    const typeAndData = data.subarray(offset + 4, offset + 8 + length)
    if (crc32(typeAndData) !== data.readUInt32BE(offset + 8 + length)) return undefined

    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) return undefined
      dimensions = { width: data.readUInt32BE(offset + 8), height: data.readUInt32BE(offset + 12) }
      bitDepth = data[offset + 16]
      colorType = data[offset + 17]
      interlace = data[offset + 20]
      if (data[offset + 18] !== 0 || data[offset + 19] !== 0 || ![0, 1].includes(interlace)) return undefined
    } else if (type === 'IDAT') {
      sawImageData = true
      compressed.push(data.subarray(offset + 8, offset + 8 + length))
    } else if (type === 'IEND') {
      if (length !== 0 || end !== data.length) return undefined
      sawEnd = true
      break
    }
    offset = end
  }
  if (!dimensions || !sawImageData || !sawEnd || compressed.length === 0) return undefined

  try {
    const channels = new Map([
      [0, 1],
      [2, 3],
      [3, 1],
      [4, 2],
      [6, 4]
    ]).get(colorType)
    if (!channels || ![1, 2, 4, 8, 16].includes(bitDepth)) return undefined
    const pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: MAX_DECOMPRESSED_IMAGE_BYTES })
    if (pixels.length === 0) return undefined
    if (interlace === 0) {
      const rowLength = Math.ceil((dimensions.width * channels * bitDepth) / 8) + 1
      const expectedLength = rowLength * dimensions.height
      if (!Number.isSafeInteger(expectedLength) || expectedLength > MAX_DECOMPRESSED_IMAGE_BYTES) return undefined
      if (pixels.length !== expectedLength) return undefined
    }
  } catch {
    return undefined
  }
  return dimensions
}

function jpegDimensions(data: Buffer): ImageDimensions | undefined {
  if (
    data.length < 4 ||
    data[0] !== 0xff ||
    data[1] !== 0xd8 ||
    data[data.length - 2] !== 0xff ||
    data[data.length - 1] !== 0xd9
  ) {
    return undefined
  }
  let offset = 2
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  while (offset + 8 < data.length) {
    while (offset < data.length && data[offset] === 0xff) offset += 1
    const marker = data[offset]
    offset += 1
    if (marker === 0xd8 || marker === 0xd9) continue
    if (offset + 1 >= data.length) return undefined
    const length = data.readUInt16BE(offset)
    if (length < 2 || offset + length > data.length) return undefined
    if (startOfFrame.has(marker)) {
      return { height: data.readUInt16BE(offset + 3), width: data.readUInt16BE(offset + 5) }
    }
    offset += length
  }
  return undefined
}

function svgDimensions(data: Buffer): ImageDimensions | undefined {
  const text = data.toString('utf8')
  if (
    /<(?:script|foreignObject|iframe|object|embed)\b|\bon[a-z]+\s*=|javascript:|<!DOCTYPE|<!ENTITY|(?:href|xlink:href)\s*=\s*["']\s*data:text\/html/i.test(
      text
    )
  ) {
    return undefined
  }
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0]
  if (!tag) return undefined
  const numeric = (name: string) => {
    const value = new RegExp(`\\b${name}\\s*=\\s*["']([0-9]+(?:\\.[0-9]+)?)(?:px)?["']`, 'i').exec(tag)?.[1]
    return value ? Number(value) : undefined
  }
  const width = numeric('width')
  const height = numeric('height')
  if (width && height) return { width, height }
  const viewBox = /\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(tag)
  if (!viewBox) return undefined
  return { width: Number(viewBox[1]), height: Number(viewBox[2]) }
}

function imageDimensions(data: Buffer, extension: string): ImageDimensions | undefined {
  if (extension === '.png') return pngDimensions(data)
  if (extension === '.gif') {
    const signature = data.toString('ascii', 0, 6)
    if (
      data.length < 14 ||
      !GIF_SIGNATURES.has(signature) ||
      data[data.length - 1] !== 0x3b ||
      !data.subarray(13).includes(0x2c)
    ) {
      return undefined
    }
    return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) }
  }
  if (extension === '.jpg' || extension === '.jpeg') return jpegDimensions(data)
  if (extension === '.svg') return svgDimensions(data)
  return undefined
}

function validateImageDimensions(
  dimensions: ImageDimensions | undefined,
  kind: 'logo' | 'preview',
  filePath: string
): void {
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    throw new Error(`"${filePath}" is not a valid readable image.`)
  }
  if (kind === 'logo') {
    if (dimensions.width !== dimensions.height || dimensions.width < 400 || dimensions.width > 800) {
      throw new Error(`Logo "${filePath}" must be square and between 400x400 and 800x800 pixels.`)
    }
    return
  }
  const ratio = dimensions.width / dimensions.height
  if (dimensions.width < 600 || dimensions.width > 1000 || ratio < 1.5 || ratio > 1.8) {
    throw new Error(
      `Screenshot "${filePath}" must be 600-1000 pixels wide with an aspect ratio between 1.5:1 and 1.8:1.`
    )
  }
}

/* Builds the multipart body the portal sends: `logo` for the logo file,
   `preview` (repeated) for screenshots. */
export async function buildUploadForm(filePaths: string[], kind: 'logo' | 'preview'): Promise<FormData> {
  const form = new FormData()
  const fileNames = new Set<string>()
  for (const filePath of filePaths) {
    const extension = path.extname(filePath).toLowerCase()
    if (!IMAGE_EXTENSIONS.has(extension)) {
      throw new Error(`"${filePath}" is not a supported image (${[...IMAGE_EXTENSIONS].join(', ')})`)
    }
    const fileName = path.basename(filePath)
    const key = fileName.toLowerCase()
    if (fileNames.has(key)) throw new Error('Each upload must use unique file names.')
    fileNames.add(key)
  }
  for (const filePath of filePaths) {
    const extension = path.extname(filePath).toLowerCase()
    const data = await fs.readFile(filePath).catch(() => {
      throw new Error(`Cannot read file "${filePath}"`)
    })
    const limit = kind === 'logo' ? LOGO_MAX_SIZE_BYTES : PREVIEW_MAX_SIZE_BYTES
    if (data.byteLength > limit) {
      throw new Error(
        kind === 'logo'
          ? `"${filePath}" exceeds the 512 KB logo limit.`
          : `"${filePath}" exceeds the 5 MB screenshot limit.`
      )
    }
    validateImageDimensions(imageDimensions(data, extension), kind, filePath)
    const safeName = sanitizeUploadFilename(path.basename(filePath))
    const uploadName = `${kind}_${Date.now()}_${randomUUID()}_${safeName}`
    form.append(kind, new File([data], uploadName, { type: MIME_TYPES[extension] }))
  }
  return form
}

export function validateScreenshotCount(currentCount: number, addedCount: number): true | string {
  if (!Number.isInteger(currentCount) || currentCount < 0 || !Number.isInteger(addedCount) || addedCount < 0) {
    return 'Screenshot counts must be non-negative integers.'
  }
  const total = currentCount + addedCount
  return total <= MAX_SCREENSHOTS_PER_PROFILE
    ? true
    : `A profile can have at most ${MAX_SCREENSHOTS_PER_PROFILE} screenshots (${currentCount} already attached; ${addedCount} requested).`
}

export interface MediaLocation {
  logo: boolean
  agencyScreenshots: string[]
  subAccountScreenshots: string[]
  unknown: string[]
}

/* Classifies URLs against the version's media fields so deletes update
   the right profile section. */
export function locateMedia(
  urls: string[],
  version: { logoUrl?: string; previewImageUrls?: string[]; subAccountPreviewImageUrls?: string[] }
): MediaLocation {
  const result: MediaLocation = { logo: false, agencyScreenshots: [], subAccountScreenshots: [], unknown: [] }
  for (const url of urls) {
    if (url === version.logoUrl) {
      result.logo = true
    } else if ((version.previewImageUrls ?? []).includes(url)) {
      result.agencyScreenshots.push(url)
    } else if ((version.subAccountPreviewImageUrls ?? []).includes(url)) {
      result.subAccountScreenshots.push(url)
    } else {
      result.unknown.push(url)
    }
  }
  return result
}
