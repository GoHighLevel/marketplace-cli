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

/* Mirrors the backend's high-risk XSS checks while allowing ordinary text
   and benign HTML used in marketplace descriptions. */
export function validateXssSafe(value: string, label: string): ValidationResult {
  if (value.length > MAX_SECURITY_TEXT_LENGTH) {
    return `${label} must be at most ${MAX_SECURITY_TEXT_LENGTH.toLocaleString('en-US')} characters.`
  }
  const decoded = value
    .replace(/&#x([0-9a-f]{1,8})(?![0-9a-f]);?/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]{1,10})(?![0-9]);?/g, (_match, decimal: string) => String.fromCharCode(Number.parseInt(decimal, 10)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
  const unsafe = [
    /<\/?script\b/i,
    /<(?:iframe|object|embed|form|meta|link|style|base|html|body)\b/i,
    /<[^<>]*\bon\w+\s*=/i,
    /\b(?:javascript|data|vbscript|mhtml|about):/i,
    /expression\s*\(/i,
    /behavior\s*:/i,
    /url\s*\(\s*["']?(?:javascript|data|vbscript):/i,
    /\b(?:alert|eval|setTimeout|setInterval|Function)\s*\(/i
  ]
  return unsafe.some(pattern => pattern.test(decoded))
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

/* Mirrors the portal's white-label check: white-label friendly apps must not
   reference the GHL brand in user-visible values (URLs, plan names, features). */
export function validateTextForWhiteLabel(value: string, label: string): ValidationResult {
  if (value.length > MAX_SECURITY_TEXT_LENGTH) {
    return `${label} must be at most ${MAX_SECURITY_TEXT_LENGTH.toLocaleString('en-US')} characters.`
  }
  const brand = /(Go-)?HighLevel|GoHighLevel|\bGHL\b|High.?Level|Go\s+High\s+Level/i
  return brand.test(value)
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
