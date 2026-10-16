import { Flags } from '@oclif/core'

import { GhlCommand } from '../../lib/shared/command.js'
import { ApiClient } from '../../lib/api/client.js'
import { getConfig } from '../../lib/config/environment.js'
import { assertAppDirectoryAvailable } from '../../lib/app/workspace.js'
import { buildCreateAppBody, type CreateAppAnswers, validateAppName } from '../../lib/app/create.js'
import { initializeCreatedApp } from '../../lib/app/workspace-create.js'
import { input, select } from '../../lib/shared/prompts.js'
import { withSpinner } from '../../lib/shared/spinner.js'
import { collectWorkspaceDirectory } from '../../lib/shared/workspace-input.js'

export default class AppCreate extends GhlCommand {
  static description = 'Create a new app and its local JSON workspace'

  static examples = [
    '<%= config.bin %> app create',
    '<%= config.bin %> app create --name "My App" --type public --target sub-account --installer everyone --listing white-label',
    '<%= config.bin %> app create --name "My App" --type private --target agency --listing standard --directory ./apps'
  ]

  static enableJsonFlag = true

  static flags = {
    name: Flags.string({ description: 'App name (max 50 characters)' }),
    type: Flags.string({ description: 'App visibility', options: ['public', 'private'] }),
    target: Flags.string({ description: 'Who the app is for', options: ['sub-account', 'agency'] }),
    installer: Flags.string({
      description: 'Who can install the app (only for --target sub-account)',
      options: ['everyone', 'agency-only']
    }),
    listing: Flags.string({ description: 'Listing type', options: ['white-label', 'standard'] }),
    directory: Flags.string({ description: 'Parent directory for the app folder (default: current directory)' }),
    folder: Flags.string({ description: 'App folder name (default: app-name slug)' })
  }

  protected async execute(): Promise<unknown> {
    const { flags } = await this.parse(AppCreate)
    const interactive = process.stdin.isTTY === true && !this.jsonEnabled()

    if (flags.target === 'agency' && flags.installer) {
      this.error('--installer only applies when --target is sub-account (agency apps are installed by agencies).')
    }

    const answers = await this.collectAnswers(flags, interactive)
    const directory = await collectWorkspaceDirectory({
      appName: answers.name,
      flags,
      interactive
    })
    await assertAppDirectoryAvailable(directory)
    if (answers.type === 'private' && !this.jsonEnabled()) {
      this.log('Note: private apps have install limits — see the marketplace policies for details.')
    }

    const config = getConfig()
    const client = new ApiClient(config)
    const created = await withSpinner(
      'Creating app...',
      async () => {
        await client.init()
        return client.createApp(buildCreateAppBody(answers))
      },
      { quiet: this.jsonEnabled() }
    )

    const { selected, files: workspace } = await withSpinner(
      'Writing app files...',
      () => initializeCreatedApp(client, config, created, directory),
      { quiet: this.jsonEnabled() }
    )
    if (this.jsonEnabled()) return { app: created, selected, files: workspace }

    this.log(`\nCreated "${selected.name}" (appId: ${selected.appId}, versionId: ${selected.versionId}).`)
    this.log(`App files were created in ${workspace.directory}`)
    this.log('This app is now selected — subsequent commands will target it.')
  }

  /* Flags always win. Interactive terminals prompt for missing choices;
     automated callers must provide every choice explicitly. */
  private async collectAnswers(
    flags: { name?: string; type?: string; target?: string; installer?: string; listing?: string },
    interactive: boolean
  ): Promise<CreateAppAnswers> {
    if (!interactive) {
      const missing = [
        !flags.name && '--name',
        !flags.type && '--type',
        !flags.target && '--target',
        !flags.listing && '--listing',
        flags.target === 'sub-account' && !flags.installer && '--installer'
      ].filter(Boolean)
      if (missing.length > 0) {
        this.error(
          `Missing required flag(s) for non-interactive use: ${missing.join(', ')}. ` +
            'Sub-account apps also require --installer everyone|agency-only.'
        )
      }
    }

    let name = flags.name
    if (!name) {
      if (!interactive) this.error('--name is required when running non-interactively.')
      name = await input({
        message: 'App name:',
        validate: value => validateAppName(value)
      })
    }
    const nameCheck = validateAppName(name)
    if (nameCheck !== true) this.error(nameCheck)

    const type =
      flags.type ??
      (interactive
        ? await select({
            message: 'App type:',
            choices: [
              { name: 'Public — listed on the marketplace', value: 'public' },
              { name: 'Private — install via link only (install limits apply)', value: 'private' }
            ]
          })
        : undefined)

    const target =
      flags.target ??
      (interactive
        ? await select({
            message: 'Who is the target user of the app?',
            choices: [
              { name: 'Sub-account (recommended)', value: 'sub-account' },
              { name: 'Agency', value: 'agency' }
            ]
          })
        : undefined)

    /* The portal only asks this for sub-account apps; agency apps are
       always installed by agencies. */
    let installer: CreateAppAnswers['installer']
    if (target === 'sub-account') {
      installer =
        (flags.installer as CreateAppAnswers['installer']) ??
        (interactive
          ? await select({
              message: 'Who can install the app?',
              choices: [
                { name: 'Everyone — agencies and sub-accounts', value: 'everyone' as const },
                { name: 'Agency only', value: 'agency-only' as const }
              ]
            })
          : undefined)
    }

    const listing =
      flags.listing ??
      (interactive
        ? await select({
            message: 'Listing type:',
            choices: [
              { name: 'White-label — can be rebranded by agencies', value: 'white-label' },
              { name: 'Standard — always shows your branding', value: 'standard' }
            ]
          })
        : undefined)

    return {
      name,
      type: type as CreateAppAnswers['type'],
      target: target as CreateAppAnswers['target'],
      installer,
      listing: listing as CreateAppAnswers['listing']
    }
  }
}
