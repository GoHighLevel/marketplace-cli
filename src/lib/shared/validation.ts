import { isIP } from 'node:net'

type ValidationResult = true | string

interface UrlOptions {
  publicOnly?: boolean
}

interface IntegerRange {
  min: number
  max: number
}

const DEVELOPER_TEAM_ID = /^[A-Za-z0-9_-]{1,128}$/
const MAX_URL_LENGTH = 2_048
const MAX_SECURITY_TEXT_LENGTH = 10_000
const YOUTUBE_VIDEO_ID_LENGTH = 11
const YOUTUBE_VIDEO_ID_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
const XSS_BLOCKED_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'meta',
  'link',
  'style',
  'base',
  'html',
  'body'
])
const XSS_BLOCKED_SCHEMES = ['javascript', 'data', 'vbscript', 'mhtml', 'about']
const XSS_BLOCKED_URL_SCHEMES = ['javascript:', 'data:', 'vbscript:']
const XSS_BLOCKED_CALLS = ['alert', 'eval', 'settimeout', 'setinterval', 'function']
const SECURITY_NAMED_ENTITIES: ReadonlyArray<readonly [string, string]> = [
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&apos;', "'"],
  ['&amp;', '&']
]

function parsedUrl(value: string): URL | undefined {
  try {
    const url = new URL(value)
    return url.hostname ? url : undefined
  } catch {
    return undefined
  }
}

export function isDeveloperTeamId(value: unknown): value is string {
  return typeof value === 'string' && DEVELOPER_TEAM_ID.test(value)
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  const [a, b, c] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function mappedIpv4(hostname: string): string | undefined {
  const suffix = hostname.toLowerCase().match(/^::ffff:(.+)$/)?.[1]
  if (!suffix) return undefined
  if (suffix.includes('.')) return suffix

  const words = suffix.split(':')
  if (words.length !== 2 || words.some(word => !/^[\da-f]{1,4}$/.test(word))) return undefined
  const values = words.map(word => Number.parseInt(word, 16))
  return [values[0] >> 8, values[0] & 0xff, values[1] >> 8, values[1] & 0xff].join('.')
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.cluster.local') ||
    host.endsWith('.google.internal')
  ) {
    return true
  }

  const ipVersion = isIP(host)
  if (ipVersion === 4) return isPrivateIpv4(host)
  if (ipVersion === 6) {
    const mapped = mappedIpv4(host)
    if (mapped) return isPrivateIpv4(mapped)
    return (
      host === '::' ||
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe8') ||
      host.startsWith('fe9') ||
      host.startsWith('fea') ||
      host.startsWith('feb') ||
      host.startsWith('ff')
    )
  }
  return false
}

function validateUrl(
  value: string,
  label: string,
  protocols: Array<'http:' | 'https:'>,
  options: UrlOptions = {}
): ValidationResult {
  if (value.length > MAX_URL_LENGTH) {
    return `${label} must be at most ${MAX_URL_LENGTH.toLocaleString('en-US')} characters.`
  }
  const url = parsedUrl(value)
  const protocolText = protocols.length === 1 ? 'https://' : 'http(s)'
  if (!url || !protocols.includes(url.protocol as 'http:' | 'https:')) {
    return `${label} must be a valid ${protocolText} URL.`
  }
  if (url.username || url.password) return `${label} must not contain embedded credentials.`
  if (options.publicOnly && isPrivateHost(url.hostname)) return `${label} must use a public internet host.`
  return true
}

export function validateHttpUrl(value: string, label: string, options?: UrlOptions): ValidationResult {
  return validateUrl(value, label, ['http:', 'https:'], options)
}

export function validateHttpsUrl(value: string, label: string, options?: UrlOptions): ValidationResult {
  return validateUrl(value, label, ['https:'], options)
}

export function validateYouTubeUrl(value: string, label: string): ValidationResult {
  const httpsCheck = validateHttpsUrl(value, label)
  if (httpsCheck !== true) return httpsCheck
  const url = new URL(value)
  const host = url.hostname.toLowerCase()
  let videoId: string | null = null
  if (host === 'youtu.be') {
    videoId = url.pathname.slice(1)
  } else if (host === 'youtube.com' || host === 'www.youtube.com') {
    if (url.pathname === '/watch') videoId = url.searchParams.get('v')
    else if (url.pathname.startsWith('/embed/')) videoId = url.pathname.slice('/embed/'.length)
  }
  const validId =
    videoId?.length === YOUTUBE_VIDEO_ID_LENGTH &&
    [...videoId].every(character => YOUTUBE_VIDEO_ID_CHARACTERS.includes(character))
  return validId ? true : `${label} must be a valid HTTPS YouTube URL.`
}

