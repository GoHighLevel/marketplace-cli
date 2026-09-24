import { isRecord } from '../../../api/response.js'
import {
  optionalBoolean,
  optionalInteger,
  optionalNonNegativeInteger,
  optionalString,
  requireRecord,
  requiredString,
  stringArray,
  unknownProperties
} from '../../shared/schema-primitives.js'
import { WORKFLOW_FIELD_KEY_MAX_LENGTH, isWorkflowFieldKey } from '../../shared/value-validation.js'
import { WORKFLOW_ACTION_FIELD_TYPES, WORKFLOW_ACTION_INTERNAL_REFERENCES } from '../contract.js'
import { validateFunctionExpression, validateRules } from './code.js'
import { validateDynamicFieldsConfig, validateDynamicSource, validateFetchOptions, validateOptions } from './sources.js'

const FIELD_TYPES = new Set<string>(WORKFLOW_ACTION_FIELD_TYPES)

const INTERNAL_REFERENCES = new Set<string>(WORKFLOW_ACTION_INTERNAL_REFERENCES)

const RICH_TEXT_EDITOR_TYPES = new Set(['html', 'plain-text'])

const INPUT_PROPERTIES = new Set([
  'field',
  'title',
  'required',
  'fieldType',
  'helpText',
  'placeholder',
  'validations',
  'value',
  'options',
  'mappedTo',
  'fetchOptions',
  'hasDynamicOptions',
  'dynamicSource',
  'dynamicFieldsConfig',
  'altersDynamicField',
  'allowCustomInputPicker',
  'customInputHelperText',
  'eventListeners',
  'resetValue',
  'sortOptions',
  'order',
  'disabled',
  'dependentFilters',
  'showOperator',
  'useArrayToArrayComparison',
  'config',
  'showHelpTextAsInfoToolTip',
  'disableDatesFunction',
  'postProcessor',
  'showBelowCustomField',
  'fieldOptions',
  'timezoneSourceField',
  'hideAIToggle',
  'variant',
  'variantConfig',
  'group',
  'groupDivider',
  'translationKey'
])

function validateInputPresentation(input: Record<string, unknown>, path: string, errors: string[]): void {
  if (input.config !== undefined && requireRecord(input.config, `${path}.config`, errors)) {
    const configPath = `${path}.config`
    if (input.fieldType === 'key-value') {
      unknownProperties(input.config, new Set(['maxItems', 'lockDefaultKeys', 'addItemLabel']), configPath, errors)
      optionalNonNegativeInteger(input.config.maxItems, `${configPath}.maxItems`, errors)
      optionalBoolean(input.config.lockDefaultKeys, `${configPath}.lockDefaultKeys`, errors)
      optionalString(input.config.addItemLabel, `${configPath}.addItemLabel`, errors)
    } else if (input.fieldType === 'fieldSet') {
      unknownProperties(
        input.config,
        new Set(['innerFields', 'addItemLabel', 'itemLabel', 'minSets', 'maxSets']),
        configPath,
        errors
      )
      if (input.config.innerFields === undefined)
        errors.push(`${configPath}.innerFields is required for a fieldSet input.`)
      else stringArray(input.config.innerFields, `${configPath}.innerFields`, errors)
      optionalString(input.config.addItemLabel, `${configPath}.addItemLabel`, errors)
      optionalString(input.config.itemLabel, `${configPath}.itemLabel`, errors)
      const minSets = optionalNonNegativeInteger(input.config.minSets, `${configPath}.minSets`, errors)
      const maxSets = optionalNonNegativeInteger(input.config.maxSets, `${configPath}.maxSets`, errors)
      if (minSets !== undefined && maxSets !== undefined && minSets > maxSets) {
        errors.push(`${configPath}.minSets must not exceed maxSets.`)
      }
    } else {
      unknownProperties(input.config, new Set(['richTextEditorType']), configPath, errors)
      const richTextEditorType = input.config.richTextEditorType
      if (
        richTextEditorType !== undefined &&
        (typeof richTextEditorType !== 'string' || !RICH_TEXT_EDITOR_TYPES.has(richTextEditorType))
      ) {
        errors.push(`${configPath}.richTextEditorType must be "html" or "plain-text".`)
      }
    }
  }
  if (input.fieldOptions !== undefined && requireRecord(input.fieldOptions, `${path}.fieldOptions`, errors)) {
    const optionsPath = `${path}.fieldOptions`
    unknownProperties(
      input.fieldOptions,
      new Set(['allowedFileTypes', 'showTextFiles', 'showUrlFiles', 'isClearable']),
      optionsPath,
      errors
    )
    if (input.fieldOptions.allowedFileTypes !== undefined)
      stringArray(input.fieldOptions.allowedFileTypes, `${optionsPath}.allowedFileTypes`, errors)
    for (const field of ['showTextFiles', 'showUrlFiles', 'isClearable']) {
      optionalBoolean(input.fieldOptions[field], `${optionsPath}.${field}`, errors)
    }
  }
  if (input.variantConfig !== undefined && requireRecord(input.variantConfig, `${path}.variantConfig`, errors)) {
    const configPath = `${path}.variantConfig`
    unknownProperties(
      input.variantConfig,
      new Set(['columns', 'allowDeselect', 'tileSize', 'showDescription']),
      configPath,
      errors
    )
    optionalInteger(input.variantConfig.columns, `${configPath}.columns`, errors, { min: 2, max: 5 })
    optionalBoolean(input.variantConfig.allowDeselect, `${configPath}.allowDeselect`, errors)
    optionalBoolean(input.variantConfig.showDescription, `${configPath}.showDescription`, errors)
    if (
      input.variantConfig.tileSize !== undefined &&
      !['sm', 'md', 'lg'].includes(String(input.variantConfig.tileSize))
    ) {
      errors.push(`${configPath}.tileSize must be "sm", "md", or "lg".`)
    }
  }
}

