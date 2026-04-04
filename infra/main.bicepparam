// main.bicepparam — parameter values for infra/main.bicep.
// Copy to main.bicepparam.local and fill in your values.
// Never commit secrets to source control.

using './main.bicep'

// ── Required ──────────────────────────────────────────────────────────────────
param baseName    = 'ai-agent-prod'   // Adjust per environment
param location    = 'westeurope'

// Images are injected by the deploy scripts; leave empty for initial infra setup.
param apiImage    = ''
param workerImage = ''
param neo4jImage  = ''

// Redis — leave empty to deploy a managed Azure Cache for Redis (Basic C0).
// Set to an existing rediss:// URL only if you want to use an external Redis instance.
param redisUrl = ''          // e.g. rediss://:password@host:6380  (optional — leave empty for managed Redis)

// ── Optional secrets / config ─────────────────────────────────────────────────
param qdrantApiKey              = ''
param neo4jUsername             = 'neo4j'
param neo4jPassword             = ''   // Set a strong password before deploying!
param taskCollectionName        = 'agent_tasks'
param chatMessageCollectionName = 'chat_messages'

param azureOpenAiEndpoint             = ''
param azureOpenAiApiKey               = ''
param azureOpenAiDeployment           = ''
param azureOpenAiApiVersion           = '2024-02-01'
param azureOpenAiEmbeddingEndpoint    = ''
param azureOpenAiEmbeddingApiKey      = ''
param azureOpenAiEmbeddingDeployment  = ''
param azureOpenAiEmbeddingApiVersion  = ''

param slackClientId     = ''
param slackClientSecret = ''
param slackRedirectUri  = ''

param githubAppId         = ''
param githubAppPrivateKey = ''
param githubAppSlug       = ''
param githubRedirectUri   = ''

param uiBaseUrl     = ''   // Filled in by deploy:api after first deploy

param jwtIssuer     = ''
param jwtAudience   = ''
param jwksUri       = ''
param entraEnabled  = 'false'
param entraTenantId = ''
param entraClientId = ''
