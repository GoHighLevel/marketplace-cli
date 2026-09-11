import { Command, Flags } from '@oclif/core'

import { type AppVersion } from '../../lib/api/client.js'
import { checkbox, input, isPromptCancel } from '../../lib/shared/prompts.js'
import {
  buildSupportBody,
  SUPPORTED_SERVICES,
  type SupportChanges,
  validateSupportBody,
  validateSupportUrl
} from '../../lib/app/profile-sections.js'
import { followVersionChange, loadAppContext } from '../../lib/app/section-context.js'
import { withSpinner } from '../../lib/shared/spinner.js'
import { validateEmail, validatePhone } from '../../lib/shared/validation.js'

interface SupportFlags {
  email?: string
  phone?: string
  website?: string
  'docs-url'?: string
  'terms-url'?: string
  'privacy-url'?: string
  service?: string[]
}

export default class AppSupport extends Command {
  static description = 'Edit the support details of the selected app (interactive, or via flags)'

  static examples = [
    '<%= config.bin %> app support',
    '<%= config.bin %> app support --email support@acme.com --docs-url https://docs.acme.com'
  ]

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' }),
    email: Flags.string({ description: 'Support email (email or phone is required to publish)' }),
    phone: Flags.string({ description: 'Support phone (email or phone is required)' }),
    website: Flags.string({ description: 'Support website (HTTPS; scheme may be omitted)' }),
    'docs-url': Flags.string({ description: 'Documentation URL (HTTPS; scheme may be omitted)' }),
    'terms-url': Flags.string({ description: 'Terms & conditions URL (HTTPS; scheme may be omitted)' }),
    'privacy-url': Flags.string({ description: 'Privacy policy URL (HTTPS; scheme may be omitted)' }),
    service: Flags.string({
      description: 'Support service offered for template apps (repeatable)',
      options: [...SUPPORTED_SERVICES],
      multiple: true
    })
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(AppSupport)
    const changes = this.changesFromFlags(flags)
    const hasFlagChanges = Object.keys(changes).length > 0

    if (!hasFlagChanges && !process.stdin.isTTY) {
      this.error('Pass at least one field flag (--email, --phone, ...) when running non-interactively.')
    }

    try {
      const context = await loadAppContext(flags.app)
      if (flags.service !== undefined && context.version.appType !== 'template') {
        this.error('--service only applies to template apps.')
      }
      const finalChanges = hasFlagChanges ? changes : await this.promptChanges(context.version)

      const body = buildSupportBody(context.version, finalChanges)
      const validation = validateSupportBody(body, context.version.appType === 'template')
      if (validation !== true) this.error(validation)
      const result = await withSpinner('Saving support details...', () =>
        context.client.updateProfileSection('supportDetails', context.selected.appId, context.selected.versionId, body)
      )
      this.log('Support details updated.')
      await followVersionChange(context, result, message => this.log(message))
    } catch (error) {
      if (isPromptCancel(error)) {
        this.log(error.message)
        return
      }
      this.error(error instanceof Error ? error.message : 'Failed to update support details')
    }
  }

  private changesFromFlags(flags: SupportFlags): SupportChanges {
    const changes: SupportChanges = {}
    if (flags.email !== undefined) changes.supportEmail = flags.email
    if (flags.phone !== undefined) changes.supportPhone = flags.phone
    if (flags.website !== undefined) changes.websiteUrl = flags.website
    if (flags['docs-url'] !== undefined) changes.documentationUrl = flags['docs-url']
    if (flags['terms-url'] !== undefined) changes.termsAndConditionsUrl = flags['terms-url']
    if (flags['privacy-url'] !== undefined) changes.privacyPolicyUrl = flags['privacy-url']
    if (flags.service !== undefined) changes.supportedServices = flags.service
    return changes
  }

  private async promptChanges(version: AppVersion): Promise<SupportChanges> {
    const current = version.supportConfig ?? {}
    const changes: SupportChanges = {
      supportEmail: await input({
        message: 'Support email:',
        default: current.supportEmail ?? '',
        validate: value => (value.trim() ? validateEmail(value) : true)
      }),
      supportPhone: await input({
        message: 'Support phone (optional):',
        default: current.supportPhone ?? '',
        validate: value => (value.trim() ? validatePhone(value) : true)
      }),
      websiteUrl: await input({
        message: 'Support website URL (optional):',
        default: current.websiteUrl ?? '',
        validate: value => (value.trim() ? validateSupportUrl(value, 'Support website URL') : true)
      }),
      documentationUrl: await input({
        message: 'Documentation URL (optional):',
        default: current.documentationUrl ?? '',
        validate: value => (value.trim() ? validateSupportUrl(value, 'Documentation URL') : true)
      }),
      termsAndConditionsUrl: await input({
        message: 'Terms & conditions URL (optional):',
        default: current.termsAndConditionsUrl ?? '',
        validate: value => (value.trim() ? validateSupportUrl(value, 'Terms and conditions URL') : true)
      }),
      privacyPolicyUrl: await input({
        message: 'Privacy policy URL (optional):',
        default: current.privacyPolicyUrl ?? '',
        validate: value => (value.trim() ? validateSupportUrl(value, 'Privacy policy URL') : true)
      })
    }
    if (version.appType === 'template') {
      changes.supportedServices = await checkbox({
        message: 'Which support services do you offer?',
        choices: SUPPORTED_SERVICES.map(service => ({
          name: service.replaceAll('_', ' '),
          value: service,
          checked: current.supportedServices?.includes(service) ?? false
        })),
        validate: values => (values.length > 0 ? true : 'Select at least one supported service.')
      })
    }
    return changes
  }
}
