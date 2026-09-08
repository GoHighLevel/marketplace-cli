import { Command, Flags } from '@oclif/core'

import {
  externalAuthPlanError,
  loadExternalAuthSyncContext
} from '../../../lib/external-auth/command-context.js'
import { prepareExternalAuthUpdateBody } from '../../../lib/external-auth/manifest.js'
import {
  externalAuthManifestsEquivalent,
  fetchExternalAuthSnapshot,
  resolveExternalAuthLocks
} from '../../../lib/external-auth/service.js'
import { writeExternalAuthWorkspace } from '../../../lib/external-auth/workspace.js'
import { withSpinner } from '../../../lib/shared/spinner.js'

export default class AppExternalAuthPush extends Command {
  static description = 'Validate and push changed external-auth configuration to a draft app version'

  static examples = [
    '<%= config.bin %> app external-auth push',
    '<%= config.bin %> app external-auth push --dry-run --json'
  ]

  static enableJsonFlag = true

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    'dry-run': Flags.boolean({ description: 'Validate and show changed paths without updating the portal or local state' })
  }

  async run(): Promise<unknown> {
    const { flags } = await this.parse(AppExternalAuthPush)
    let apiUpdated = false
    try {
      const context = await withSpinner(
        'Validating and planning external-auth push...',
        () => loadExternalAuthSyncContext(flags.directory),
        { quiet: this.jsonEnabled() }
      )
      const planError = externalAuthPlanError(context.plan)
      if (planError) throw planError
      const preview = {
        appId: context.appId,
        versionId: context.versionId,
        updateRequired: context.plan.updateRequired,
        changedPaths: context.plan.localChanges
      }
      if (flags['dry-run']) {
        if (this.jsonEnabled()) return { dryRun: true, ...preview }
        this.log(`Validation passed. API update: ${preview.updateRequired ? 'required' : 'none'}.`)
        for (const path of preview.changedPaths) this.log(`  update ${path}`)
        return
      }

      let synchronized = context.remote
      if (context.plan.updateRequired) {
        const body = prepareExternalAuthUpdateBody(context.plan.desired, context.remote.raw)
        try {
          await withSpinner(
            'Pushing external authentication...',
            () => context.client.updateExternalAuthConfig(context.appId, context.versionId, body),
            { quiet: this.jsonEnabled() }
          )
          apiUpdated = true
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'the request failed'
          throw new Error(
            `The external-auth update could not be confirmed: ${reason}. ` +
              'The portal may have changed; run `ghl app external-auth pull` before making more changes.'
          )
        }
        synchronized = await fetchExternalAuthSnapshot(context.client, context.appId, context.versionId)
        if (!externalAuthManifestsEquivalent(synchronized.manifest, context.plan.desired)) {
          throw new Error(
            'The portal state did not match the requested external-auth configuration after the update. ' +
              'Run `ghl app external-auth pull` before making more changes.'
          )
        }
      }
      const locks = await resolveExternalAuthLocks(context.client, context.appId, {
        versionId: context.versionId,
        response: synchronized.raw
      })
      const files = await writeExternalAuthWorkspace(
        context.directory,
        synchronized.manifest,
        synchronized.manifest,
        locks
      )
      const result = { ...preview, files }
      if (this.jsonEnabled()) return result
      this.log(context.plan.updateRequired
        ? 'External authentication was updated and verified.'
        : 'No external-auth API update was required; local files are synchronized.')
      return
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Failed to push external authentication.'
      this.error(apiUpdated
        ? `The external-auth API update completed, but local verification or synchronization failed: ${reason} ` +
          'Run `ghl app external-auth pull` before making more changes.'
        : reason)
    }
  }
}
