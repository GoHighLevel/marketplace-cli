import { errorMessage } from '../shared/errors.js'
import type { AppVersion, BillingSettings, ProfileUpdateResult } from '../api/types.js'
import { buildAuthSettingsBody } from '../auth/settings.js'
import { buildBillingSettings } from '../billing/pricing.js'
import {
  buildBasicInfoBody,
  buildListingBody,
  buildProfilesBody,
  buildReviewDetailsBody,
  buildSupportBody,
  extractNewVersion
} from './profile-sections.js'
import { type AppSyncPlan, appVersionFromFiles, validateSyncPlan } from './sync.js'

export interface PushClient {
  updateProfileSection(
    section: 'basicInfo' | 'listingConfiguration' | 'appProfiles' | 'supportDetails',
    appId: string,
    versionId: string,
    body: unknown
  ): Promise<ProfileUpdateResult>
  updateReviewDetails(appId: string, versionId: string, body: unknown): Promise<ProfileUpdateResult>
  updateAuthSettings(appId: string, versionId: string, body: unknown): Promise<ProfileUpdateResult>
  makeRedirectUrlDefault(appId: string, versionId: string, redirectUrl: string): Promise<unknown>
  makeClientKeyDefault(appId: string, clientKeyId: string): Promise<void>
  updateBillingSettings(appId: string, body: BillingSettings): Promise<unknown>
}

export interface AppPushResult {
  appliedSections: AppSyncPlan['sections']
  versionId: string
}

function followResultVersion(appId: string, currentVersionId: string, result: ProfileUpdateResult): string {
  const next = extractNewVersion(result)
  if (next.appId && next.appId !== appId) {
    throw new Error(`The update API returned app "${next.appId}" instead of "${appId}".`)
  }
  return next.versionId ?? currentVersionId
}

function reviewBody(version: AppVersion): Record<string, unknown> {
  const { testCredentials: _secret, ...body } = buildReviewDetailsBody(version, {})
  return body
}

function billingBody(plan: AppSyncPlan): BillingSettings {
  const { billing, appType } = plan.desired.app
  const externalBillingUrl = billing.externalBilling
    ? /^https:\/\//i.test(billing.externalBillingUrl)
      ? billing.externalBillingUrl
      : `https://${billing.externalBillingUrl}`
    : undefined
  return buildBillingSettings({
    model: billing.billingType,
    externalBillingUrl,
    trialDays: billing.hasFreeTrial ? (billing.freeTrialDuration ?? undefined) : undefined,
    isTemplateApp: appType === 'template'
  })
}

export async function executeAppSyncPlan(
  client: PushClient,
  remoteVersion: AppVersion,
  plan: AppSyncPlan
): Promise<AppPushResult> {
  const validation = validateSyncPlan(plan, remoteVersion)
  if (validation.errors.length > 0) throw new Error(`App push validation failed:\n- ${validation.errors.join('\n- ')}`)

  const appId = plan.appId
  let versionId = remoteVersion._id
  const appliedSections: AppSyncPlan['sections'] = []
  let activeSection: AppSyncPlan['sections'][number] | undefined
  const requiresDraftAuth = plan.localChanges.some(change =>
    ['oauth.allowedScopes', 'oauth.redirectUris'].includes(change.path)
  )

  try {
    for (const section of plan.sections) {
      activeSection = section
      const version = appVersionFromFiles(plan.desired, { ...remoteVersion, _id: versionId })
      if (section === 'listing') {
        const result = await client.updateProfileSection(
          'listingConfiguration',
          appId,
          versionId,
          buildListingBody(version, {})
        )
        versionId = followResultVersion(appId, versionId, result)
      } else if (section === 'basicInfo') {
        const result = await client.updateProfileSection('basicInfo', appId, versionId, buildBasicInfoBody(version, {}))
        versionId = followResultVersion(appId, versionId, result)
      } else if (section === 'profiles') {
        const result = await client.updateProfileSection(
          'appProfiles',
          appId,
          versionId,
          buildProfilesBody(version, {})
        )
        versionId = followResultVersion(appId, versionId, result)
      } else if (section === 'support') {
        const result = await client.updateProfileSection(
          'supportDetails',
          appId,
          versionId,
          buildSupportBody(version, {})
        )
        versionId = followResultVersion(appId, versionId, result)
      } else if (section === 'authSettings') {
        if (remoteVersion.status?.toLowerCase() === 'live' && requiresDraftAuth && versionId === remoteVersion._id) {
          throw new Error('The preceding update did not return a draft version for the OAuth settings change.')
        }
        const result = await client.updateAuthSettings(appId, versionId, buildAuthSettingsBody(version, {}))
        versionId = followResultVersion(appId, versionId, result)
      } else if (section === 'defaultRedirect') {
        await client.makeRedirectUrlDefault(appId, versionId, version.defaults!.redirectUrl!)
      } else if (section === 'defaultClientKey') {
        await client.makeClientKeyDefault(appId, version.defaults!.clientKey!)
      } else if (section === 'review') {
        const result = await client.updateReviewDetails(appId, versionId, reviewBody(version))
        versionId = followResultVersion(appId, versionId, result)
      } else {
        await client.updateBillingSettings(appId, billingBody(plan))
      }
      appliedSections.push(section)
    }
  } catch (error) {
    const reason = errorMessage(error, 'The API rejected the update.')
    const applied = appliedSections.length > 0 ? appliedSections.join(', ') : 'none'
    throw new Error(
      `${reason} Push stopped while applying ${activeSection ?? 'the plan'}; completed sections: ${applied}. ` +
        'Run `ghl app pull` before retrying because the last section may have been applied.'
    )
  }

  return { appliedSections, versionId }
}
