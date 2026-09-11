import { Args } from '@oclif/core'

import { GhlCommand } from '../../lib/shared/command.js'
import { select } from '../../lib/shared/prompts.js'
import { ApiClient } from '../../lib/api/client.js'
import { findAppById, listAllApps, persistSelection, toLatestSelectedApp } from '../../lib/app/context.js'
import { getConfig } from '../../lib/config/environment.js'
import { withSpinner } from '../../lib/shared/spinner.js'

export default class AppUse extends GhlCommand {
  static description = 'Select the app that subsequent commands will target'

  static examples = ['<%= config.bin %> app use', '<%= config.bin %> app use 67ee6752f753647b1c9ae06e']

  static args = {
    appId: Args.string({ description: 'App id to select (omit to pick from a list)', required: false })
  }

  protected async execute(): Promise<void> {
    const { args } = await this.parse(AppUse)
    const config = getConfig()

    const client = new ApiClient(config)
    if (args.appId) {
      const selected = await withSpinner(`Selecting app ${args.appId}...`, async () => {
        await client.init()
        return findAppById(client, args.appId as string)
      })
      await persistSelection(client, config, selected)
      this.log(`Selected "${selected.name}" (appId: ${selected.appId}, versionId: ${selected.versionId}).`)
      return
    }

    if (!process.stdin.isTTY) {
      this.error('No appId given. Pass one (`ghl app use <appId>`) when running non-interactively.')
    }

    const apps = await withSpinner('Fetching apps...', async () => {
      await client.init()
      return listAllApps(client)
    })
    if (apps.length === 0) {
      this.error('No apps found in your developer account. Create one with `ghl app create`.')
    }

    const choice = await select({
      message: 'Select an app:',
      choices: apps.map(app => ({
        name: `${app.name} (${app.appId ?? app._id}, ${app.status ?? 'unknown'})`,
        value: app
      }))
    })

    const selected = await toLatestSelectedApp(client, choice)
    await persistSelection(client, config, selected)
    this.log(`Selected "${selected.name}" (appId: ${selected.appId}, versionId: ${selected.versionId}).`)
  }
}