export function validateInput(
  input: unknown,
  path: string,
  seen: Set<string>,
  errors: string[],
  validateUniqueField: boolean
): void {
  if (!requireRecord(input, path, errors)) return
  unknownProperties(input, INPUT_PROPERTIES, path, errors)
  if (requiredString(input.field, `${path}.field`, errors)) {
    if (input.field.length > WORKFLOW_FIELD_KEY_MAX_LENGTH) {
      errors.push(`${path}.field must be at most ${WORKFLOW_FIELD_KEY_MAX_LENGTH} characters.`)
    } else {
      if (!isWorkflowFieldKey(input.field) && input.field !== 'DYNAMIC') {
        errors.push(`${path}.field must start with a letter and contain only letters, numbers, and underscores.`)
      }
      if (validateUniqueField && seen.has(input.field)) {
        errors.push(`${path}.field duplicates input field "${input.field}".`)
      }
      seen.add(input.field)
    }
  }
  requiredString(input.title, `${path}.title`, errors)
  if (!requiredString(input.fieldType, `${path}.fieldType`, errors) || !FIELD_TYPES.has(input.fieldType)) {
    if (typeof input.fieldType === 'string') errors.push(`${path}.fieldType is not supported.`)
  }
  optionalBoolean(input.required, `${path}.required`, errors)
  for (const field of [
    'helpText',
    'placeholder',
    'mappedTo',
    'customInputHelperText',
    'postProcessor',
    'timezoneSourceField',
    'group',
    'translationKey'
  ]) {
    optionalString(input[field], `${path}.${field}`, errors)
  }
  if (typeof input.mappedTo === 'string' && input.mappedTo && !INTERNAL_REFERENCES.has(input.mappedTo)) {
    errors.push(`${path}.mappedTo must be one of: ${WORKFLOW_ACTION_INTERNAL_REFERENCES.join(', ')}.`)
  }
  for (const field of [
    'altersDynamicField',
    'allowCustomInputPicker',
    'hasDynamicOptions',
    'resetValue',
    'sortOptions',
    'disabled',
    'showOperator',
    'useArrayToArrayComparison',
    'showBelowCustomField',
    'hideAIToggle',
    'groupDivider',
    'showHelpTextAsInfoToolTip'
  ]) {
    optionalBoolean(input[field], `${path}.${field}`, errors)
  }
  optionalNonNegativeInteger(input.order, `${path}.order`, errors)
  if (input.disableDatesFunction !== undefined) {
    if (typeof input.disableDatesFunction !== 'string' || !input.disableDatesFunction.trim()) {
      errors.push(`${path}.disableDatesFunction must be a non-empty function string.`)
    } else {
      validateFunctionExpression(input.disableDatesFunction, `${path}.disableDatesFunction`, errors)
    }
  }
  for (const field of ['eventListeners', 'dependentFilters']) {
    if (input[field] !== undefined) stringArray(input[field], `${path}.${field}`, errors)
  }
  if (input.options !== undefined) validateOptions(input.options, `${path}.options`, errors)
  if (input.validations !== undefined) validateRules(input.validations, `${path}.validations`, errors)
  if (input.fetchOptions !== undefined) validateFetchOptions(input.fetchOptions, `${path}.fetchOptions`, errors)
  if (input.dynamicSource !== undefined) validateDynamicSource(input.dynamicSource, `${path}.dynamicSource`, errors)
  if (input.dynamicFieldsConfig !== undefined)
    validateDynamicFieldsConfig(input.dynamicFieldsConfig, `${path}.dynamicFieldsConfig`, errors)
  if (input.value !== undefined) {
    if (['attachment', 'DYNAMIC'].includes(String(input.fieldType))) {
      errors.push(`${path}.value is not supported for ${input.fieldType} inputs.`)
    } else {
      optionalString(input.value, `${path}.value`, errors)
    }
  }
  if (input.validations !== undefined && ['DYNAMIC', 'custom-html'].includes(String(input.fieldType))) {
    errors.push(`${path}.validations are not supported for ${input.fieldType} inputs.`)
  }
  const selectTypes = ['select', 'multiselect', 'radio']
  const dynamicSourceTypes = [...selectTypes, 'select_with_pagination', 'multiselect_with_pagination']
  if (!selectTypes.includes(String(input.fieldType))) {
    for (const property of ['options', 'mappedTo', 'fetchOptions']) {
      if (input[property] !== undefined) {
        errors.push(`${path}.${property} is supported only for select, multiselect, or radio inputs.`)
      }
    }
  }
  if (input.fieldType === 'radio' && input.mappedTo !== undefined) {
    errors.push(`${path}.mappedTo is not supported for radio inputs.`)
  }
  if (input.dynamicSource !== undefined && !dynamicSourceTypes.includes(String(input.fieldType))) {
    errors.push(`${path}.dynamicSource is supported only for select inputs.`)
  }
  if (input.dynamicFieldsConfig !== undefined && input.fieldType !== 'DYNAMIC') {
    errors.push(`${path}.dynamicFieldsConfig is supported only for DYNAMIC inputs.`)
  }
  validateInputPresentation(input, path, errors)
  if (input.variant !== undefined && !['standard', 'tile-picker'].includes(String(input.variant))) {
    errors.push(`${path}.variant must be "standard" or "tile-picker".`)
  }
  if (input.variant === 'tile-picker' && !['select', 'multiselect', 'radio'].includes(String(input.fieldType))) {
    errors.push(`${path}.variant "tile-picker" is supported only for select, multiselect, and radio fields.`)
  }
  if (input.variantConfig !== undefined && input.variant !== 'tile-picker') {
    errors.push(`${path}.variantConfig requires variant "tile-picker".`)
  }
  if (selectTypes.includes(String(input.fieldType))) {
    const optionSources = [
      input.options !== undefined ? 'options' : undefined,
      input.mappedTo !== undefined ? 'mappedTo' : undefined,
      input.fetchOptions !== undefined ? 'fetchOptions' : undefined,
      input.dynamicSource !== undefined ? 'dynamicSource' : undefined
    ].filter((source): source is string => source !== undefined)
    if (optionSources.length === 0) {
      errors.push(
        `${path} must define options, mappedTo, fetchOptions, or dynamicSource for ${input.fieldType} fields.`
      )
    } else if (optionSources.length > 1) {
      errors.push(`${path} must define exactly one option source; found ${optionSources.join(', ')}.`)
    }
    if (input.options !== undefined && (!Array.isArray(input.options) || input.options.length === 0)) {
      errors.push(`${path}.options must contain at least one option.`)
    }
  }
  if (
    ['select_with_pagination', 'multiselect_with_pagination'].includes(String(input.fieldType)) &&
    !isRecord(input.dynamicSource)
  ) {
    errors.push(`${path}.dynamicSource is required for paginated select fields.`)
  }
  if (input.fieldType === 'DYNAMIC') {
    if (input.field !== 'DYNAMIC') errors.push(`${path}.field must be "DYNAMIC" for a dynamic input.`)
    if (input.required === true) errors.push(`${path}.required must be false for a dynamic input.`)
    if (!isRecord(input.dynamicFieldsConfig)) {
      errors.push(`${path}.dynamicFieldsConfig is required for a dynamic input.`)
    }
  }
}
