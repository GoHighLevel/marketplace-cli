export const WORKFLOW_ACTION_INTERNAL_REFERENCES = [
  'COUNTRIES',
  'CAMPAIGNS',
  'TAGS',
  'PIPELINES',
  'FORMS',
  'SURVEYS',
  'LINKS',
  'FUNNELS',
  'GLOBAL_PRODUCTS',
  'USERS',
  'CALENDARS',
  'TEAMS',
  'MEMBERSHIP_PRODUCTS',
  'MEMBERSHIP_CATEGORIES',
  'MEMBERSHIP_LESSONS',
  'MEMBERSHIP_OFFERS',
  'WORKFLOWS',
  'PHONE_NUMBERS',
  'NUMBER_POOL',
  'AFFILIATES',
  'TIKTOK_POSTS'
] as const

export const WORKFLOW_ACTION_FIELD_TYPES = [
  'DYNAMIC',
  'attachment',
  'checkbox',
  'custom-html',
  'date',
  'date-time',
  'duration-picker',
  'fieldSet',
  'hidden',
  'key-value',
  'multiselect',
  'multiselect_with_pagination',
  'numerical',
  'phone',
  'radio',
  'rich-text',
  'select',
  'select_with_pagination',
  'string',
  'tags',
  'textarea',
  'toggle'
] as const

export const WORKFLOW_ACTION_REQUIRED_SCOPE = 'workflows.readonly'

export function workflowActionPrerequisiteErrors(
  allowedScopes: readonly string[],
  actionCount: number
): string[] {
  if (actionCount === 0 || allowedScopes.includes(WORKFLOW_ACTION_REQUIRED_SCOPE)) return []
  return [
    `ghl-app.json.oauth.allowedScopes must include "${WORKFLOW_ACTION_REQUIRED_SCOPE}" ` +
      'before workflow actions can be pushed or published.'
  ]
}
