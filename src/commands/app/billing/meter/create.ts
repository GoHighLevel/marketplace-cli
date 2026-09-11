import { Args, Flags } from '@oclif/core'

import { GhlCommand } from '../../../../lib/shared/command.js'
import { validateLocalBillingIntent } from '../../../../lib/billing/command-context.js'
import {
  type BillingCustomPriceType,
  type BillingProductType,
  createBillingMeterScaffold
} from '../../../../lib/billing/manifest.js'
import { loadBillingWorkspace, writeLocalBillingWorkspace } from '../../../../lib/billing/workspace.js'
import { input, select } from '../../../../lib/shared/prompts.js'
import { validateHttpsUrl } from '../../../../lib/shared/validation.js'
import { loadWorkflowActionsWorkspaceIfPresent } from '../../../../lib/workflows/actions/workspace.js'
import { loadWorkflowTriggersWorkspaceIfPresent } from '../../../../lib/workflows/triggers/workspace.js'

const UNIT_PRICE_INPUT_MAX_LENGTH = 32

function containsOnlyDigits(value: string): boolean {
  if (!value) return false
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 48 || code > 57) return false
  }
  return true
}

function hasValidUnitPriceFormat(value: string): boolean {
  const separator = value.indexOf('.')
  if (separator === -1) return containsOnlyDigits(value)
  if (separator !== value.lastIndexOf('.')) return false
  const integer = value.slice(0, separator)
  const fraction = value.slice(separator + 1)
  return fraction.length <= 6 && containsOnlyDigits(integer) && containsOnlyDigits(fraction)
}

