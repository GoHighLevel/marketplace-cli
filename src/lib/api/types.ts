export interface AppListItem {
  _id: string
  appId?: string
  name: string
  status?: string
  version?: string
  private?: boolean
  createdAt?: string
  isPending?: boolean
  agencyInstallCount?: number
}

export interface SandboxAccount {
  _id?: string
  name?: string
  companyId?: string
  relationshipNumber?: string
  expiryDate?: string
  status?: string
}

export interface SandboxAccountsResponse {
  accounts: SandboxAccount[]
  apps: Record<string, string[]>
}

export interface AppListResponse {
  apps: AppListItem[]
  totalCount: number
}

export interface DeveloperTeam {
  team: string
  name?: string
  role?: string
}

export interface CreateAppRequestBody {
  name: string
  private: boolean
  userTypes: string[]
  isWhiteLabelFriendly: boolean
  isAgencyBulkInstallEnabled: boolean
}

export interface CreatedApp {
  _id: string
  appId?: string
  name: string
}

export interface SupportConfig {
  supportEmail?: string
  supportPhone?: string
  websiteUrl?: string
  documentationUrl?: string
  termsAndConditionsUrl?: string
  privacyPolicyUrl?: string
  supportedServices?: string[]
}

export interface AppVersion {
  _id: string
  appId?: string
  createdAt?: string
  name?: string
  version?: string
  status?: string
  private?: boolean
  appType?: string
  billingType?: 'free' | 'paid' | 'freemium'
  isPaidApp?: boolean
  isFreemium?: boolean
  externalBilling?: boolean
  externalBillingUrl?: string
  hasFreeTrial?: boolean
  freeTrialDuration?: number
  hasUsageBasedPrice?: boolean
  paymentType?: string
  oneTimePrice?: number
  additionalInfoForBilling?: string
  tagline?: string
  companyName?: string
  contact?: { email?: string; name?: string }
  website?: string
  category?: string
  subcategory?: string[]
  businessNiche?: string[]
  logoUrl?: string
  userTypes?: string[]
  isWhiteLabelFriendly?: boolean
  isAgencyBulkInstallEnabled?: boolean
  searchKeywords?: string[]
  description?: string
  previewImageUrls?: string[]
  previewVideoUrl?: string
  hasSubAccountProfile?: boolean
  subAccountDescription?: string
  subAccountPreviewImageUrls?: string[]
  subAccountPreviewVideoUrl?: string
  supportConfig?: SupportConfig
  allowedScopes?: string[]
  redirectUris?: string[]
  clientKeys?: Array<{ id?: string; name?: string; deleted?: boolean; isDefault?: boolean; default?: boolean }>
  defaults?: { clientKey?: string; redirectUrl?: string }
  hasExternalAuth?: boolean
  externalConfig?: Record<string, unknown>
  externalAuthConfig?: Record<string, unknown>
  mcpConfig?: Record<string, unknown>
  customPages?: Record<string, unknown>[]
  webhookUrl?: string
  subscribedEvents?: Array<{ name: string; url?: string; warningFlag?: boolean }>
  endToEndDemoUrl?: string
  scopesDemoUrl?: string
  testCredentials?: string
  additionalDetails?: string
  privateReason?: string
  securityReview?: { status?: string; reviewed?: boolean }
}

export interface ProfileUpdateResult {
  oAuthClient?: { _id?: string; id?: string; appId?: string }
  pendingOAuthClient?: { _id?: string; id?: string; appId?: string }
}

export interface PreSubmitValidation {
  success: boolean
  message?: string
  mandatoryFields?: Record<string, boolean>
}

export interface WebhooksCatalog {
  events?: string[]
  mapping?: Record<string, string[]>
}

export interface ClientKeyCreated {
  id: string
  secret: string
}

export interface VersionListItem {
  _id: string
  appId?: string
  name?: string
  version?: string
  status?: string
}

export interface VersionAnalysis {
  suggestedVersion?: string
  latestLiveVersion?: string | null
  updateType?: string | null
  changes?: unknown
}

export interface BillingSettings {
  billingType: 'free' | 'paid' | 'freemium'
  externalBilling?: boolean
  externalBillingUrl?: string
  hasFreeTrial?: boolean
  freeTrialDuration?: number
}

export interface BillingPlan {
  _id?: string
  id?: string
  name?: string
  features?: string[]
  price?: number | null
  locationPrice?: number | null
  isFreemiumPlan?: boolean
  freeForAgency?: boolean
  freeForLocation?: boolean
  /* Accepted for compatibility with older/transformed responses. */
  amount?: number | null
  locationAmount?: number | null
  freePlan?: boolean
  paymentType?: string
  paymentTime?: string
}

export interface BillingUsageTier {
  _id: string
  name: string
  minVolume: number
  maxVolume?: number | null
  pricePerUnit: number
  minPricePerUnit?: number | null
  maxPricePerUnit?: number | null
  executionLimitPerCycle: number
}

export interface BillingUsageMeter {
  _id: string
  appId?: string
  productType: 'conversation_provider' | 'workflow_action' | 'workflow_trigger' | 'custom'
  productId: string
  productName: string
  customPriceType: 'fixed' | 'dynamic'
  usageUnit: string
  direction?: 'inbound' | 'outbound'
  pricingPageURL?: string
  billingTier: BillingUsageTier[]
}

export interface WorkflowActionSummary {
  _id: string
  actionId: string
  name: string
  version: string
  status: string
  isHidden?: boolean
  isActive?: boolean
}

export interface WorkflowActionConfig extends Record<string, unknown> {
  templateId: string
  appId: string
  key: string
  version: string
  status: string
  info: { name: string; [key: string]: unknown }
}

export interface WorkflowTriggerSummary {
  _id: string
  triggerId: string
  name: string
  version: string
  status?: string
  isActive?: boolean
}

export interface WorkflowTriggerConfig extends Record<string, unknown> {
  templateId: string
  appId: string
  key: string
  version: string
  status: string
  info: { name: string; [key: string]: unknown }
}

export interface WorkflowActionTestRequest {
  appId: string
  inputData: Record<string, unknown>
  locationId?: string
  executionConfig: {
    type: 'API' | 'CODE'
    url?: string
    method?: string
    code?: string
    headers: Array<{ label: string; key: string }>
  }
}

export interface WorkflowActionTestResponse {
  hasError: boolean
  errorMessage?: unknown
  output?: unknown
  consoleLogs?: string[]
}
