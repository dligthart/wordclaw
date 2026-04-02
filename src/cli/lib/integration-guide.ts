import type { CurrentActorSnapshot } from '../../services/actor-identity.js';

type ApiKeyLike = {
    id: number;
    name: string;
    keyPrefix: string;
    scopes: string[];
    createdBy: number | null;
    createdAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
    lastUsedAt: string | null;
};

type WebhookLike = {
    id: number;
    url: string;
    events: string[];
    active: boolean;
    createdAt: string;
};

type AiProviderLike = {
    id: number;
    provider: 'openai' | 'anthropic' | 'gemini';
    configured: boolean;
    maskedApiKey: string;
    defaultModel: string | null;
    createdAt: string;
    updatedAt: string;
};

type WorkforceAgentLike = {
    id: number;
    name: string;
    slug: string;
    purpose: string;
    provider: {
        type: string;
        model?: string;
    };
    active: boolean;
    createdAt: string;
    updatedAt: string;
};

export type IntegrationGuideStep = {
    id: string;
    title: string;
    status: 'completed' | 'ready' | 'blocked' | 'optional';
    command: string | null;
    purpose: string;
    notes?: string[];
};

export type IntegrationGuide = {
    taskId: 'manage-integrations';
    requiredActorProfiles: Array<'api-key' | 'env-key' | 'supervisor-session' | 'mcp-local'>;
    requiredScopes: string[];
    currentActor: CurrentActorSnapshot | null;
    actorReadiness: {
        status: 'ready' | 'blocked' | 'warning';
        supportedActorProfile: boolean;
        requiredScopesSatisfied: boolean;
        notes: string[];
    };
    apiKeys: {
        accessible: boolean;
        total: number;
        active: number;
        revoked: number;
        expiringSoon: number;
        recentKeys: Array<{
            id: number;
            name: string;
            keyPrefix: string;
            scopes: string[];
            revokedAt: string | null;
        }>;
    };
    webhooks: {
        accessible: boolean;
        total: number;
        active: number;
        inactive: number;
        recentHooks: Array<{
            id: number;
            url: string;
            events: string[];
            active: boolean;
        }>;
    };
    aiProviders: {
        accessible: boolean;
        total: number;
        configuredProviders: string[];
        recentProviders: Array<{
            id: number;
            provider: string;
            maskedApiKey: string;
            defaultModel: string | null;
        }>;
    };
    workforceAgents: {
        accessible: boolean;
        total: number;
        active: number;
        inactive: number;
        recentAgents: Array<{
            id: number;
            name: string;
            slug: string;
            providerType: string;
            model: string | null;
            active: boolean;
        }>;
    };
    warnings?: string[];
    steps: IntegrationGuideStep[];
};

function expiresWithinDays(iso: string | null, days: number): boolean {
    if (!iso) {
        return false;
    }

    const expiresAt = new Date(iso);
    if (Number.isNaN(expiresAt.getTime())) {
        return false;
    }

    const threshold = Date.now() + days * 24 * 60 * 60 * 1000;
    return expiresAt.getTime() <= threshold;
}

