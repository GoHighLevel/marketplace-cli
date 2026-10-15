import { Flags } from '@oclif/core'

import { GhlCommand } from '../../lib/shared/command.js'
import { input, select } from '../../lib/shared/prompts.js'
import type { AppVersion } from '../../lib/api/types.js'
import { normalizeKeywords } from '../../lib/app/categories.js'
import {
  buildListingBody,
  currentInstaller,
  currentTarget,
  type ListingChanges
} from '../../lib/app/profile-sections.js'
import { followVersionChangeNotes, loadAppContext, versionResult } from '../../lib/app/section-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'

export default class AppListing extends GhlCommand {
  static description = 'Edit the listing configuration of the selected app (interactive, or via flags)'

  static examples = [
    '<%= config.bin %> app listing',
    '<%= config.bin %> app listing --listing standard --keywords "crm,automation"',
    '<%= config.bin %> app listing --type public'
  ]

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    type: Flags.string({
      description: 'App type — converting to public makes it installable from the marketplace',
      options: ['public', 'private']
    }),
    target: Flags.string({ description: 'Who the app is for', options: ['sub-account', 'agency'] }),
    installer: Flags.string({
      description: 'Who can install the app (only for sub-account target)',
      options: ['everyone', 'agency-only']
    }),
    listing: Flags.string({ description: 'Listing type', options: ['white-label', 'standard'] }),
    keywords: Flags.string({ description: 'Comma-separated search keywords (200 characters total)' })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppListing)
    const json = this.jsonEnabled()
    const changes = this.changesFromFlags(flags)
    const hasFlagChanges = Object.keys(changes).length > 0
    const interactive = process.stdin.isTTY === true && !json

    if (!hasFlagChanges && !interactive) {
      this.error('Pass at least one field flag (--target, --listing, ...) when running non-interactively.')
    }

    const context = await loadAppContext(flags.app, json)
    const finalChanges = hasFlagChanges ? changes : await this.promptChanges(context.version)

    const body = buildListingBody(context.version, finalChanges)
    const result = await withSpinner(
      'Saving listing configuration...',
      () =>
        context.client.updateProfileSection(
          'listingConfiguration',
          context.selected.appId,
          context.selected.versionId,
          body
        ),
      { quiet: json }
    )
    if (!json) this.logSaved(finalChanges, context.version.private ?? false)
    const notes = await followVersionChangeNotes(context, result)
    if (json) return versionResult(context, body, notes)
    for (const note of notes) this.log(note)
  }

  private logSaved(changes: ListingChanges, wasPrivate: boolean): void {
    this.log('Listing configuration updated.')
    if (changes.type === 'public' && wasPrivate) {
      this.log('App converted to public — publishing now submits it for marketplace review.')
      this.log('Review submissions need demo details: `ghl app review-details`.')
    } else if (changes.type === 'private' && !wasPrivate) {
      this.log('App converted to private — publishing takes it live directly.')
    }
  }

  private changesFromFlags(flags: Record<string, string | undefined>): ListingChanges {
    const changes: ListingChanges = {}
    if (flags.type !== undefined) changes.type = flags.type as ListingChanges['type']
    if (flags.target !== undefined) changes.target = flags.target as ListingChanges['target']
    if (flags.installer !== undefined) changes.installer = flags.installer as ListingChanges['installer']
    if (flags.listing !== undefined) changes.listing = flags.listing as ListingChanges['listing']
    if (flags.keywords !== undefined) {
      const result = normalizeKeywords(flags.keywords)
      if (typeof result === 'string') this.error(result)
      changes.keywords = result
    }
    return changes
  }

  private async promptChanges(version: AppVersion): Promise<ListingChanges> {
    const type = await select({
      message: 'App type:',
      default: (version.private ?? false) ? 'private' : 'public',
      choices: [
        { name: 'Private — installable only via direct link', value: 'private' as const },
        { name: 'Public — listed on the marketplace (requires review)', value: 'public' as const }
      ]
    })

    const target = await select({
      message: 'Who is the target user of the app?',
      default: currentTarget(version),
      choices: [
        { name: 'Sub-account (recommended)', value: 'sub-account' as const },
        { name: 'Agency', value: 'agency' as const }
      ]
    })

    /* Mirrors the portal: the installer question only exists for sub-account apps. */
    let installer: ListingChanges['installer']
    if (target === 'sub-account') {
      installer = await select({
        message: 'Who can install the app?',
        default: currentInstaller(version),
        choices: [
          { name: 'Everyone — agencies and sub-accounts', value: 'everyone' as const },
          { name: 'Agency only', value: 'agency-only' as const }
        ]
      })
    }

    const listing = await select({
      message: 'Listing type:',
      default: (version.isWhiteLabelFriendly ?? true) ? 'white-label' : 'standard',
      choices: [
        { name: 'White-label — can be rebranded by agencies', value: 'white-label' as const },
        { name: 'Standard — always shows your branding', value: 'standard' as const }
      ]
    })

    const keywords = await input({
      message: 'Search keywords, comma-separated:',
      default: (version.searchKeywords ?? []).join(', '),
      validate: value => {
        const result = normalizeKeywords(value)
        return typeof result === 'string' ? result : true
      }
    })

    return {
      type,
      target,
      installer,
      listing,
      keywords: (() => {
        const result = normalizeKeywords(keywords)
        if (typeof result === 'string') throw new Error(result)
        return result
      })()
    }
  }
}
