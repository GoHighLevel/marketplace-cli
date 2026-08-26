import { describe, expect, it } from 'vitest'

import { buildWorkflowActionsGuide } from '../../../../src/lib/workflows/actions/guide.js'

const documentedKeys = [
  'schemaVersion', 'appId', 'key', 'templateId', 'versions', 'version', 'status',
  'info', 'name', 'description', 'summary', 'groupName', 'keywords', 'icon', 'screenshots',
  'inputs', 'field', 'title', 'required', 'fieldType', 'helpText', 'placeholder', 'validations',
  'rule', 'errorMessage', 'value', 'options', 'label', 'disabled', 'iconUrl', 'mappedTo',
  'fetchOptions', 'queryParams', 'headers', 'route', 'serviceName', 'source', 'sourceId', 'body',
  'hasDynamicOptions', 'dynamicSource', 'executionType', 'code', 'method', 'labelField',
  'valueField', 'path', 'postProcessor', 'pagination', 'enabled', 'strategy', 'pageParam',
  'perPageParam', 'perPageValue', 'startingPage', 'limitParam', 'limitValue', 'offsetParam',
  'cursorParam', 'nextCursorField', 'syncTokenField', 'syncTokenParam', 'supportsSearch',
  'searchParam', 'fetchAllPages', 'order', 'searchDetail', 'singleDetail', 'dynamicFieldsConfig',
  'customGenerator', 'dependsOn', 'altersDynamicField', 'allowCustomInputPicker',
  'customInputHelperText', 'eventListeners', 'resetValue', 'sortOptions', 'dependentFilters',
  'showOperator', 'useArrayToArrayComparison', 'config', 'maxItems', 'lockDefaultKeys',
  'addItemLabel', 'innerFields', 'itemLabel', 'minSets', 'maxSets', 'richTextEditorType',
  'showHelpTextAsInfoToolTip', 'disableDatesFunction', 'showBelowCustomField', 'fieldOptions',
  'allowedFileTypes', 'showTextFiles', 'showUrlFiles', 'isClearable', 'timezoneSourceField',
  'hideAIToggle', 'variant', 'variantConfig', 'columns', 'allowDeselect', 'tileSize',
  'showDescription', 'group', 'groupDivider', 'translationKey', 'customVars', 'reference',
  'customVarsJson', 'executionConfig', 'type', 'url', 'pauseExecution', 'codeFile',
  'payloadCustomizationType', 'customizedPayload', 'branchesConfig', 'allowMultipath',
  'branchNameLabel', 'branchNameHelpText', 'branchNamePlaceholder', 'sectionTitle',
  'sectionDescription', 'deleteAlertTitle', 'deleteAlertDescription', 'addButtonLabel',
  'allowNewCondition', 'isDefaultBranchEditable', 'showBranchSection', 'predefinedBranches',
  'fetchBranches', 'branches', 'branchName', 'conditionType', 'id', 'meta',
  'branchFieldsGenerator', 'sectionOrder', 'groupConfigs', 'dividerPosition'
]

describe('workflow action guide', () => {
  it('documents every supported JSON key and the execution-test command', () => {
    const guide = buildWorkflowActionsGuide()

    for (const key of documentedKeys) expect(guide, `missing documentation for ${key}`).toContain(`\`${key}\``)
    expect(guide).toContain('ghl app actions test')
    expect(guide).toContain('COUNTRIES')
    expect(guide).toContain('TIKTOK_POSTS')
    expect(guide).toMatch(/Only one.*DYNAMIC/is)
    expect(guide).toMatch(/URL.*GET/is)
    expect(guide).toMatch(/Dynamic.*POST/is)
  })
})
