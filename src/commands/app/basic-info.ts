import { Command, Flags } from '@oclif/core'

import { checkbox, input, isPromptCancel } from '../../lib/shared/prompts.js'
import { AppVersion } from '../../lib/api/client.js'
import {
  CATEGORY_GROUPS,
  normalizeBusinessNiches,
  normalizeSubcategories
} from '../../lib/app/categories.js'
import { validateAppName } from '../../lib/app/create.js'
import { BasicInfoChanges, buildBasicInfoBody, validateBasicInfoBody } from '../../lib/app/profile-sections.js'
import { followVersionChange, loadAppContext } from '../../lib/app/section-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'
import { validateHttpsUrl } from '../../lib/shared/validation.js'

export default class AppBasicInfo extends Command {
  static description = 'Edit the basic info of the selected app (interactive, or via flags)'

  static examples = [
    '<%= config.bin %> app basic-info',
    '<%= config.bin %> app basic-info --tagline "Scheduling made simple" --website https://acme.com'
  ]

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    name: Flags.string({ description: 'App name (max 50 characters)' }),
    tagline: Flags.string({ description: 'Tagline (20-170 characters)' }),
    company: Flags.string({ description: 'Company name (max 50 characters)' }),
    website: Flags.string({ description: 'HTTPS website URL (optional)' }),
    category: Flags.string({ description: 'One to three comma-separated marketplace categories' }),
    niche: Flags.string({ description: 'Up to three comma-separated marketplace business niches' }),
    'logo-url': Flags.string({ description: 'HTTPS logo URL (prefer `ghl app media upload --logo`)' })
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(AppBasicInfo)
    const changes = this.changesFromFlags(flags)
    const hasFlagChanges = Object.keys(changes).length > 0

    if (!hasFlagChanges && !process.stdin.isTTY) {
      this.error('Pass at least one field flag (--name, --tagline, ...) when running non-interactively.')
    }

    try {
      const context = await loadAppContext(flags.app)
      if (context.version.appType === 'template') {
        const unsupported = Object.keys(changes).filter(key => !['companyName', 'website'].includes(key))
        if (unsupported.length > 0) {
          this.error('Template apps only support --company and --website in basic info, matching the developer portal.')
        }
      }
      const finalChanges = hasFlagChanges ? changes : await this.promptChanges(context.version)

      const body = buildBasicInfoBody(context.version, finalChanges)
      const validation = validateBasicInfoBody(body, context.version.isWhiteLabelFriendly ?? true)
      if (validation !== true) this.error(validation)
      const result = await withSpinner('Saving basic info...', () =>
        context.client.updateProfileSection('basicInfo', context.selected.appId, context.selected.versionId, body)
      )
      this.log('Basic info updated.')
      await followVersionChange(context, result, message => this.log(message))
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to update basic info')
    }
  }

  private changesFromFlags(flags: Record<string, string | undefined>): BasicInfoChanges {
    const changes: BasicInfoChanges = {}
    if (flags.name !== undefined) {
      const check = validateAppName(flags.name)
      if (check !== true) this.error(check)
      changes.name = flags.name
    }
    if (flags.tagline !== undefined) changes.tagline = flags.tagline
    if (flags.company !== undefined) changes.companyName = flags.company
    if (flags.website !== undefined) changes.website = flags.website
    if (flags.category !== undefined) {
      const result = normalizeSubcategories(flags.category)
      if (typeof result === 'string') this.error(result)
      changes.subcategory = result
    }
    if (flags.niche !== undefined) {
      const result = normalizeBusinessNiches(flags.niche)
      if (typeof result === 'string') this.error(result)
      changes.businessNiche = result
    }
    if (flags['logo-url'] !== undefined) changes.logoUrl = flags['logo-url']
    return changes
  }

  private async promptChanges(version: AppVersion): Promise<BasicInfoChanges> {
    if (version.appType === 'template') {
      const companyName = await input({
        message: 'Company name (max 50 characters):',
        default: version.companyName ?? '',
        validate: value => {
          const length = value.trim().length
          return length > 0 && length <= 50 ? true : 'Company name is required and must be at most 50 characters.'
        }
      })
      const website = await input({
        message: 'Website URL (optional, https):',
        default: version.website ?? '',
        validate: value => (value.trim() ? validateHttpsUrl(value, 'Website URL') : true)
      })
      return { companyName, website }
    }
    const name = await input({
      message: 'App name:',
      default: version.name ?? '',
      validate: value => validateAppName(value)
    })
    const tagline = await input({
      message: 'Tagline (20-170 characters):',
      default: version.tagline ?? '',
      validate: value => {
        const length = value.trim().length
        return length >= 20 && length <= 170 ? true : 'Tagline must contain between 20 and 170 characters.'
      }
    })
    const companyName = await input({
      message: 'Company name (max 50 characters):',
      default: version.companyName ?? '',
      validate: value => {
        const length = value.trim().length
        return length > 0 && length <= 50 ? true : 'Company name is required and must be at most 50 characters.'
      }
    })
    const website = await input({
      message: 'Website URL (optional, https):',
      default: version.website ?? '',
      validate: value => (value.trim() ? validateHttpsUrl(value, 'Website URL') : true)
    })

    const categories = await checkbox({
      message: 'Categories (select 1-3):',
      choices: Object.entries(CATEGORY_GROUPS).flatMap(([group, labels]) =>
        labels.map(label => ({
          name: `${group} — ${label}`,
          value: label.toLowerCase(),
          checked: (version.subcategory ?? []).includes(label.toLowerCase())
        }))
      ),
      validate: values => (values.length >= 1 && values.length <= 3 ? true : 'Select between 1 and 3 categories.')
    })
    const niche = await input({
      message: 'Business niche(s), comma-separated:',
      default: (version.businessNiche ?? []).join(', '),
      validate: value => {
        const result = normalizeBusinessNiches(value)
        return typeof result === 'string' ? result : true
      }
    })

    return {
      name,
      tagline,
      companyName,
      website,
      subcategory: categories,
      businessNiche: (() => {
        const result = normalizeBusinessNiches(niche)
        if (typeof result === 'string') throw new Error(result)
        return result
      })()
    }
  }
}