function isAsciiDecimal(code: number): boolean {
  return code >= 0x30 && code <= 0x39
}

function isAsciiHex(code: number): boolean {
  return isAsciiDecimal(code) || (code >= 0x41 && code <= 0x46) || (code >= 0x61 && code <= 0x66)
}

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)
}

function isAsciiWord(code: number): boolean {
  return isAsciiLetter(code) || isAsciiDecimal(code) || code === 0x5f
}

function isSecurityWhitespace(code: number): boolean {
  return (
    (code >= 0x09 && code <= 0x0d) ||
    code === 0x20 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  )
}

function skipSecurityWhitespace(value: string, start: number): number {
  let index = start
  while (index < value.length && isSecurityWhitespace(value.charCodeAt(index))) index += 1
  return index
}

interface DecodedSecurityEntity {
  end: number
  value: string
}

function decodeSecurityEntityAt(value: string, start: number): DecodedSecurityEntity | undefined {
  if (value.charCodeAt(start) !== 0x26) return undefined
  if (value.charCodeAt(start + 1) !== 0x23) {
    for (const [entity, decoded] of SECURITY_NAMED_ENTITIES) {
      if (value.slice(start, start + entity.length).toLowerCase() === entity) {
        return { end: start + entity.length, value: decoded }
      }
    }
    return undefined
  }

  let cursor = start + 2
  let radix = 10
  let maximumDigits = 10
  let isDigit = isAsciiDecimal
  const prefix = value.charCodeAt(cursor)
  if (prefix === 0x58 || prefix === 0x78) {
    cursor += 1
    radix = 16
    maximumDigits = 8
    isDigit = isAsciiHex
  }
  const digitStart = cursor
  while (cursor < value.length && isDigit(value.charCodeAt(cursor))) cursor += 1
  const digitCount = cursor - digitStart
  if (digitCount === 0 || digitCount > maximumDigits) return undefined
  const decoded = Number.parseInt(value.slice(digitStart, cursor), radix)
  if (value.charCodeAt(cursor) === 0x3b) cursor += 1
  return { end: cursor, value: String.fromCharCode(decoded) }
}

function decodeSecurityEntitiesOnce(value: string): string {
  const parts: string[] = []
  let chunkStart = 0
  let cursor = 0
  while (cursor < value.length) {
    const entity = decodeSecurityEntityAt(value, cursor)
    if (!entity) {
      cursor += 1
      continue
    }
    parts.push(value.slice(chunkStart, cursor), entity.value)
    cursor = entity.end
    chunkStart = cursor
  }
  if (chunkStart === 0) return value
  parts.push(value.slice(chunkStart))
  return parts.join('')
}

function decodeSecurityEntities(value: string): string {
  let decoded = value
  for (let pass = 0; pass < 2; pass += 1) {
    const next = decodeSecurityEntitiesOnce(decoded)
    if (next === decoded) return decoded
    decoded = next
  }
  return decoded
}

function hasWordBoundaryBefore(value: string, index: number): boolean {
  return index === 0 || !isAsciiWord(value.charCodeAt(index - 1))
}

function containsBlockedTagOrEvent(value: string): boolean {
  let searchFrom = 0
  while (searchFrom < value.length) {
    const tagStart = value.indexOf('<', searchFrom)
    if (tagStart < 0) return false
    const nextTag = value.indexOf('<', tagStart + 1)
    const closingBracket = value.indexOf('>', tagStart + 1)
    let segmentEnd = closingBracket < 0 ? value.length : closingBracket
    if (nextTag >= 0 && nextTag < segmentEnd) segmentEnd = nextTag

    let nameStart = tagStart + 1
    if (value.charCodeAt(nameStart) === 0x2f) nameStart += 1
    let nameEnd = nameStart
    while (nameEnd < segmentEnd && isAsciiLetter(value.charCodeAt(nameEnd))) nameEnd += 1
    if (XSS_BLOCKED_TAGS.has(value.slice(nameStart, nameEnd)) && !isAsciiWord(value.charCodeAt(nameEnd))) {
      return true
    }

    for (let index = tagStart + 1; index < segmentEnd - 2; index += 1) {
      if (!hasWordBoundaryBefore(value, index) || !value.startsWith('on', index)) continue
      let cursor = index + 2
      const eventNameStart = cursor
      while (cursor < segmentEnd && isAsciiWord(value.charCodeAt(cursor))) cursor += 1
      if (cursor === eventNameStart) continue
      cursor = skipSecurityWhitespace(value, cursor)
      if (value.charCodeAt(cursor) === 0x3d) return true
    }

    if (segmentEnd >= value.length) return false
    searchFrom = segmentEnd === nextTag ? segmentEnd : segmentEnd + 1
  }
  return false
}

