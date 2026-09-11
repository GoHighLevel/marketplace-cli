import { Flags } from '@oclif/core'

import { GhlCommand } from '../../lib/shared/command.js'
import { errorMessage } from '../../lib/shared/errors.js'
import type { AppVersion, PreSubmitValidation } from '../../lib/api/types.js'
import { currentInstaller, currentTarget } from '../../lib/app/profile-sections.js'
import { publishReadinessSymbol } from '../../lib/app/publish-readiness.js'
import { loadAppContext } from '../../lib/app/section-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'

export default class AppInfo extends GhlCommand {
  static description = 'Show all details of the selected app'

  static examples = ['<%= config.bin %> app info', '<%= config.bin %> app info --json']

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppInfo)

    const context = await loadAppContext(flags.app, this.jsonEnabled())
    let validation: PreSubmitValidation | undefined
    let readinessError: string | undefined
    try {
      validation = await withSpinner(
        'Checking publish readiness...',
        () => context.client.preSubmitValidation(context.selected.appId, context.selected.versionId),
        { quiet: this.jsonEnabled() }
      )
    } catch (error) {
      readinessError = errorMessage(error, 'Publish readiness check failed.')
    }

    if (this.jsonEnabled()) {
      return { version: context.version, readiness: validation?.mandatoryFields ?? null, readinessError }
    }

    this.render(context.version, context.selected.appId, validation)
    if (readinessError) this.warn(`Publish readiness unavailable: ${readinessError}`)
  }

  private render(v: AppVersion, appId: string, validation?: PreSubmitValidation): void {
    const line = (label: string, value?: string | number | boolean) =>
      this.log(`  ${label.padEnd(18)} ${value === undefined || value === '' ? '-' : String(value)}`)

    this.log(`\n${v.name ?? 'Unnamed app'}`)
    line('App ID', appId)
    line('Version ID', v._id)
    line('Status', v.status)
    line('Type', v.private ? 'private' : 'public')
    line('App module', v.appType)

    this.log('\nBasic info')
    line('Tagline', v.tagline)
    line('Company', v.companyName)
    line('Website', v.website)
    line('Category', (v.subcategory ?? []).join(', '))
    line('Niche', (v.businessNiche ?? []).join(', '))
    line('Logo', v.logoUrl)

    this.log('\nListing')
    const target = currentTarget(v)
    line('Target user', target)
    line('Installer', target === 'sub-account' ? currentInstaller(v) : '-')
    line('Listing type', (v.isWhiteLabelFriendly ?? true) ? 'white-label' : 'standard')
    line('Keywords', (v.searchKeywords ?? []).join(', '))

    this.log('\nProfiles')
    line('Agency descr.', this.truncate(v.description))
    line('Agency video', v.previewVideoUrl)
    line('Agency images', `${(v.previewImageUrls ?? []).length} screenshot(s)`)
    line('Sub-acct profile', v.hasSubAccountProfile ? 'enabled' : 'disabled')
    if (v.hasSubAccountProfile) {
      line('Sub-acct descr.', this.truncate(v.subAccountDescription))
      line('Sub-acct images', `${(v.subAccountPreviewImageUrls ?? []).length} screenshot(s)`)
    }

    this.log('\nSupport')
    const support = v.supportConfig ?? {}
    line('Email', support.supportEmail)
    line('Phone', support.supportPhone)
    line('Website', support.websiteUrl)
    line('Docs', support.documentationUrl)
    line('Terms', support.termsAndConditionsUrl)
    line('Privacy', support.privacyPolicyUrl)

    this.log('\nReview details')
    line('E2E demo', v.endToEndDemoUrl)
    line('Scopes demo', v.scopesDemoUrl)
    line('Test credentials', v.testCredentials ? 'provided' : '-')
    if (v.private) line('Private reason', this.truncate(v.privateReason))

    this.log('\nAuth & webhooks')
    line('Scopes', (v.allowedScopes ?? []).length)
    line('Redirect URIs', (v.redirectUris ?? []).length)
    line('Client keys', (v.clientKeys ?? []).length)
    line('Webhook URL', v.webhookUrl)
    line('Events', (v.subscribedEvents ?? []).length)

    this.log('\nPricing')
    line('Model', v.billingType)
    line('External billing', v.externalBilling ? 'enabled' : 'disabled')
    if (v.externalBilling) line('Billing URL', v.externalBillingUrl)
    line('Free trial', v.hasFreeTrial ? `${v.freeTrialDuration ?? '-'} day(s)` : 'disabled')

    if (validation?.mandatoryFields) {
      this.log('\nPublish readiness')
      for (const [field, ok] of Object.entries(validation.mandatoryFields)) {
        this.log(`  ${publishReadinessSymbol(ok)} ${field}`)
      }
    }
    this.log('')
  }

  private truncate(value?: string): string | undefined {
    if (!value) return value
    return value.length > 60 ? `${value.slice(0, 60)}...` : value
  }
}
