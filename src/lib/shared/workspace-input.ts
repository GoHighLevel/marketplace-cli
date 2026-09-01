import { input } from './prompts.js'
import { resolveAppDirectory, slugifyAppName, validateAppFolderName } from '../app/workspace.js'

export interface WorkspaceFlags {
  directory?: string
  folder?: string
}

export async function collectWorkspaceDirectory(options: {
  appId?: string
  appName: string
  flags: WorkspaceFlags
  interactive: boolean
}): Promise<string> {
  const suggestedFolder = slugifyAppName(options.appName, options.appId)
  const parentDirectory =
    options.flags.directory ??
    (options.interactive
      ? await input({
          message: 'Parent directory for the app folder:',
          default: process.cwd(),
          validate: value => value.trim().length > 0 || 'Parent directory is required.'
        })
      : process.cwd())
  const folder =
    options.flags.folder ??
    (options.interactive
      ? await input({
          message: 'App folder name:',
          default: suggestedFolder,
          validate: validateAppFolderName
        })
      : suggestedFolder)
  return resolveAppDirectory(parentDirectory, folder)
}