function containsBoundedToken(value: string, token: string, suffix: number, requireBoundary: boolean): boolean {
  let searchFrom = 0
  while (searchFrom < value.length) {
    const index = value.indexOf(token, searchFrom)
    if (index < 0) return false
    if (!requireBoundary || hasWordBoundaryBefore(value, index)) {
      const cursor = skipSecurityWhitespace(value, index + token.length)
      if (value.charCodeAt(cursor) === suffix) return true
    }
    searchFrom = index + 1
  }
  return false
}

function containsBlockedScheme(value: string): boolean {
  for (const scheme of XSS_BLOCKED_SCHEMES) {
    if (containsBoundedToken(value, scheme, 0x3a, true)) return true
  }
  return false
}

function containsBlockedUrl(value: string): boolean {
  let searchFrom = 0
  while (searchFrom < value.length) {
    const index = value.indexOf('url', searchFrom)
    if (index < 0) return false
    let cursor = skipSecurityWhitespace(value, index + 3)
    if (value.charCodeAt(cursor) === 0x28) {
      cursor = skipSecurityWhitespace(value, cursor + 1)
      const quote = value.charCodeAt(cursor)
      if (quote === 0x22 || quote === 0x27) cursor += 1
      if (XSS_BLOCKED_URL_SCHEMES.some(scheme => value.startsWith(scheme, cursor))) return true
    }
    searchFrom = index + 1
  }
  return false
}

function containsBlockedCall(value: string): boolean {
  if (containsBoundedToken(value, 'expression', 0x28, false)) return true
  if (containsBoundedToken(value, 'behavior', 0x3a, false)) return true
  for (const callable of XSS_BLOCKED_CALLS) {
    if (containsBoundedToken(value, callable, 0x28, true)) return true
  }
  return false
}

function containsUnsafeXssContent(value: string): boolean {
  const normalized = decodeSecurityEntities(value).toLowerCase()
  return (
    containsBlockedTagOrEvent(normalized) ||
    containsBlockedScheme(normalized) ||
    containsBlockedUrl(normalized) ||
    containsBlockedCall(normalized)
  )
}

/* Uses bounded deterministic scanning for backend-equivalent high-risk XSS
   checks while allowing benign marketplace-description HTML. */
export function validateXssSafe(value: string, label: string): ValidationResult {
  if (value.length > MAX_SECURITY_TEXT_LENGTH) {
    return `${label} must be at most ${MAX_SECURITY_TEXT_LENGTH.toLocaleString('en-US')} characters.`
  }
  return containsUnsafeXssContent(value)
    ? `${label} contains potentially dangerous script content or event handlers.`
    : true
}

