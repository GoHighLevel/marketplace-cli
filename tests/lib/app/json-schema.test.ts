import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  JSON_SCHEMA_NAMES,
  JSON_SCHEMA_REFERENCES,
  JSON_SCHEMA_RELATIVE_PATHS,
  getJsonSchema,
  writeJsonSchemaWorkspace
} from '../../../src/lib/app/json-schema.js'

const directories: string[] = []

function localReferences(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(localReferences)
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) =>
    key === '$ref' && typeof child === 'string' && child.startsWith('#/') ? [child] : localReferences(child)
  )
}

function resolveLocalReference(schema: Record<string, unknown>, reference: string): unknown {
  return reference
    .slice(2)
    .split('/')
    .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce<unknown>(
      (current, segment) =>
        current && typeof current === 'object' ? (current as Record<string, unknown>)[segment] : undefined,
      schema
    )
}

async function workspace(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ghl-json-schema-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })))
})

describe('JSON schema registry', () => {
  it('covers every user-editable JSON configuration surface with strict draft-07 schemas', () => {
    expect(JSON_SCHEMA_NAMES).toEqual([
      'app',
      'webhooks',
      'workflow-action',
      'workflow-trigger',
      'subscription',
      'usage-based'
    ])

    for (const name of JSON_SCHEMA_NAMES) {
      const schema = getJsonSchema(name)
      expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#')
      expect(schema.$id).toBe(path.basename(JSON_SCHEMA_RELATIVE_PATHS[name]))
      expect(schema.type).toBe('object')
      expect(schema.additionalProperties).toBe(false)
      expect(schema.properties).toHaveProperty('$schema')
      expect(schema.$comment).toMatch(/generated.*ghl app pull.*do not edit/i)
      for (const reference of localReferences(schema)) {
        expect(resolveLocalReference(schema, reference), `${name}: ${reference}`).toBeDefined()
      }
    }

    expect(getJsonSchema('app').properties).toHaveProperty('profiles')
    expect(getJsonSchema('workflow-action').definitions).toHaveProperty('actionInput')
    expect(getJsonSchema('workflow-trigger').definitions).toHaveProperty('triggerFilter')
    expect(getJsonSchema('subscription').definitions).toHaveProperty('subscriptionPlan')
    expect(getJsonSchema('usage-based').definitions).toHaveProperty('usageMeter')
  })

  it('returns independent schema values that callers cannot mutate globally', () => {
    const schema = getJsonSchema('app')
    schema.title = 'Changed by caller'

    expect(getJsonSchema('app').title).toBe('HighLevel App Manifest')
  })

  it('requires standard app names to contain visible characters', () => {
    expect(getJsonSchema('app')).toMatchObject({
      allOf: [
        {
          if: {
            properties: { appType: { not: { const: 'template' } } },
            required: ['appType']
          },
          then: {
            properties: {
              basicInfo: {
                properties: {
                  name: { type: 'string', minLength: 1, pattern: '\\S' }
                }
              }
            }
          }
        }
      ]
    })
  })
})

describe('writeJsonSchemaWorkspace', () => {
  it('writes deterministic local schemas and creates VS Code associations once', async () => {
    const directory = await workspace()
    const first = await writeJsonSchemaWorkspace(directory)

    expect(first.schemaFiles).toEqual(
      JSON_SCHEMA_NAMES.map(name => path.join(directory, JSON_SCHEMA_RELATIVE_PATHS[name]))
    )
    for (const name of JSON_SCHEMA_NAMES) {
      const file = path.join(directory, JSON_SCHEMA_RELATIVE_PATHS[name])
      await expect(fs.readFile(file, 'utf8')).resolves.toBe(`${JSON.stringify(getJsonSchema(name), null, 2)}\n`)
      expect((await fs.stat(file)).mode & 0o777).toBe(0o644)
    }

    const settingsFile = path.join(directory, '.vscode', 'settings.json')
    expect(first.vscodeSettingsFile).toBe(settingsFile)
    expect(first.vscodeSettingsCreated).toBe(true)
    expect(JSON.parse(await fs.readFile(settingsFile, 'utf8'))).toEqual({
      'json.schemas': JSON_SCHEMA_NAMES.map(name => ({
        fileMatch: expect.any(Array),
        url: `./${JSON_SCHEMA_RELATIVE_PATHS[name].split(path.sep).join('/')}`
      }))
    })

    const customized = '{\n  "editor.tabSize": 4\n}\n'
    await fs.writeFile(settingsFile, customized)
    await fs.writeFile(first.schemaFiles[0], '{}\n')
    const second = await writeJsonSchemaWorkspace(directory)

    expect(second.vscodeSettingsCreated).toBe(false)
    await expect(fs.readFile(settingsFile, 'utf8')).resolves.toBe(customized)
    await expect(fs.readFile(first.schemaFiles[0], 'utf8')).resolves.toBe(
      `${JSON.stringify(getJsonSchema('app'), null, 2)}\n`
    )
  })

  it('rejects a symbolic-link schema directory without changing its target', async () => {
    const directory = await workspace()
    const target = await workspace()
    await fs.mkdir(path.join(directory, '.ghl'))
    await fs.symlink(target, path.join(directory, '.ghl', 'schemas'))

    await expect(writeJsonSchemaWorkspace(directory)).rejects.toThrow(/schema directory.*symbolic link/i)
    await expect(fs.readdir(target)).resolves.toEqual([])
  })
})

describe('schema references', () => {
  it('uses paths relative to each generated JSON file', () => {
    expect(JSON_SCHEMA_REFERENCES).toEqual({
      app: './.ghl/schemas/ghl-app.schema.json',
      webhooks: '../../.ghl/schemas/ghl-webhooks.schema.json',
      'workflow-action': '../../../../.ghl/schemas/ghl-workflow-action.schema.json',
      'workflow-trigger': '../../../../.ghl/schemas/ghl-workflow-trigger.schema.json',
      subscription: '../../.ghl/schemas/ghl-subscription.schema.json',
      'usage-based': '../../.ghl/schemas/ghl-usage-based.schema.json'
    })
  })
})
