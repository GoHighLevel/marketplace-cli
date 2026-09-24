export const WORKFLOW_TRIGGER_FIELD_TYPES = ['DYNAMIC', 'multiselect', 'select', 'string'] as const

export const WORKFLOW_TRIGGER_INTERNAL_REFERENCES = [
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

export const WORKFLOW_TRIGGER_REQUIRED_SCOPE = 'workflows.readonly'

interface WorkflowTriggerPrerequisites {
  triggerCount: number
  allowedScopes: readonly string[]
  redirectUris: readonly string[]
  clientKeyCount: number
  userTypes: readonly string[]
}

export function workflowTriggerPrerequisiteErrors(input: WorkflowTriggerPrerequisites): string[] {
  if (input.triggerCount === 0) return []
  const errors: string[] = []
  if (!input.allowedScopes.includes(WORKFLOW_TRIGGER_REQUIRED_SCOPE)) {
    errors.push(
      `ghl-app.json.oauth.allowedScopes must include "${WORKFLOW_TRIGGER_REQUIRED_SCOPE}" ` +
        'before workflow triggers can be pushed or published.'
    )
  }
  if (input.redirectUris.length === 0) {
    errors.push(
      'ghl-app.json.oauth.redirectUris must contain at least one OAuth redirect URI ' +
        'before workflow triggers can be pushed or published.'
    )
  }
  if (input.clientKeyCount === 0) {
    errors.push(
      'ghl-app.json.oauth.clientKeys must contain at least one client key ' +
        'before workflow triggers can be pushed or published.'
    )
  }
  if (!input.userTypes.includes('Location')) {
    errors.push(
      'ghl-app.json.listing.userTypes must include "Location" ' + 'before workflow triggers can be pushed or published.'
    )
  }
  return errors
}
