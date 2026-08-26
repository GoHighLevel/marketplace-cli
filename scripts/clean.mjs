import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const distributionDirectory = fileURLToPath(new URL('../dist', import.meta.url))

rmSync(distributionDirectory, { force: true, recursive: true })
