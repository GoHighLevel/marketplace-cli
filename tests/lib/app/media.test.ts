import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildUploadForm, locateMedia, sanitizeUploadFilename, validateScreenshotCount } from '../../../src/lib/app/media.js'

let dir: string

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length, 0)
  typeData.copy(chunk, 4)
  chunk.writeUInt32BE(crc32(typeData), data.length + 8)
  return chunk
}

function png(width: number, height: number, minimumSize = 0): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  const scanlines = Buffer.alloc(height * (1 + width * 4))
  const image = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
  return minimumSize > image.length ? Buffer.concat([image, Buffer.alloc(minimumSize - image.length)]) : image
}

function jpeg(width: number, height: number): Buffer {
  const frame = Buffer.from([0xff, 0xc0, 0x00, 0x08, 0x08, 0, 0, 0, 0, 0x01])
  frame.writeUInt16BE(height, 5)
  frame.writeUInt16BE(width, 7)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), frame, Buffer.from([0xff, 0xd9])])
}

function gif(width: number, height: number): Buffer {
  const image = Buffer.alloc(15)
  image.write('GIF89a', 0, 'ascii')
  image.writeUInt16LE(width, 6)
  image.writeUInt16LE(height, 8)
  image[13] = 0x2c
  image[14] = 0x3b
  return image
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-cli-media-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('buildUploadForm', () => {
  it('appends files under the given field name', async () => {
    const file = path.join(dir, 'logo.png')
    await fs.writeFile(file, png(500, 500))

    const form = await buildUploadForm([file], 'logo')
    const entry = form.get('logo') as File
    expect(entry.name).toMatch(/^logo_[^_]+_[^_]+_logo\.png$/)
    expect(entry.type).toBe('image/png')
  })

  it('rejects non-image files and missing files', async () => {
    await expect(buildUploadForm(['notes.txt'], 'preview')).rejects.toThrow(/not a supported image/)
    await expect(buildUploadForm([path.join(dir, 'missing.png')], 'preview')).rejects.toThrow(/Cannot read/)
  })

  it('rejects truncated files that only contain image headers', async () => {
    const truncated = path.join(dir, 'truncated.png')
    const header = Buffer.alloc(24)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header)
    header.write('IHDR', 12, 'ascii')
    header.writeUInt32BE(500, 16)
    header.writeUInt32BE(500, 20)
    await fs.writeFile(truncated, header)

    await expect(buildUploadForm([truncated], 'logo')).rejects.toThrow(/valid readable image/i)
  })

  it('rejects files over the portal 5 MB limit and duplicate basenames', async () => {
    const large = path.join(dir, 'large.png')
    await fs.writeFile(large, png(900, 540, 5_000_001))
    await expect(buildUploadForm([large], 'preview')).rejects.toThrow(/5 MB/i)

    const firstDir = path.join(dir, 'one')
    const secondDir = path.join(dir, 'two')
    await fs.mkdir(firstDir)
    await fs.mkdir(secondDir)
    const first = path.join(firstDir, 'same.png')
    const second = path.join(secondDir, 'same.png')
    await Promise.all([fs.writeFile(first, 'one'), fs.writeFile(second, 'two')])
    await expect(buildUploadForm([first, second], 'preview')).rejects.toThrow(/unique file names/i)
  })

  it('enforces the portal logo and screenshot dimensions', async () => {
    const wideLogo = path.join(dir, 'wide-logo.png')
    await fs.writeFile(wideLogo, png(800, 400))
    await expect(buildUploadForm([wideLogo], 'logo')).rejects.toThrow(/must be square/i)

    const squarePreview = path.join(dir, 'square-preview.png')
    await fs.writeFile(squarePreview, png(800, 800))
    await expect(buildUploadForm([squarePreview], 'preview')).rejects.toThrow(/aspect ratio/i)
  })

  it('accepts a portal-compatible screenshot', async () => {
    const preview = path.join(dir, 'preview.png')
    await fs.writeFile(preview, png(900, 540))
    const form = await buildUploadForm([preview], 'preview')
    expect((form.get('preview') as File).name).toMatch(/^preview_[^_]+_[^_]+_preview\.png$/)
  })

  it('validates JPEG and GIF content instead of trusting the extension', async () => {
    const jpgFile = path.join(dir, 'preview.jpg')
    const gifFile = path.join(dir, 'preview.gif')
    await fs.writeFile(jpgFile, jpeg(900, 540))
    await fs.writeFile(gifFile, gif(900, 540))

    await expect(buildUploadForm([jpgFile], 'preview')).resolves.toBeInstanceOf(FormData)
    await expect(buildUploadForm([gifFile], 'preview')).resolves.toBeInstanceOf(FormData)

    await fs.writeFile(jpgFile, jpeg(500, 500).subarray(0, -2))
    await fs.writeFile(gifFile, gif(900, 540).subarray(0, -1))
    await expect(buildUploadForm([jpgFile], 'preview')).rejects.toThrow(/valid readable image/i)
    await expect(buildUploadForm([gifFile], 'preview')).rejects.toThrow(/valid readable image/i)
  })

  it('accepts passive SVG images and rejects active content', async () => {
    const safe = path.join(dir, 'preview.svg')
    const unsafe = path.join(dir, 'unsafe.svg')
    await fs.writeFile(safe, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 540"><rect width="1" height="1"/></svg>')
    await fs.writeFile(unsafe, '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="540"><script>alert(1)</script></svg>')

    await expect(buildUploadForm([safe], 'preview')).resolves.toBeInstanceOf(FormData)
    await expect(buildUploadForm([unsafe], 'preview')).rejects.toThrow(/valid readable image/i)
  })
})

describe('sanitizeUploadFilename', () => {
  it('removes unsafe multipart characters while preserving a safe extension', () => {
    expect(sanitizeUploadFilename('  résumé\r\n"logo".png  ')).toBe('resumelogo.png')
    expect(sanitizeUploadFilename('🔥.svg')).toBe('file.svg')
    expect(sanitizeUploadFilename('a'.repeat(140) + '.jpeg').length).toBeLessThanOrEqual(132)
  })
})

describe('validateScreenshotCount', () => {
  it('limits each app profile to nine screenshots', () => {
    expect(validateScreenshotCount(6, 3)).toBe(true)
    expect(validateScreenshotCount(7, 3)).toMatch(/at most 9 screenshots/i)
    expect(validateScreenshotCount(-1, 1)).toMatch(/non-negative integers/i)
  })
})

describe('locateMedia', () => {
  const version = {
    logoUrl: 'https://cdn/logo.png',
    previewImageUrls: ['https://cdn/a.png'],
    subAccountPreviewImageUrls: ['https://cdn/s.png']
  }

  it('classifies urls into logo, agency, sub-account, and unknown', () => {
    const result = locateMedia(
      ['https://cdn/logo.png', 'https://cdn/a.png', 'https://cdn/s.png', 'https://cdn/x.png'],
      version
    )
    expect(result.logo).toBe(true)
    expect(result.agencyScreenshots).toEqual(['https://cdn/a.png'])
    expect(result.subAccountScreenshots).toEqual(['https://cdn/s.png'])
    expect(result.unknown).toEqual(['https://cdn/x.png'])
  })
})
