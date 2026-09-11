import {
  type WorkflowResource,
  type WorkflowResourceManifest,
  type WorkflowResourcePlan,
  type WorkflowResourceWorkspace
} from '../shared/resource.js'
import { workflowCreateArgs, workflowCreateFlags, WorkflowCreateCommand } from './create.js'
import { workflowDeleteFlags, WorkflowDeleteCommand, workflowSelectorArgs } from './delete.js'
import { workflowDiffFlags, WorkflowDiffCommand } from './diff.js'
import { workflowListFlags, WorkflowListCommand } from './list.js'
import { workflowNewVersionFlags, WorkflowNewVersionCommand } from './new-version.js'
import { workflowPublishFlags, WorkflowPublishCommand } from './publish.js'
import { workflowPullFlags, WorkflowPullCommand } from './pull.js'
import { workflowPushFlags, WorkflowPushCommand } from './push.js'
import { workflowValidateFlags, WorkflowValidateCommand } from './validate.js'

/* Binds the shared workflow command implementations to one resource. The
   returned classes carry the parsed flags and arguments; the exported oclif
   command for each resource only adds its description and examples.

   `enableJsonFlag` is declared on these classes rather than on the abstract
   bases because oclif's manifest builder stops walking the prototype chain at
   the first ancestor without its own static properties. */
export function workflowResourceCommands<
  M extends WorkflowResourceManifest,
  P extends WorkflowResourcePlan,
  W extends WorkflowResourceWorkspace<M>,
  F,
  S
>(resource: WorkflowResource<M, P, W, F, S>) {
  const listFlags = workflowListFlags()
  const createArgs = workflowCreateArgs(resource)
  const createFlags = workflowCreateFlags(resource)
  const selectorArgs = workflowSelectorArgs(resource)
  const deleteFlags = workflowDeleteFlags()
  const diffFlags = workflowDiffFlags()
  const newVersionFlags = workflowNewVersionFlags()
  const publishFlags = workflowPublishFlags(resource)
  const pullFlags = workflowPullFlags()
  const pushFlags = workflowPushFlags(resource)
  const validateFlags = workflowValidateFlags(resource)
  const selector = (args: Record<string, string | undefined>): string | undefined => args[resource.singular]

  return {
    List: class extends WorkflowListCommand<M, P, W, F, S> {
      static enableJsonFlag = true
      static flags = listFlags
      protected readonly resource = resource
      protected async execute(): Promise<unknown> {
        const { flags } = await this.parse({ flags: listFlags, enableJsonFlag: true })
        return this.list(flags)
      }
    },
    Create: class extends WorkflowCreateCommand<M, P, W, F, S> {
      static enableJsonFlag = true
      static args = createArgs
      static flags = createFlags
      protected readonly resource = resource
      protected async execute(): Promise<unknown> {
        const { args, flags } = await this.parse({ args: createArgs, flags: createFlags, enableJsonFlag: true })
        return this.create({ name: args.name, key: flags.key, directory: flags.directory })
      }
    },
    Delete: class extends WorkflowDeleteCommand<M, P, W, F, S> {
      static enableJsonFlag = true
      static args = selectorArgs
      static flags = deleteFlags
      protected readonly resource = resource
      protected async execute(): Promise<unknown> {
        const { args, flags } = await this.parse({ args: selectorArgs, flags: deleteFlags, enableJsonFlag: true })
        return this.delete({ selector: selector(args), directory: flags.directory, force: flags.force })
      }
    },
    Diff: class extends WorkflowDiffCommand<M, P, W, F, S> {
      static enableJsonFlag = true
      static flags = diffFlags
      protected readonly resource = resource
      protected async execute(): Promise<unknown> {
        const { flags } = await this.parse({ flags: diffFlags, enableJsonFlag: true })
        return this.diff(flags)
      }
    },
    NewVersion: class extends WorkflowNewVersionCommand<M, P, W, F, S> {
      static enableJsonFlag = true
      static args = selectorArgs
      static flags = newVersionFlags
      protected readonly resource = resource
      protected async execute(): Promise<unknown> {
        const { args, flags } = await this.parse({ args: selectorArgs, flags: newVersionFlags, enableJsonFlag: true })
        return this.newVersion({ selector: selector(args), directory: flags.directory })
      }
    },
    Publish: class extends WorkflowPublishCommand<M, P, W, F, S> {
      static enableJsonFlag = true
      static args = selectorArgs
      static flags = publishFlags
      protected readonly resource = resource
      protected async execute(): Promise<unknown> {
        const { args, flags } = await this.parse({ args: selectorArgs, flags: publishFlags, enableJsonFlag: true })
        return this.publish({
          selector: selector(args),
          directory: flags.directory,
          version: flags.version,
          notes: flags.notes,
          force: flags.force
        })
      }
    },
    Pull: class extends WorkflowPullCommand<M, P, W, F, S> {
      static enableJsonFlag = true
      static flags = pullFlags
      protected readonly resource = resource
      protected async execute(): Promise<unknown> {
        const { flags } = await this.parse({ flags: pullFlags, enableJsonFlag: true })
        return this.pull(flags)
      }
    },
    Push: class extends WorkflowPushCommand<M, P, W, F, S> {
      static enableJsonFlag = true
      static flags = pushFlags
      protected readonly resource = resource
      protected async execute(): Promise<unknown> {
        const { flags } = await this.parse({ flags: pushFlags, enableJsonFlag: true })
        return this.push({ directory: flags.directory, dryRun: flags['dry-run'], force: flags.force })
      }
    },
    Validate: class extends WorkflowValidateCommand<M, P, W, F, S> {
      static enableJsonFlag = true
      static flags = validateFlags
      protected readonly resource = resource
      protected async execute(): Promise<unknown> {
        /* The key flag is named after the resource (--action, --trigger), so the
           parsed values are narrowed here instead of inferred from the definitions. */
        const parsed = await this.parse(this.ctor)
        const flags: Record<string, unknown> = parsed.flags
        const key = flags[resource.singular]
        return this.validate({
          directory: typeof flags.directory === 'string' ? flags.directory : '.',
          publishable: flags.publishable === true,
          key: typeof key === 'string' ? key : undefined,
          version: typeof flags.version === 'string' ? flags.version : undefined
        })
      }
    }
  }
}
