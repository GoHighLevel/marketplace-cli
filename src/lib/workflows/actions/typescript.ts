import path from 'node:path'

import ts from 'typescript'

import { errorMessage } from '../../shared/errors.js'
import { WORKFLOW_ACTION_CODE_MAX_BYTES, workflowActionCodeSyntaxError } from './code.js'
import type { WorkflowActionDefinition, WorkflowActionVersion } from './manifest.js'
import {
  generateWorkflowActionDeclaration,
  generateWorkflowActionSandboxDeclarations,
  WORKFLOW_ACTION_DECLARATION_FILENAME,
  WORKFLOW_ACTION_TYPES_RELATIVE_DIRECTORY,
  workflowActionTypeFilename,
  workflowActionVersionTypePrefix
} from './types.js'

export interface CompileWorkflowActionTypeScriptInput {
  directory: string
  filename: string
  source: string
  action: WorkflowActionDefinition
  version: WorkflowActionVersion
}

export interface CompileWorkflowActionTypeScriptResult {
  code: string
  errors: string[]
}

const JAVASCRIPT_SCAFFOLD_MARKER = 'GHL workflow-action editor wrapper. Only the handler body is sent to the portal.'
const ACTION_CONTEXT_PROPERTIES = new Set([
  'inputData',
  'customRequest',
  'console',
  '_',
  'moment',
  'fileDownloader',
  '_csv',
  '_base64',
  '_uuid'
])

const COMPILER_OPTIONS: ts.CompilerOptions = {
  exactOptionalPropertyTypes: true,
  lib: ['lib.es2022.d.ts'],
  module: ts.ModuleKind.ESNext,
  moduleDetection: ts.ModuleDetectionKind.Force,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  noUncheckedIndexedAccess: true,
  skipLibCheck: false,
  strict: true,
  target: ts.ScriptTarget.ES2022,
  types: []
}

const JAVASCRIPT_COMPILER_OPTIONS: ts.CompilerOptions = {
  ...COMPILER_OPTIONS,
  allowJs: true,
  checkJs: true
}

function normalizedFilename(filename: string): string {
  return path.resolve(filename)
}

function diagnosticText(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  if (!diagnostic.file || diagnostic.start === undefined) return message
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
  return `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1} - ${message}`
}

