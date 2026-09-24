/* Mirrors marketplace-frontend src/constants/appCategory.ts — stored
   subcategory values are the lowercased labels. */
export const CATEGORY_GROUPS: Record<string, string[]> = {
  Marketing: [
    'Advertising',
    'Analytics & data',
    'Content management system',
    'Data management',
    'E-commerce',
    'Email',
    'Events',
    'Lead generation',
    'Live chat',
    'Marketing automation',
    'SEO',
    'SMS',
    'Social media',
    'Video',
    'Webinar',
    'Website Builder',
    'WordPress'
  ],
  Sales: ['CRM', 'Calendar & Scheduling', 'Calling', 'Sales Enablement'],
  'Customer Service': [
    'Customer Success',
    'Employee engagement',
    'Field service management',
    'Help desk & Ticketing',
    'Survey'
  ],
  'Payment Provider': ['Whitelabel Payment Provider', 'Third Party Provider', 'Payment Provider'],
  Productivity: ['Workflow automation', 'ERP', 'Learning management system', 'Project management'],
  Finance: ['Accounting & Payments', 'Payroll'],
  Services: ['Virtual Assistants', 'Other Services'],
  Others: ['Other']
}

export const SUBCATEGORY_VALUES = Object.values(CATEGORY_GROUPS)
  .flat()
  .map(label => label.toLowerCase())

export const BUSINESS_NICHE_VALUES = [
  'advertising agency',
  'car dealership',
  'chiropractor',
  'construction',
  'consultant',
  'dental',
  'education',
  'energy',
  'financial services',
  'fitness',
  'health',
  'home services',
  'hospitality',
  'insurance',
  'legal',
  'life coach',
  'loan & mortgage',
  'marketing agency',
  'medical',
  'real estate',
  'recruitment',
  'retail',
  'solar',
  'spa & wellness'
]

function uniqueCommaSeparated(input: string): string[] {
  const values = input
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  return values.filter(value => {
    const key = value.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function normalizeSubcategories(input: string): string[] | string {
  const values = uniqueCommaSeparated(input).map(value => value.toLowerCase())
  if (values.length === 0) return 'Select at least one category.'
  if (values.length > 3) return 'Select at most 3 categories.'
  const invalid = values.filter(value => !SUBCATEGORY_VALUES.includes(value))
  if (invalid.length > 0) {
    return `Unknown category: ${invalid.join(', ')}. Valid values: ${SUBCATEGORY_VALUES.join(', ')}`
  }
  return values
}

export function normalizeBusinessNiches(input: string): string[] | string {
  const values = uniqueCommaSeparated(input).map(value => value.toLowerCase())
  if (values.length > 3) return 'Select at most 3 business niches.'
  const invalid = values.filter(value => !BUSINESS_NICHE_VALUES.includes(value))
  if (invalid.length > 0) {
    return `Unknown business niche: ${invalid.join(', ')}. Valid values: ${BUSINESS_NICHE_VALUES.join(', ')}`
  }
  return values
}

export function normalizeKeywords(input: string): string[] | string {
  const values = uniqueCommaSeparated(input)
  if (values.reduce((total, value) => total + value.length, 0) > 200) {
    return 'Search keywords can contain at most 200 characters in total.'
  }
  return values
}