export function buildIntegrationGuide(options: {
    currentActor?: CurrentActorSnapshot | null;
    apiKeys?: ApiKeyLike[] | null;
    webhooks?: WebhookLike[] | null;
    aiProviders?: AiProviderLike[] | null;
    workforceAgents?: WorkforceAgentLike[] | null;
    baseCommand?: string;
}): IntegrationGuide {
    const baseCommand = options.baseCommand ?? 'node dist/cli/index.js';
    const currentActor = options.currentActor ?? null;
    const requiredActorProfiles: Array<'api-key' | 'env-key' | 'supervisor-session' | 'mcp-local'> = [
        'api-key',
        'env-key',
        'supervisor-session',
        'mcp-local',
    ];
    const requiredScopes = ['admin', 'tenant:admin'];
    const supportedActorProfile = currentActor
        ? requiredActorProfiles.includes(currentActor.actorProfileId as typeof requiredActorProfiles[number])
        : false;
    const requiredScopesSatisfied = currentActor
        ? requiredScopes.some((scope) => currentActor.scopes.includes(scope))
        : false;
    const actorReadinessNotes: string[] = [];

    if (!currentActor) {
        actorReadinessNotes.push('No authenticated actor snapshot is available yet.');
    } else {
        actorReadinessNotes.push(`Current actor ${currentActor.actorId} is using profile ${currentActor.actorProfileId} in domain ${currentActor.domainId}.`);
        if (!supportedActorProfile) {
            actorReadinessNotes.push('Integration management requires an API key, supervisor session, or local MCP actor profile.');
        }
        if (!requiredScopesSatisfied) {
            actorReadinessNotes.push('The current actor is missing admin or tenant:admin scope for API-key and webhook mutations.');
        }
        if (currentActor.actorProfileId === 'env-key') {
            actorReadinessNotes.push('Environment-configured API keys are best suited for local or single-domain deployments.');
        }
    }

    const actorReadinessStatus = !currentActor
        ? 'blocked'
        : !supportedActorProfile || !requiredScopesSatisfied
            ? 'blocked'
            : currentActor.actorProfileId === 'env-key'
                ? 'warning'
                : 'ready';
    const apiKeys = options.apiKeys ?? null;
    const webhooks = options.webhooks ?? null;
    const aiProviders = options.aiProviders ?? null;
    const workforceAgents = options.workforceAgents ?? null;
    const canMutate = actorReadinessStatus !== 'blocked';

    return {
        taskId: 'manage-integrations',
        requiredActorProfiles,
        requiredScopes,
        currentActor,
        actorReadiness: {
            status: actorReadinessStatus,
            supportedActorProfile,
            requiredScopesSatisfied,
            notes: actorReadinessNotes,
        },
        apiKeys: {
            accessible: Array.isArray(apiKeys),
            total: apiKeys?.length ?? 0,
            active: apiKeys?.filter((key) => key.revokedAt === null).length ?? 0,
            revoked: apiKeys?.filter((key) => key.revokedAt !== null).length ?? 0,
            expiringSoon: apiKeys?.filter((key) => key.revokedAt === null && expiresWithinDays(key.expiresAt, 14)).length ?? 0,
            recentKeys: (apiKeys ?? []).slice(0, 3).map((key) => ({
                id: key.id,
                name: key.name,
                keyPrefix: key.keyPrefix,
                scopes: key.scopes,
                revokedAt: key.revokedAt,
            })),
        },
        webhooks: {
            accessible: Array.isArray(webhooks),
            total: webhooks?.length ?? 0,
            active: webhooks?.filter((hook) => hook.active).length ?? 0,
            inactive: webhooks?.filter((hook) => !hook.active).length ?? 0,
            recentHooks: (webhooks ?? []).slice(0, 3).map((hook) => ({
                id: hook.id,
                url: hook.url,
                events: hook.events,
                active: hook.active,
            })),
        },
        aiProviders: {
            accessible: Array.isArray(aiProviders),
            total: aiProviders?.length ?? 0,
            configuredProviders: (aiProviders ?? []).map((config) => config.provider),
            recentProviders: (aiProviders ?? []).slice(0, 3).map((config) => ({
                id: config.id,
                provider: config.provider,
                maskedApiKey: config.maskedApiKey,
                defaultModel: config.defaultModel,
            })),
        },
        workforceAgents: {
            accessible: Array.isArray(workforceAgents),
            total: workforceAgents?.length ?? 0,
            active: workforceAgents?.filter((agent) => agent.active).length ?? 0,
            inactive: workforceAgents?.filter((agent) => !agent.active).length ?? 0,
            recentAgents: (workforceAgents ?? []).slice(0, 3).map((agent) => ({
                id: agent.id,
                name: agent.name,
                slug: agent.slug,
                providerType: agent.provider.type,
                model: typeof agent.provider.model === 'string' ? agent.provider.model : null,
                active: agent.active,
            })),
        },
        steps: [
            {
                id: 'inspect-api-keys',
                title: 'Inspect API key inventory',
                status: Array.isArray(apiKeys) ? 'completed' : 'blocked',
                command: `${baseCommand} rest request GET /auth/keys`,
                purpose: 'Review active and revoked API keys before creating or rotating credentials.',
                notes: Array.isArray(apiKeys)
                    ? [
                        `${apiKeys.filter((key) => key.revokedAt === null).length} active key(s), ${apiKeys.filter((key) => key.revokedAt !== null).length} revoked.`,
                    ]
                    : ['API key inventory is unavailable until an authenticated actor with integration access is configured.'],
            },
            {
                id: 'create-api-key',
                title: 'Create an integration key',
                status: canMutate ? 'ready' : 'blocked',
                command: `${baseCommand} rest request POST /auth/keys --body-json '{\"name\":\"Integration Key\",\"scopes\":[\"content:read\",\"content:write\"]}'`,
                purpose: 'Provision a new API key for an external agent or integration.',
                notes: ['Adjust scopes if the integration only needs read access or audit access.'],
            },
            {
                id: 'inspect-ai-providers',
                title: 'Inspect tenant AI providers',
                status: Array.isArray(aiProviders) ? 'completed' : 'blocked',
                command: `${baseCommand} rest request GET /ai/providers`,
                purpose: 'Review which tenant-scoped OpenAI, Anthropic, or Gemini credentials are already configured for provider-backed draft generation.',
                notes: Array.isArray(aiProviders)
                    ? [
                        aiProviders.length > 0
                            ? `Configured providers: ${aiProviders.map((config) => config.provider).join(', ')}.`
                            : 'No external AI providers are configured for this tenant yet.',
                    ]
                    : ['AI provider inventory is unavailable until an authenticated actor with integration access is configured.'],
            },
            {
                id: 'configure-ai-provider',
                title: 'Configure a tenant AI provider',
                status: canMutate ? 'ready' : 'blocked',
                command: `${baseCommand} rest request PUT /ai/providers/openai --body-json '{\"apiKey\":\"replace-me\",\"defaultModel\":\"gpt-4.1\"}'`,
                purpose: 'Store a tenant-scoped external AI credential for provider-backed draft-generation jobs.',
                notes: ['Replace the provider segment and model to provision Anthropic or Gemini instead of OpenAI.'],
            },
            {
                id: 'inspect-workforce-agents',
                title: 'Inspect workforce agents',
                status: Array.isArray(workforceAgents) ? 'completed' : 'blocked',
                command: `${baseCommand} rest request GET /workforce/agents`,
                purpose: 'Review reusable tenant-managed SOUL profiles and provider/model defaults before wiring forms or jobs.',
                notes: Array.isArray(workforceAgents)
                    ? [
                        `${workforceAgents.filter((agent) => agent.active).length} active workforce agent(s), ${workforceAgents.filter((agent) => !agent.active).length} inactive.`,
                    ]
                    : ['Workforce registry inventory is unavailable until an authenticated actor with integration access is configured.'],
            },
            {
                id: 'create-workforce-agent',
                title: 'Create a workforce agent',
                status: canMutate ? 'ready' : 'blocked',
                command: `${baseCommand} rest request POST /workforce/agents --body-json '{\"name\":\"Proposal Writer\",\"slug\":\"proposal-writer\",\"purpose\":\"Draft software proposals from submitted briefs\",\"soul\":\"Write clear, commercially realistic software proposals.\",\"provider\":{\"type\":\"openai\",\"model\":\"gpt-4.1\"}}'`,
                purpose: 'Provision a reusable workforce agent with a bounded SOUL and provider/model defaults for forms and background jobs.',
                notes: ['Reference the resulting agent by id from form draft-generation config via workforceAgentId.'],
            },
            {
                id: 'rotate-stale-key',
                title: 'Rotate a stale API key',
                status: canMutate && (apiKeys?.some((key) => key.revokedAt === null) ?? false) ? 'ready' : 'optional',
                command: apiKeys?.find((key) => key.revokedAt === null)
                    ? `${baseCommand} rest request PUT /auth/keys/<apiKeyId>`
                    : null,
                purpose: 'Replace an active key without manually discovering the rotation endpoint.',
                notes: apiKeys?.find((key) => key.revokedAt === null)
                    ? ['Replace <apiKeyId> with an active key from the inventory. Update clients immediately after rotation because the plaintext replacement key is only returned once.']
                    : ['No active API key is available to rotate yet.'],
            },
            {
                id: 'inspect-webhooks',
                title: 'Inspect webhook registrations',
                status: Array.isArray(webhooks) ? 'completed' : 'blocked',
                command: `${baseCommand} rest request GET /webhooks`,
                purpose: 'Review existing outbound webhook targets and their event subscriptions.',
                notes: Array.isArray(webhooks)
                    ? [`${webhooks.filter((hook) => hook.active).length} active webhook(s), ${webhooks.filter((hook) => !hook.active).length} inactive.`]
                    : ['Webhook inventory is unavailable until an authenticated actor with integration access is configured.'],
            },
            {
                id: 'create-webhook',
                title: 'Register an outbound webhook',
                status: canMutate ? 'ready' : 'blocked',
                command: `${baseCommand} rest request POST /webhooks --body-json '{\"url\":\"https://example.com/hooks/wordclaw\",\"events\":[\"content_item.create\"],\"secret\":\"replace-me\"}'`,
                purpose: 'Create a webhook registration for downstream integration or notification delivery.',
                notes: ['Use a public HTTPS URL and a shared secret known to the receiving system.'],
            },
        ],
    };
}
