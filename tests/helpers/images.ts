import { deflateSync } from 'node:zlib'

/* A real PNG of the given size, optionally padded to a minimum byte size. */
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

export function png(width: number, height: number, minimumSize = 0): Buffer {
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
