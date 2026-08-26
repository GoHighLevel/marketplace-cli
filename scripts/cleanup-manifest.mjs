import { rmSync } from 'node:fs'

rmSync('oclif.manifest.json', { force: true })