function createVirtualCompilerHost(
  files: ReadonlyMap<string, string>,
  compilerOptions: ts.CompilerOptions
): ts.CompilerHost {
  const host = ts.createCompilerHost(compilerOptions)
  const directoryExists = host.directoryExists?.bind(host)
  const fileExists = host.fileExists.bind(host)
  const getSourceFile = host.getSourceFile.bind(host)
  const readFile = host.readFile.bind(host)
  const virtualDirectories = new Set<string>()
  for (const filename of files.keys()) {
    let directory = path.dirname(filename)
    while (!virtualDirectories.has(directory)) {
      virtualDirectories.add(directory)
      const parent = path.dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  host.directoryExists = directory =>
    virtualDirectories.has(normalizedFilename(directory)) || directoryExists?.(directory) === true
  host.fileExists = filename => files.has(normalizedFilename(filename)) || fileExists(filename)
  host.readFile = filename => files.get(normalizedFilename(filename)) ?? readFile(filename)
  host.getSourceFile = (filename, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = files.get(normalizedFilename(filename))
    return source === undefined
      ? getSourceFile(filename, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(filename, source, languageVersion, true)
  }
  return host
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === kind) === true
}

function isDefaultFunctionDeclaration(node: ts.Node): node is ts.FunctionDeclaration {
  return (
    ts.isFunctionDeclaration(node) &&
    hasModifier(node, ts.SyntaxKind.ExportKeyword) &&
    hasModifier(node, ts.SyntaxKind.DefaultKeyword)
  )
}

function moduleValidationErrors(
  sourceFile: ts.SourceFile,
  language: 'javascript' | 'typescript',
  allowReferences = false
): string[] {
  const errors: string[] = []
  let defaultExports = 0
  if (
    !allowReferences &&
    (sourceFile.referencedFiles.length > 0 ||
      sourceFile.typeReferenceDirectives.length > 0 ||
      sourceFile.libReferenceDirectives.length > 0)
  ) {
    errors.push(`${sourceFile.fileName}: Triple-slash references are unavailable in action source.`)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      errors.push(`${sourceFile.fileName}: Runtime imports are unavailable; use type-only imports.`)
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      errors.push(`${sourceFile.fileName}: Dynamic imports are unavailable in the action sandbox.`)
    }
    if (ts.isImportEqualsDeclaration(node)) {
      errors.push(`${sourceFile.fileName}: Import assignments are unavailable in the action sandbox.`)
    }
    if (ts.isExportAssignment(node)) {
      defaultExports += node.isExportEquals ? 0 : 1
      if (node.isExportEquals) errors.push(`${sourceFile.fileName}: Export assignments are unavailable.`)
    }
    if (isDefaultFunctionDeclaration(node)) defaultExports += 1
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      errors.push(`${sourceFile.fileName}: Runtime exports are unavailable; export only the default action handler.`)
    }
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
    if (
      modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
      !ts.isInterfaceDeclaration(node) &&
      !ts.isTypeAliasDeclaration(node) &&
      !isDefaultFunctionDeclaration(node)
    ) {
      errors.push(`${sourceFile.fileName}: Runtime exports are unavailable; export only the default action handler.`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  if (defaultExports !== 1) {
    errors.push(
      `${sourceFile.fileName}: ${language === 'typescript' ? 'TypeScript' : 'JavaScript'} action source must have exactly one default export handler.`
    )
  }
  return [...new Set(errors)]
}

function javascriptReferenceErrors(sourceFile: ts.SourceFile, actionKey: string): string[] {
  const expected = new Set([
    `../../../../../.ghl/types/actions/${WORKFLOW_ACTION_DECLARATION_FILENAME}`,
    `../../../../../.ghl/types/actions/${workflowActionTypeFilename(actionKey)}`
  ])
  const actual = sourceFile.referencedFiles.map(reference => reference.fileName)
  if (
    actual.length !== expected.size ||
    actual.some(reference => !expected.has(reference)) ||
    sourceFile.typeReferenceDirectives.length > 0 ||
    sourceFile.libReferenceDirectives.length > 0
  ) {
    return [`${sourceFile.fileName}: JavaScript actions must keep both generated declaration references.`]
  }
  return []
}

function typeCheckFiles(
  input: CompileWorkflowActionTypeScriptInput,
  language: 'javascript' | 'typescript'
): {
  errors: string[]
  sourceFile?: ts.SourceFile
} {
  const compilerOptions = language === 'javascript' ? JAVASCRIPT_COMPILER_OPTIONS : COMPILER_OPTIONS
  const filename = normalizedFilename(input.filename)
  const sandboxFile = path.join(
    input.directory,
    WORKFLOW_ACTION_TYPES_RELATIVE_DIRECTORY,
    WORKFLOW_ACTION_DECLARATION_FILENAME
  )
  const actionTypeFile = path.join(
    input.directory,
    WORKFLOW_ACTION_TYPES_RELATIVE_DIRECTORY,
    workflowActionTypeFilename(input.action.key)
  )
  const legacySandboxFile = path.join(input.directory, 'ghl-action-sandbox.d.ts')
  const legacyActionTypeFile = path.join(input.directory, `ghl-action-${input.action.key}.d.ts`)
  const handlerName = `${workflowActionVersionTypePrefix(input.action.key, input.version.version)}Handler`
  const checkFile = path.join(
    input.directory,
    '.ghl',
    'action-typecheck',
    `${input.action.key}.${input.version.version}.ts`
  )
  let sourceImport = path.relative(path.dirname(checkFile), filename).replaceAll(path.sep, '/')
  let typesImport = path.relative(path.dirname(checkFile), actionTypeFile).replaceAll(path.sep, '/')
  if (!sourceImport.startsWith('.')) sourceImport = `./${sourceImport}`
  if (!typesImport.startsWith('.')) typesImport = `./${typesImport}`
  sourceImport = sourceImport.replace(/\.(?:js|ts)$/, '')
  typesImport = typesImport.replace(/\.d\.ts$/, '')
  const sandboxDeclaration = generateWorkflowActionSandboxDeclarations()
  const actionDeclaration = generateWorkflowActionDeclaration(input.action)
  const files = new Map<string, string>([
    [filename, input.source],
    [normalizedFilename(sandboxFile), sandboxDeclaration],
    [normalizedFilename(actionTypeFile), actionDeclaration],
    [normalizedFilename(legacySandboxFile), sandboxDeclaration],
    [
      normalizedFilename(legacyActionTypeFile),
      actionDeclaration.replace("from './workflow-action'", "from './ghl-action-sandbox'")
    ],
    [
      normalizedFilename(checkFile),
      `import handler from '${sourceImport}'\nimport type { ${handlerName} } from '${typesImport}'\nconst checked: ${handlerName} = handler\nvoid checked\n`
    ]
  ])
  const host = createVirtualCompilerHost(files, compilerOptions)
  const program = ts.createProgram([...files.keys()], compilerOptions, host)
  const sourceFile = program.getSourceFile(filename)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  const errors = diagnostics.map(diagnostic => {
    const text = diagnosticText(diagnostic)
    return diagnostic.file?.fileName === checkFile
      ? `${filename}: The default export must satisfy the generated action handler type. ${text}`
      : text
  })
  if (sourceFile) {
    errors.push(...moduleValidationErrors(sourceFile, language, language === 'javascript'))
    if (language === 'javascript') errors.push(...javascriptReferenceErrors(sourceFile, input.action.key))
  }
  return { sourceFile, errors: [...new Set(errors)] }
}

function javascriptHandler(sourceFile: ts.SourceFile): { body?: ts.Block; errors: string[] } {
  const errors: string[] = []
  let body: ts.Block | undefined
  let actionDeclaration = 0
  let defaultExport = 0

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      const declarations = statement.declarationList.declarations
      const declaration = declarations.length === 1 ? declarations[0] : undefined
      if (
        declaration &&
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'action' &&
        declaration.initializer &&
        (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
      ) {
        actionDeclaration += 1
        body =
          declaration.initializer.body && ts.isBlock(declaration.initializer.body)
            ? declaration.initializer.body
            : undefined
        const parameter = declaration.initializer.parameters[0]
        if (!parameter || !ts.isObjectBindingPattern(parameter.name)) {
          errors.push(
            `${sourceFile.fileName}: JavaScript action handlers must destructure sandbox values from their first parameter.`
          )
        } else {
          for (const element of parameter.name.elements) {
            const property = element.propertyName ?? element.name
            if (!ts.isIdentifier(property) || !ts.isIdentifier(element.name) || property.text !== element.name.text) {
              errors.push(`${sourceFile.fileName}: JavaScript action sandbox values cannot be renamed.`)
              continue
            }
            if (!ACTION_CONTEXT_PROPERTIES.has(property.text)) {
              errors.push(`${sourceFile.fileName}: Unknown JavaScript action sandbox value "${property.text}".`)
            }
          }
        }
        if (!body) errors.push(`${sourceFile.fileName}: JavaScript action handlers must use a block body.`)
        continue
      }
    }
    if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      ts.isIdentifier(statement.expression) &&
      statement.expression.text === 'action'
    ) {
      defaultExport += 1
      continue
    }
    errors.push(
      `${sourceFile.fileName}: Keep runtime statements inside the default action handler so the CLI can send them to the sandbox.`
    )
  }

  if (actionDeclaration !== 1 || defaultExport !== 1) {
    errors.push(
      `${sourceFile.fileName}: JavaScript action source must keep one "action" handler and one default export.`
    )
  }
  return { body, errors: [...new Set(errors)] }
}

function extractJavaScriptSandboxBody(source: string, sourceFile: ts.SourceFile, body: ts.Block): string {
  const contents = source.slice(body.getStart(sourceFile) + 1, body.getEnd() - 1)
  const start = contents.match(/^\r?\n/)?.[0].length ?? 0
  const end = contents.match(/\r?\n$/)?.[0].length ?? 0
  if (start === 0 || end === 0) {
    throw new Error('The JavaScript action handler body must start and end on separate lines.')
  }
  return contents.slice(start, contents.length - end)
}

function emitSandboxBody(source: string, filename: string): string {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      removeComments: false,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  }).outputText
  const sourceFile = ts.createSourceFile(`${filename}.js`, output, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
  const statements: ts.Statement[] = []
  let handler: ts.Expression | undefined
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      handler = statement.expression
      continue
    }
    if (isDefaultFunctionDeclaration(statement)) {
      const modifiers = ts
        .getModifiers(statement)
        ?.filter(
          modifier => modifier.kind !== ts.SyntaxKind.ExportKeyword && modifier.kind !== ts.SyntaxKind.DefaultKeyword
        )
      if (statement.name) {
        statements.push(
          ts.factory.updateFunctionDeclaration(
            statement,
            modifiers,
            statement.asteriskToken,
            statement.name,
            statement.typeParameters,
            statement.parameters,
            statement.type,
            statement.body
          )
        )
        handler = statement.name
      } else {
        handler = ts.factory.createFunctionExpression(
          modifiers,
          statement.asteriskToken,
          undefined,
          statement.typeParameters,
          statement.parameters,
          statement.type,
          statement.body ?? ts.factory.createBlock([], true)
        )
      }
      continue
    }
    if (ts.isExportDeclaration(statement) && !statement.exportClause && !statement.moduleSpecifier) continue
    statements.push(statement)
  }
  if (!handler) throw new Error('The transpiled action does not contain a default export handler.')
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
  const body = statements.map(statement => printer.printNode(ts.EmitHint.Unspecified, statement, sourceFile)).join('\n')
  const handlerExpression = printer.printNode(ts.EmitHint.Expression, handler, sourceFile)
  return `${body}${body ? '\n' : ''}return await (async (__handler) => {
  if (typeof __handler !== 'function') throw new TypeError('The TypeScript action handler must be a function.');
  return __handler({ inputData, customRequest, console, _, moment, fileDownloader, _csv, _base64, _uuid });
})(${handlerExpression});`
}

