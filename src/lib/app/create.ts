export interface CreateAppAnswers {
  name: string
  type: 'public' | 'private'
  target: 'sub-account' | 'agency'
  installer?: 'everyone' | 'agency-only'
  listing: 'white-label' | 'standard'
}

export interface CreateAppBody {
  name: string
  private: boolean
  userTypes: string[]
  isWhiteLabelFriendly: boolean
  isAgencyBulkInstallEnabled: boolean
}

export const APP_NAME_MAX_LENGTH = 50

export function validateAppName(name: string): string | true {
  const trimmed = name.trim()
  if (!trimmed) return 'App name is required'
  if (trimmed.length > APP_NAME_MAX_LENGTH) return `App name must be at most ${APP_NAME_MAX_LENGTH} characters`
  return true
}

/* Mirrors the portal's create-app modal: agency target means Company-only
   distribution (installer question does not apply); sub-account distributes to
   Location, adding Company when only agencies may install. */
export function buildCreateAppBody(answers: CreateAppAnswers): CreateAppBody {
  const userTypes =
    answers.target === 'agency'
      ? ['Company']
      : answers.installer === 'agency-only'
        ? ['Location', 'Company']
        : ['Location']

  return {
    name: answers.name.trim(),
    private: answers.type === 'private',
    userTypes,
    isWhiteLabelFriendly: answers.listing === 'white-label',
    isAgencyBulkInstallEnabled: true
  }
}
