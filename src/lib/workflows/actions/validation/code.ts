import { RegExpValidator } from '@eslint-community/regexpp'
import { parse } from 'acorn'
import { isSafePattern } from 'redos-detector'
import { requireArray, requireRecord, requiredString, unknownProperties } from '../../shared/schema-primitives.js'
import { WORKFLOW_ACTION_CODE_MAX_BYTES, workflowActionCodeSyntaxError } from '../code.js'

const VALIDATION_REGEX_MAX_CHARACTERS = 1_000

const REGEXP_VALIDATOR = new RegExpValidator({ ecmaVersion: 2022 })

function isValidFunctionExpression(value: string, arrowOnly = false): boolean {
  if (Buffer.byteLength(value, 'utf8') > WORKFLOW_ACTION_CODE_MAX_BYTES) return false
  try {
    const program = parse(`(${value})`, { ecmaVersion: 2022 })
    if (program.body.length !== 1 || program.body[0].type !== 'ExpressionStatement') return false
    const expression = program.body[0].expression
    return expression.type === 'ArrowFunctionExpression' || (!arrowOnly && expression.type === 'FunctionExpression')
  } catch {
    return false
  }
}

export function validateFunctionExpression(value: string, path: string, errors: string[]): void {
  if (!isValidFunctionExpression(value)) errors.push(`${path} contains invalid function syntax.`)
}

export function validateJavaScriptBlock(value: string, path: string, errors: string[]): void {
  const syntaxError = workflowActionCodeSyntaxError(value, path)
  if (syntaxError) errors.push(`${path} contains invalid JavaScript: ${syntaxError}.`)
}

function isSafeRegexPattern(value: string): boolean {
  try {
    return isSafePattern(value, {
      downgradePattern: false,
      maxScore: 1,
      maxSteps: 20_000
    }).safe
  } catch {
    return false
  }
}

function isPrintableAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code > 0x7e) return false
  }
  return value.length > 0
}

function validateRegexRule(value: string, path: string, errors: string[]): void {
  if (value.length > VALIDATION_REGEX_MAX_CHARACTERS) {
    errors.push(`${path} must be at most ${VALIDATION_REGEX_MAX_CHARACTERS.toLocaleString('en-US')} characters.`)
    return
  }
  if (!isPrintableAscii(value)) {
    errors.push(`${path} may contain only printable ASCII characters.`)
    return
  }
  try {
    REGEXP_VALIDATOR.validatePattern(value)
  } catch {
    errors.push(`${path} must be a predefined validation, a valid regular expression, or an arrow function.`)
    return
  }
  if (!isSafeRegexPattern(value)) {
    errors.push(`${path} must not allow ambiguous backtracking.`)
  }
}

export function validateRules(value: unknown, path: string, errors: string[]): void {
  if (!requireArray(value, path, errors)) return
  const predefined = new Set(['isValidEmail', 'isValidHandleBar', 'isValidNumeric', 'isValidPhone', 'isValidURL'])
  value.forEach((rule, index) => {
    const rulePath = `${path}[${index}]`
    if (!requireRecord(rule, rulePath, errors)) return
    unknownProperties(rule, new Set(['rule', 'errorMessage']), rulePath, errors)
    if (requiredString(rule.rule, `${rulePath}.rule`, errors) && !predefined.has(rule.rule)) {
      if (rule.rule.includes('=>')) {
        if (!isValidFunctionExpression(rule.rule, true)) {
          errors.push(`${rulePath}.rule contains invalid arrow-function syntax.`)
        }
      } else {
        validateRegexRule(rule.rule, `${rulePath}.rule`, errors)
      }
    }
    requiredString(rule.errorMessage, `${rulePath}.errorMessage`, errors)
  })
}
