import path from 'node:path'

/* Path helpers for a target platform, so Windows paths can be built and
   tested on any host. */
export function platformPath(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}