function scaffoldOutput(version: WorkflowActionVersion): string {
  const output = version.customVarsJson
  return output && Object.keys(output).length > 0 ? JSON.stringify(output, null, 2) : '{}'
}

export function generateWorkflowActionTypeScriptScaffold(
  action: WorkflowActionDefinition,
  version: WorkflowActionVersion
): string {
  const handlerName = `${workflowActionVersionTypePrefix(action.key, version.version)}Handler`
  const output = scaffoldOutput(version)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join('\n')
  return `/* Generated action scaffold. Keep the default handler export. */
import type { ${handlerName} } from '../../../../../.ghl/types/actions/${workflowActionTypeFilename(action.key).replace(/\.d\.ts$/, '')}'

const action: ${handlerName} = async ({ inputData, customRequest }) => {
  void inputData
  void customRequest
  return ${output}
}

export default action
`
}

export function isWorkflowActionJavaScriptScaffold(source: string): boolean {
  return source.includes(JAVASCRIPT_SCAFFOLD_MARKER)
}

export function generateWorkflowActionJavaScriptScaffold(
  action: WorkflowActionDefinition,
  version: WorkflowActionVersion,
  body?: string
): string {
  const handlerName = `${workflowActionVersionTypePrefix(action.key, version.version)}Handler`
  const actionTypes = `../../../../../.ghl/types/actions/${workflowActionTypeFilename(action.key).replace(/\.d\.ts$/, '')}`
  const generatedBody = `  void inputData
  void customRequest
  return ${scaffoldOutput(version)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join('\n')}`
  return `// @ts-check
/// <reference path="../../../../../.ghl/types/actions/${WORKFLOW_ACTION_DECLARATION_FILENAME}" />
/// <reference path="../../../../../.ghl/types/actions/${workflowActionTypeFilename(action.key)}" />

/* ${JAVASCRIPT_SCAFFOLD_MARKER} */
/** @type {import('${actionTypes}').${handlerName}} */
const action = async ({ inputData, customRequest, console, _, moment, fileDownloader, _csv, _base64, _uuid }) => {
${body ?? generatedBody}
}

export default action
`
}