export function validateEmail(value: string): ValidationResult {
  const email = value.trim()
  const match = /^([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+)@(.+)$/.exec(email)
  if (
    !match ||
    email.length > 254 ||
    match[1].length > 64 ||
    match[1].startsWith('.') ||
    match[1].endsWith('.') ||
    match[1].includes('..')
  ) {
    return 'Support email must be a valid email address.'
  }
  const domain = match[2]
  if (/^\[.*\]$/.test(domain)) {
    return isIP(domain.slice(1, -1)) === 4 ? true : 'Support email must be a valid email address.'
  }
  return /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(domain)
    ? true
    : 'Support email must be a valid email address.'
}

export function validatePhone(value: string): ValidationResult {
  const digits = value.replace(/\D/g, '')
  if (!/^\+?[\d()\s.-]+$/.test(value) || value.slice(1).includes('+') || digits.length < 7 || digits.length > 15) {
    return 'Support phone must be a valid phone number with 7 to 15 digits.'
  }
  return true
}

export function validatePositiveInteger(value: number, label: string, range: IntegerRange): ValidationResult {
  return Number.isInteger(value) && value >= range.min && value <= range.max
    ? true
    : `${label} must be an integer between ${range.min} and ${range.max}.`
}

export function validateDeprecationDate(value: string, now = new Date()): ValidationResult {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return 'Deprecation date must be a valid date in YYYY-MM-DD format.'

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const selected = new Date(year, month - 1, day)
  if (selected.getFullYear() !== year || selected.getMonth() !== month - 1 || selected.getDate() !== day) {
    return 'Deprecation date must be a valid date in YYYY-MM-DD format.'
  }

  const minimum = new Date(now)
  minimum.setHours(0, 0, 0, 0)
  minimum.setDate(minimum.getDate() + 3)
  return selected >= minimum ? true : 'Deprecation date must be at least 3 days from today.'
}

/* Mirrors the portal's sandbox-account password rules: 12+ chars with
   uppercase, lowercase, number, and special character. */
export function validateSandboxPassword(value: string): ValidationResult {
  if (value.length < 12) return 'Password must be at least 12 characters long.'
  if (!/[A-Z]/.test(value)) return 'Password must contain an uppercase letter.'
  if (!/[a-z]/.test(value)) return 'Password must contain a lowercase letter.'
  if (!/[0-9]/.test(value)) return 'Password must contain a number.'
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/.test(value)) {
    return 'Password must contain a special character.'
  }
  return true
}

function containsSingleSeparatorHighLevel(value: string): boolean {
  let searchFrom = 0
  while (searchFrom < value.length) {
    const index = value.indexOf('high', searchFrom)
    if (index < 0) return false
    const suffix = index + 4
    if (value.startsWith('level', suffix)) return true
    const separator = value.charCodeAt(suffix)
    if (
      ![0x0a, 0x0d, 0x2028, 0x2029].includes(separator) &&
      value.startsWith('level', suffix + 1)
    ) {
      return true
    }
    searchFrom = index + 1
  }
  return false
}

function containsSpacedGoHighLevel(value: string): boolean {
  let searchFrom = 0
  while (searchFrom < value.length) {
    const index = value.indexOf('go', searchFrom)
    if (index < 0) return false
    let cursor = index + 2
    if (!isSecurityWhitespace(value.charCodeAt(cursor))) {
      searchFrom = index + 1
      continue
    }
    cursor = skipSecurityWhitespace(value, cursor)
    if (!value.startsWith('high', cursor)) {
      searchFrom = index + 1
      continue
    }
    cursor += 4
    if (isSecurityWhitespace(value.charCodeAt(cursor))) {
      cursor = skipSecurityWhitespace(value, cursor)
      if (value.startsWith('level', cursor)) return true
    }
    searchFrom = index + 1
  }
  return false
}

function containsStandaloneGhl(value: string): boolean {
  let searchFrom = 0
  while (searchFrom < value.length) {
    const index = value.indexOf('ghl', searchFrom)
    if (index < 0) return false
    const after = index + 3
    if (hasWordBoundaryBefore(value, index) && !isAsciiWord(value.charCodeAt(after))) return true
    searchFrom = index + 1
  }
  return false
}

/* Mirrors the portal's brand variants with bounded literal scanning so user
   text is never evaluated by a regular-expression engine. */
export function validateTextForWhiteLabel(value: string, label: string): ValidationResult {
  if (value.length > MAX_SECURITY_TEXT_LENGTH) {
    return `${label} must be at most ${MAX_SECURITY_TEXT_LENGTH.toLocaleString('en-US')} characters.`
  }
  const normalized = value.toLowerCase()
  return (
    containsSingleSeparatorHighLevel(normalized) ||
    containsSpacedGoHighLevel(normalized) ||
    containsStandaloneGhl(normalized)
  )
    ? `${label} must not reference GHL or HighLevel — this app is marked white-label friendly.`
    : true
}

export function validateProfileName(value: string): ValidationResult {
  const name = value.trim()
  if (!name) return 'Profile name is required.'
  if (!/^(?!__)[a-zA-Z0-9][a-zA-Z0-9._-]{0,49}$/.test(name)) {
    return 'Profile name must use 1-50 letters, numbers, dots, underscores, or hyphens and cannot start with "__".'
  }
  return true
}
