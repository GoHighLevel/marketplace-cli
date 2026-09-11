import { ApiClientCore } from './core.js'
import { withApps } from './resources/apps.js'
import { withBilling } from './resources/billing.js'
import { withCatalogs } from './resources/catalogs.js'
import { withMedia } from './resources/media.js'
import { withOAuth } from './resources/oauth.js'
import { withSandbox } from './resources/sandbox.js'
import { withVersions } from './resources/versions.js'
import { withWorkflowActions } from './resources/workflow-actions.js'
import { withWorkflowTriggers } from './resources/workflow-triggers.js'

const WithApps = withApps(ApiClientCore)
const WithVersions = withVersions(WithApps)
const WithMedia = withMedia(WithVersions)
const WithCatalogs = withCatalogs(WithMedia)
const WithOAuth = withOAuth(WithCatalogs)
const WithWorkflowActions = withWorkflowActions(WithOAuth)
const WithWorkflowTriggers = withWorkflowTriggers(WithWorkflowActions)
const WithBilling = withBilling(WithWorkflowTriggers)
const WithSandbox = withSandbox(WithBilling)

/* The portal API client: the shared core plus one mixin per resource, so
   callers keep a single `client.method()` surface while each resource lives
   in its own module. */
export class ApiClient extends WithSandbox {}
