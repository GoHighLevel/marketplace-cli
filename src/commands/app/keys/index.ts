import { Command, Flags } from '@oclif/core'

import { loadAppContext } from '../../../lib/app/section-context.js'

export default class AppKeys extends Command {
  static description = 'Show the client keys of the selected app'

  static examples = ['<%= config.bin %> app keys', '<%= config.bin %> app keys create my-key']

  static enableJsonFlag = true

  static flags = {
    app: Flags.string({ description: 'App id (defaults to the selected app)' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppKeys)
    try {
      const context = await loadAppContext(flags.app, this.jsonEnabled())
      const keys = (context.version.clientKeys ?? []).filter(key => !key.deleted)
      const defaultClientKeyId = context.version.defaults?.clientKey

      if (this.jsonEnabled()) return { clientKeys: keys, defaultClientKeyId }

      if (keys.length === 0) {
        this.log('No client keys. Create one with `ghl app keys create <name>`.')
        return
      }
      this.log(`${keys.length} client key(s):`)
      for (const key of keys) {
        const isDefault = key.id === defaultClientKeyId || key.isDefault === true || key.default === true
        this.log(`  ${key.id ?? '(no id)'}  ${key.name ?? ''}${isDefault ? '  (default)' : ''}`)
      }
      return
    } catch (error) {
      this.error(error instanceof Error ? error.message : 'Failed to load client keys')
    }
  }
}