function unitPrice(value: string | undefined, label: string): number {
  if (value === undefined) throw new Error(`${label} is required.`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number.`)
  return parsed
}

function validateUnitPriceInput(value: string, label: string): true | string {
  if (value.length > UNIT_PRICE_INPUT_MAX_LENGTH) {
    return `${label} must be at most ${UNIT_PRICE_INPUT_MAX_LENGTH} characters.`
  }
  const trimmed = value.trim()
  if (!hasValidUnitPriceFormat(trimmed)) return `${label} must have at most six decimal places.`
  const parsed = Number(trimmed)
  return parsed >= 0.000001 && parsed <= 200 ? true : `${label} must be between 0.000001 and 200.`
}

function validateExecutionLimitInput(value: string): true | string {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? true : 'Execution limit must be a positive integer.'
}

function customProductId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!slug) throw new Error('Pass --product-id because the product name cannot produce a stable custom id.')
  return `custom_${slug}`
}

export default class AppBillingMeterCreate extends GhlCommand {
  static description = 'Add a usage meter to local JSON; run billing push to create it remotely'

  static examples = [
    '<%= config.bin %> app billing meter create "Action executions" --product-type workflow_action --product-id send_message --price 0.01 --execution-limit 1000',
    '<%= config.bin %> app billing meter create "Messages" --product-type conversation_provider --product-id providerId --product-name Provider --direction inbound --price 0.001 --execution-limit 10000',
    '<%= config.bin %> app billing meter create "Exports" --product-type custom --product-name Export --usage-unit export --price 0.02 --execution-limit 500'
  ]

  static enableJsonFlag = true

  static args = {
    name: Args.string({ description: 'Pricing tier name (prompted interactively when omitted)' })
  }

  static flags = {
    directory: Flags.string({ description: 'App workspace directory (default: current directory)', default: '.' }),
    'product-type': Flags.string({
      description: 'Meter product type',
      options: ['conversation_provider', 'workflow_action', 'workflow_trigger', 'custom']
    }),
    'product-id': Flags.string({ description: 'Provider id, workflow key, or stable custom_ id' }),
    'product-name': Flags.string({ description: 'Customer-facing product name' }),
    direction: Flags.string({ description: 'Conversation direction', options: ['inbound', 'outbound'] }),
    'usage-unit': Flags.string({ description: 'Custom usage unit (provider/workflow units are inferred)' }),
    'price-type': Flags.string({ description: 'Custom product pricing mode', options: ['fixed', 'dynamic'] }),
    price: Flags.string({ description: 'Unit price in USD (0.000001-200, up to six decimals)' }),
    'min-price': Flags.string({ description: 'Minimum unit price for dynamic custom pricing' }),
    'max-price': Flags.string({ description: 'Maximum unit price for dynamic custom pricing' }),
    'pricing-page-url': Flags.string({ description: 'Public HTTPS pricing page for dynamic custom pricing' }),
    'execution-limit': Flags.integer({ description: 'Maximum executions per billing cycle' })
  }

  protected async execute(): Promise<unknown> {
    const { args, flags } = await this.parse(AppBillingMeterCreate)
    const interactive = process.stdin.isTTY === true && !this.jsonEnabled()
    if ((!args.name || !flags['product-type'] || !flags.price || !flags['execution-limit']) && !interactive) {
      this.error('Pass the tier name, --product-type, --price, and --execution-limit when running non-interactively.')
    }
    const workspace = await loadBillingWorkspace(flags.directory)
    const name =
      args.name ??
      (await input({
        message: 'Pricing tier name:',
        validate: value => (value.trim() ? true : 'Pricing tier name is required.')
      }))
    const productType = (flags['product-type'] ??
      (await select({
        message: 'Product type:',
        choices: [
          { name: 'Workflow action', value: 'workflow_action' as const },
          { name: 'Workflow trigger', value: 'workflow_trigger' as const },
          { name: 'Conversation provider', value: 'conversation_provider' as const },
          { name: 'Custom product', value: 'custom' as const }
        ]
      }))) as BillingProductType
    const [actions, triggers] = await Promise.all([
      loadWorkflowActionsWorkspaceIfPresent(workspace.directory),
      loadWorkflowTriggersWorkspaceIfPresent(workspace.directory)
    ])
    let productId = flags['product-id']
    let productName = flags['product-name']
    if (productType === 'workflow_action') {
      const registered = new Set(actions?.state.baseline.actions.map(action => action.key) ?? [])
      const definitions = actions?.manifest.actions.filter(action => registered.has(action.key)) ?? []
      if (!productId && interactive && definitions.length > 0) {
        productId = await select({
          message: 'Workflow action:',
          choices: definitions.map(action => ({
            name: `${action.versions[0]?.info.name ?? action.key} (${action.key})`,
            value: action.key
          }))
        })
      }
      if (!productId && interactive && definitions.length === 0) {
        throw new Error('No remotely registered workflow actions are available. Run `ghl app actions push` first.')
      }
      const action = definitions.find(item => item.key === productId)
      productName ??= action?.versions[0]?.info.name
    }
    if (productType === 'workflow_trigger') {
      const registered = new Set(triggers?.state.baseline.triggers.map(trigger => trigger.key) ?? [])
      const definitions = triggers?.manifest.triggers.filter(trigger => registered.has(trigger.key)) ?? []
      if (!productId && interactive && definitions.length > 0) {
        productId = await select({
          message: 'Workflow trigger:',
          choices: definitions.map(trigger => ({
            name: `${trigger.versions[0]?.info.name ?? trigger.key} (${trigger.key})`,
            value: trigger.key
          }))
        })
      }
      if (!productId && interactive && definitions.length === 0) {
        throw new Error('No remotely registered workflow triggers are available. Run `ghl app triggers push` first.')
      }
      const trigger = definitions.find(item => item.key === productId)
      productName ??= trigger?.versions[0]?.info.name
    }
    if (!productName && interactive) {
      productName = await input({
        message: 'Product name:',
        validate: value => (value.trim() ? true : 'Product name is required.')
      })
    }
    if (productType === 'custom' && !productId && productName) productId = customProductId(productName)
    if (!productId) throw new Error('--product-id is required for this product type.')
    if (!productName) throw new Error('--product-name is required when it cannot be resolved from local workflow JSON.')
    let direction = flags.direction as 'inbound' | 'outbound' | undefined
    if (productType === 'conversation_provider' && !direction && interactive) {
      direction = await select({
        message: 'Conversation direction:',
        choices: [
          { name: 'Inbound', value: 'inbound' as const },
          { name: 'Outbound', value: 'outbound' as const }
        ]
      })
    }
    let priceText = flags.price
    if (!priceText && interactive) {
      priceText = await input({
        message: 'Price per unit (USD):',
        validate: value => validateUnitPriceInput(value, 'Price per unit')
      })
    }
    let executionLimit = flags['execution-limit']
    if (executionLimit === undefined && interactive) {
      executionLimit = Number(
        await input({
          message: 'Execution limit per billing cycle:',
          validate: validateExecutionLimitInput
        })
      )
    }
    let customPriceType = flags['price-type'] as BillingCustomPriceType | undefined
    if (productType === 'custom' && !customPriceType && interactive) {
      customPriceType = await select({
        message: 'Pricing mode:',
        choices: [
          { name: 'Fixed', value: 'fixed' as const },
          { name: 'Dynamic', value: 'dynamic' as const }
        ],
        default: 'fixed'
      })
    }
    customPriceType ??= 'fixed'
    let minPriceText = flags['min-price']
    let maxPriceText = flags['max-price']
    let pricingPageUrl = flags['pricing-page-url']
    if (customPriceType === 'dynamic' && interactive) {
      minPriceText ??= await input({
        message: 'Minimum price per unit (USD):',
        validate: value => validateUnitPriceInput(value, 'Minimum price')
      })
      maxPriceText ??= await input({
        message: 'Maximum price per unit (USD):',
        validate: value => validateUnitPriceInput(value, 'Maximum price')
      })
      pricingPageUrl ??= await input({
        message: 'Public pricing page URL (https):',
        validate: value => validateHttpsUrl(value, 'Pricing page URL', { publicOnly: true })
      })
    }
    const meter = createBillingMeterScaffold({
      productType,
      productId,
      productName,
      name,
      pricePerUnit: unitPrice(priceText, 'Price per unit'),
      executionLimitPerCycle: executionLimit as number,
      ...(direction ? { direction } : {}),
      ...(flags['usage-unit'] ? { usageUnit: flags['usage-unit'] } : {}),
      customPriceType,
      ...(minPriceText !== undefined ? { minPricePerUnit: unitPrice(minPriceText, 'Minimum price') } : {}),
      ...(maxPriceText !== undefined ? { maxPricePerUnit: unitPrice(maxPriceText, 'Maximum price') } : {}),
      ...(pricingPageUrl ? { pricingPageUrl } : {})
    })
    const usage = structuredClone(workspace.usage)
    usage.meters.push(meter)
    const staged = { ...workspace, usage }
    const errors = await validateLocalBillingIntent(staged)
    if (errors.length > 0) throw new Error(`Usage meter is invalid:\n- ${errors.join('\n- ')}`)
    const files = await writeLocalBillingWorkspace(workspace.directory, workspace.subscriptions, usage)
    const result = {
      appId: workspace.app.appId,
      productId: meter.productId,
      usageFile: files.usageFile,
      staged: true
    }
    if (this.jsonEnabled()) return result
    this.log(
      `Added meter "${meter.productName}" to ${files.usageFile}. Run \`ghl app billing push\` to create it in the portal.`
    )
  }
}
