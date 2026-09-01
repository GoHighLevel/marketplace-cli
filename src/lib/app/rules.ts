export function normalizeStatus(status: string | undefined): string {
  return status?.toLowerCase().replace(/[\s_-]/g, '') ?? ''
}

export function requireVersionStatus(status: string | undefined, allowed: string[], action: string): void {
  if (!status) throw new Error(`Cannot ${action}: the selected version status is unavailable.`)
  const normalized = normalizeStatus(status)
  if (allowed.map(value => normalizeStatus(value)).includes(normalized)) return
  const expected = allowed.length === 1 ? allowed[0] : `${allowed.slice(0, -1).join(', ')} or ${allowed.at(-1)}`
  throw new Error(`Cannot ${action} this version: it must be ${expected} (currently ${status}).`)
}

export function requiresPublicReviewDetails(version: { private?: boolean; appType?: string }): boolean {
  return version.private !== true && version.appType !== 'template'
}

export function requireSecurityReviewEligible(
  version: { private?: boolean; status?: string; securityReview?: { status?: string } },
  agencyInstallCount: number
): void {
  requireVersionStatus(version.status, ['live'], 'request a security review for')
  if (version.private !== true) throw new Error('Security review is only available for private apps.')
  const reviewStatus = normalizeStatus(version.securityReview?.status)
  if (reviewStatus === 'inreview') throw new Error('A security review is already in progress for this app.')
  if (!Number.isInteger(agencyInstallCount) || agencyInstallCount < 4) {
    throw new Error(
      `Security review becomes available after four qualifying agency installs (currently ${agencyInstallCount}).`
    )
  }
}

export function formatReadinessError(validation: {
  message?: string
  mandatoryFields?: Record<string, boolean>
}): string {
  const missing = Object.entries(validation.mandatoryFields ?? {})
    .filter(([, valid]) => !valid)
    .map(([field]) => field)
  const reason = validation.message?.trim() || 'This app is not ready to publish.'
  const missingText = missing.length > 0 ? ` Missing: ${missing.join(', ')}.` : ''
  return `${reason}${missingText} Run \`ghl app validate --remote\` for fix commands.`
}