/* Declarations are generated from action JSON that may not have passed
   validation yet, so a malformed definition surfaces as a compile error
   instead of aborting the command. */
function checkedFiles(
  input: CompileWorkflowActionTypeScriptInput,
  language: 'javascript' | 'typescript'
): ReturnType<typeof typeCheckFiles> {
  try {
    return typeCheckFiles(input, language)
  } catch (error) {
    return {
      errors: [`${input.filename}: ${errorMessage(error, 'The action definition could not be type-checked.')}`]
    }
  }
}

export function compileWorkflowActionTypeScript(
  input: CompileWorkflowActionTypeScriptInput
): CompileWorkflowActionTypeScriptResult {
  const checked = checkedFiles(input, 'typescript')
  if (checked.errors.length > 0) return { code: '', errors: checked.errors }
  try {
    const code = emitSandboxBody(input.source, input.filename)
    if (Buffer.byteLength(code, 'utf8') > WORKFLOW_ACTION_CODE_MAX_BYTES) {
      return { code: '', errors: [`${input.filename}: Compiled action code must be at most 1 MiB.`] }
    }
    return { code, errors: [] }
  } catch (error) {
    return { code: '', errors: [`${input.filename}: ${(error as Error).message}`] }
  }
}

export function compileWorkflowActionJavaScript(
  input: CompileWorkflowActionTypeScriptInput
): CompileWorkflowActionTypeScriptResult {
  const prepared = prepareWorkflowActionJavaScript(input)
  const checked = checkedFiles(input, 'javascript')
  const errors = [...new Set([...prepared.errors, ...checked.errors])]
  if (errors.length > 0) return { code: '', errors }
  return prepared
}

export function prepareWorkflowActionJavaScript(
  input: CompileWorkflowActionTypeScriptInput
): CompileWorkflowActionTypeScriptResult {
  const sourceFile = ts.createSourceFile(input.filename, input.source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
  ).parseDiagnostics.map(diagnosticText)
  const handler = javascriptHandler(sourceFile)
  const errors = [
    ...parseDiagnostics,
    ...moduleValidationErrors(sourceFile, 'javascript', true),
    ...javascriptReferenceErrors(sourceFile, input.action.key),
    ...handler.errors
  ]
  if (errors.length > 0 || !handler.body) return { code: '', errors: [...new Set(errors)] }
  try {
    const code = extractJavaScriptSandboxBody(input.source, sourceFile, handler.body)
    if (Buffer.byteLength(code, 'utf8') > WORKFLOW_ACTION_CODE_MAX_BYTES) {
      return { code: '', errors: [`${input.filename}: Action code must be at most 1 MiB.`] }
    }
    const syntaxError = workflowActionCodeSyntaxError(code, input.filename)
    if (syntaxError) return { code: '', errors: [syntaxError] }
    return { code, errors: [] }
  } catch (error) {
    return { code: '', errors: [`${input.filename}: ${(error as Error).message}`] }
  }
}
