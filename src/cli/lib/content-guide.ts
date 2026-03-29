import type { CurrentActorSnapshot } from '../../services/actor-identity.js';

type ContentTypeLike = {
    id: number;
    name: string;
    slug: string;
    description?: string | null;
    schema: string;
    basePrice?: number | null;
    createdAt?: string;
    updatedAt?: string;
};

type WorkflowLike = {
    id: number;
    name: string;
    contentTypeId: number;
    active: boolean;
    transitions: Array<{
        id: number;
        workflowId: number;
        fromState: string;
        toState: string;
        requiredRoles?: string[];
    }>;
};

export type ContentGuideStep = {
    id: string;
    title: string;
    status: 'completed' | 'ready' | 'blocked' | 'optional';
    command: string | null;
    purpose: string;
    notes?: string[];
};

export type ContentGuideSchemaPattern = {
    id: 'memory' | 'task-log' | 'checkpoint';
    title: string;
    useCase: string;
    suggestedFields: Array<{
        name: string;
        type: string;
        required: boolean;
        purpose: string;
    }>;
    searchableTextFields: string[];
    manifest: Record<string, unknown>;
};

export type ContentGuide = {
    taskId: 'author-content';
    mode: 'schema-design' | 'content-authoring';
    contentTypeId: number | null;
    requiredActorProfiles: Array<'api-key' | 'env-key' | 'supervisor-session' | 'mcp-local'>;
    requiredScopes: string[];
    dryRunRecommended: boolean;
    currentActor: CurrentActorSnapshot | null;
    actorReadiness: {
        status: 'ready' | 'blocked' | 'warning';
        supportedActorProfile: boolean;
        requiredScopesSatisfied: boolean;
        notes: string[];
    };
    contentType: {
        id: number;
        name: string;
        slug: string;
        description: string | null;
        basePrice: number | null;
        createdAt: string | null;
        updatedAt: string | null;
    } | null;
    schemaSummary: {
        available: boolean;
        rootType: string | null;
        fieldCount: number;
        requiredFieldCount: number;
        requiredFields: string[];
        fields: Array<{
            name: string;
            type: string;
            required: boolean;
        }>;
        exampleDraft: Record<string, unknown> | null;
    };
    workflow: {
        status: 'active' | 'none' | 'unavailable';
        id: number | null;
        name: string | null;
        transitionCount: number;
        transitions: Array<{
            id: number;
            fromState: string;
            toState: string;
            requiredRoles: string[];
        }>;
    };
    schemaDesignGuidance: {
        available: boolean;
        recommendedSource: 'schemaManifest';
        notes: string[];
        embeddingBehavior: {
            indexedValueKinds: string[];
            skippedTopLevelFields: string[];
            caveats: string[];
        };
        patterns: ContentGuideSchemaPattern[];
    };
    warnings?: string[];
    steps: ContentGuideStep[];
};

function normalizeSchemaType(schema: Record<string, unknown>): string {
    if (typeof schema.const === 'string') {
        return 'const';
    }

    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        return 'enum';
    }

    const schemaType = schema.type;
    if (typeof schemaType === 'string') {
        return schemaType;
    }

    if (Array.isArray(schemaType) && schemaType.length > 0) {
        const first = schemaType.find((entry) => typeof entry === 'string');
        if (typeof first === 'string') {
            return first;
        }
    }

    if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
        return normalizeSchemaType(
            (schema.oneOf.find((entry) => typeof entry === 'object' && entry !== null) as Record<string, unknown>) ?? {},
        );
    }

    if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
        return normalizeSchemaType(
            (schema.anyOf.find((entry) => typeof entry === 'object' && entry !== null) as Record<string, unknown>) ?? {},
        );
    }

    if (typeof schema.properties === 'object' && schema.properties !== null) {
        return 'object';
    }

    return 'unknown';
}

function buildExampleValue(schema: Record<string, unknown>, depth = 0): unknown {
    if (depth > 2) {
        return '<value>';
    }

    if ('const' in schema) {
        return schema.const;
    }

    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        return schema.enum[0];
    }

    const schemaType = normalizeSchemaType(schema);

    if ((schemaType === 'object' || schema.properties) && typeof schema.properties === 'object' && schema.properties !== null) {
        const properties = schema.properties as Record<string, unknown>;
        const required = Array.isArray(schema.required)
            ? schema.required.filter((entry): entry is string => typeof entry === 'string')
            : Object.keys(properties);

        return Object.fromEntries(
            required
                .filter((name) => typeof properties[name] === 'object' && properties[name] !== null)
                .map((name) => [name, buildExampleValue(properties[name] as Record<string, unknown>, depth + 1)]),
        );
    }

    if (schemaType === 'array') {
        if (typeof schema.items === 'object' && schema.items !== null) {
            return [buildExampleValue(schema.items as Record<string, unknown>, depth + 1)];
        }
        return [];
    }

    if (schemaType === 'integer' || schemaType === 'number') {
        return 0;
    }

    if (schemaType === 'boolean') {
        return false;
    }

    if (schemaType === 'null') {
        return null;
    }

    return `<${schemaType}>`;
}

function summarizeSchema(rawSchema: string): {
    warnings: string[];
    available: boolean;
    rootType: string | null;
    fieldCount: number;
    requiredFieldCount: number;
    requiredFields: string[];
    fields: Array<{
        name: string;
        type: string;
        required: boolean;
    }>;
    exampleDraft: Record<string, unknown> | null;
} {
    try {
        const parsed = JSON.parse(rawSchema) as Record<string, unknown>;
        const rootType = normalizeSchemaType(parsed);
        const properties = typeof parsed.properties === 'object' && parsed.properties !== null
            ? parsed.properties as Record<string, unknown>
            : {};
        const requiredFields = Array.isArray(parsed.required)
            ? parsed.required.filter((entry): entry is string => typeof entry === 'string')
            : [];
        const fields = Object.entries(properties).map(([name, value]) => ({
            name,
            type: typeof value === 'object' && value !== null
                ? normalizeSchemaType(value as Record<string, unknown>)
                : 'unknown',
            required: requiredFields.includes(name),
        }));

        return {
            warnings: [],
            available: true,
            rootType,
            fieldCount: fields.length,
            requiredFieldCount: requiredFields.length,
            requiredFields,
            fields,
            exampleDraft: fields.length > 0
                ? buildExampleValue(parsed) as Record<string, unknown>
                : {},
        };
    } catch {
        return {
            warnings: ['The content type schema could not be parsed as JSON, so field-level guidance is unavailable.'],
            available: false,
            rootType: null,
            fieldCount: 0,
            requiredFieldCount: 0,
            requiredFields: [],
            fields: [],
            exampleDraft: null,
        };
    }
}

function buildSchemaDesignPatterns(): ContentGuideSchemaPattern[] {
    return [
        {
            id: 'memory',
            title: 'Agent Memory',
            useCase: 'Persist durable facts or preferences that should stay searchable across runs without mixing them into execution logs.',
            suggestedFields: [
                {
                    name: 'memoryKey',
                    type: 'text',
                    required: true,
                    purpose: 'Stable identifier for idempotent upserts and later retrieval.'
                },
                {
                    name: 'subjectId',
                    type: 'text',
                    required: true,
                    purpose: 'Actor, customer, project, or tenant identifier that scopes the memory.'
                },
                {
                    name: 'summary',
                    type: 'text',
                    required: true,
                    purpose: 'Compact top-level sentence for semantic retrieval.'
                },
                {
                    name: 'details',
                    type: 'textarea',
                    required: false,
                    purpose: 'Long-form supporting context when the summary alone is insufficient.'
                },
                {
                    name: 'tags',
                    type: 'array',
                    required: false,
                    purpose: 'Short labels that improve exact filtering and grouping.'
                },
                {
                    name: 'status',
                    type: 'select',
                    required: true,
                    purpose: 'Lifecycle signal such as active, stale, or archived.'
                },
                {
                    name: 'provenance',
                    type: 'group',
                    required: false,
                    purpose: 'Track who captured the memory and from which source.'
                }
            ],
            searchableTextFields: ['summary', 'details'],
            manifest: {
                title: 'Agent Memory',
                description: 'Durable memory entries optimized for retrieval.',
                preview: {
                    titleField: 'summary',
                    subtitleField: 'memoryKey'
                },
                fields: [
                    {
                        name: 'memoryKey',
                        type: 'text',
                        required: true
                    },
                    {
                        name: 'subjectId',
                        type: 'text',
                        required: true
                    },
                    {
                        name: 'summary',
                        type: 'text',
                        required: true
                    },
                    {
                        name: 'details',
                        type: 'textarea'
                    },
                    {
                        name: 'tags',
                        type: 'array',
                        itemType: 'text'
                    },
                    {
                        name: 'status',
                        type: 'select',
                        required: true,
                        options: ['active', 'stale', 'archived']
                    },
                    {
                        name: 'provenance',
                        type: 'group',
                        fields: [
                            {
                                name: 'source',
                                type: 'text'
                            },
                            {
                                name: 'capturedBy',
                                type: 'text'
                            },
                            {
                                name: 'capturedAt',
                                type: 'text'
                            }
                        ]
                    }
                ]
            }
        },
        {
            id: 'task-log',
            title: 'Task Log',
            useCase: 'Capture execution checkpoints, observations, and operator-facing run history for an agent task or job.',
            suggestedFields: [
                {
                    name: 'runId',
                    type: 'text',
                    required: true,
                    purpose: 'Stable run identifier so repeated writes stay correlated.'
                },
                {
                    name: 'stepKey',
                    type: 'text',
                    required: true,
                    purpose: 'Deterministic checkpoint key inside the run.'
                },
                {
                    name: 'summary',
                    type: 'text',
                    required: true,
                    purpose: 'Short searchable statement of what happened.'
                },
                {
                    name: 'detail',
                    type: 'textarea',
                    required: false,
                    purpose: 'Longer execution notes, evidence, or operator-readable context.'
                },
                {
                    name: 'status',
                    type: 'select',
                    required: true,
                    purpose: 'Execution lifecycle such as queued, running, succeeded, or failed.'
                },
                {
                    name: 'tags',
                    type: 'array',
                    required: false,
                    purpose: 'Low-cardinality labels for filtering and summaries.'
                },
                {
                    name: 'provenance',
                    type: 'group',
                    required: false,
                    purpose: 'Actor and source references for audit and replay.'
                }
            ],
            searchableTextFields: ['summary', 'detail'],
            manifest: {
                title: 'Task Log',
                description: 'Execution log entries for agent runs.',
                lifecycle: {
                    enabled: true,
                    ttlSeconds: 2592000,
                    archiveStatus: 'expired',
                    clock: 'updatedAt'
                },
                preview: {
                    titleField: 'summary',
                    subtitleField: 'runId'
                },
                fields: [
                    {
                        name: 'runId',
                        type: 'text',
                        required: true
                    },
                    {
                        name: 'stepKey',
                        type: 'text',
                        required: true
                    },
                    {
                        name: 'summary',
                        type: 'text',
                        required: true
                    },
                    {
                        name: 'detail',
                        type: 'textarea'
                    },
                    {
                        name: 'status',
                        type: 'select',
                        required: true,
                        options: ['queued', 'running', 'succeeded', 'failed']
                    },
                    {
                        name: 'tags',
                        type: 'array',
                        itemType: 'text'
                    },
                    {
                        name: 'provenance',
                        type: 'group',
                        fields: [
                            {
                                name: 'actorId',
                                type: 'text'
                            },
                            {
                                name: 'actorType',
                                type: 'text'
                            },
                            {
                                name: 'source',
                                type: 'text'
                            }
                        ]
                    }
                ]
            }
        },
        {
            id: 'checkpoint',
            title: 'Checkpoint',
            useCase: 'Store resumable agent state between runs without forcing the next agent to reconstruct progress from raw logs.',
            suggestedFields: [
                {
                    name: 'checkpointKey',
                    type: 'text',
                    required: true,
                    purpose: 'Stable identifier for the resumable state snapshot.'
                },
                {
                    name: 'parentCheckpointKey',
                    type: 'text',
                    required: false,
                    purpose: 'Link to the previous checkpoint when resumability forms a chain.'
                },
                {
                    name: 'summary',
                    type: 'text',
                    required: true,
                    purpose: 'Concise searchable description of the saved state.'
                },
                {
                    name: 'stateJson',
                    type: 'textarea',
                    required: false,
                    purpose: 'Serialized machine-readable state when full replay is too expensive.'
                },
                {
                    name: 'status',
                    type: 'select',
                    required: true,
                    purpose: 'Checkpoint lifecycle such as active, superseded, or invalid.'
                },
                {
                    name: 'tags',
                    type: 'array',
                    required: false,
                    purpose: 'Filterable labels for branch, flow, or environment.'
                },
                {
                    name: 'provenance',
                    type: 'group',
                    required: false,
                    purpose: 'Capture who wrote the checkpoint and why.'
                }
            ],
            searchableTextFields: ['summary'],
            manifest: {
                title: 'Checkpoint',
                description: 'Resumable agent checkpoint snapshots.',
                preview: {
                    titleField: 'summary',
                    subtitleField: 'checkpointKey'
                },
                fields: [
                    {
                        name: 'checkpointKey',
                        type: 'text',
                        required: true
                    },
                    {
                        name: 'parentCheckpointKey',
                        type: 'text'
                    },
                    {
                        name: 'summary',
                        type: 'text',
                        required: true
                    },
                    {
                        name: 'stateJson',
                        type: 'textarea'
                    },
                    {
                        name: 'status',
                        type: 'select',
                        required: true,
                        options: ['active', 'superseded', 'invalid']
                    },
                    {
                        name: 'tags',
                        type: 'array',
                        itemType: 'text'
                    },
                    {
                        name: 'provenance',
                        type: 'group',
                        fields: [
                            {
                                name: 'reason',
                                type: 'text'
                            },
                            {
                                name: 'capturedBy',
                                type: 'text'
                            },
                            {
                                name: 'capturedAt',
                                type: 'text'
                            }
                        ]
                    }
                ]
            }
        }
    ];
}

function buildSchemaDesignGuidance() {
    return {
        available: true,
        recommendedSource: 'schemaManifest' as const,
        notes: [
            'Prefer schema manifests for agent-authored models so field intent stays explicit and supervisor forms can be generated automatically.',
            'Include one stable identifier field for idempotent writes, a tags array for low-cardinality filtering, an explicit status field for lifecycle, and a provenance group for actor/source metadata.',
            'Keep one concise top-level searchable field such as summary or title even when the full payload also stores longer structured state.'
        ],
        embeddingBehavior: {
            indexedValueKinds: [
                'Top-level string fields',
                'Top-level numbers and booleans',
                'Top-level arrays after simple join() flattening'
            ],
            skippedTopLevelFields: ['slug', 'coverImage', 'authorId', 'category', 'readTimeMinutes', 'avatarUrl', 'socialLinks', 'id'],
            caveats: [
                'Nested objects do not currently produce dedicated semantic chunks, so mirror retrieval-critical content into top-level summary/body style fields.',
                'Asset and content references are useful for structure, but they should not be the only source of searchable text.',
                'Large machine-state blobs belong in secondary fields such as stateJson, while a short top-level summary should carry the retrievable meaning.'
            ]
        },
        patterns: buildSchemaDesignPatterns(),
    };
}

export function buildContentGuide(options: {
    contentTypeId?: number | null;
    contentType?: ContentTypeLike | null;
    workflow?: WorkflowLike | null;
    currentActor?: CurrentActorSnapshot | null;
    baseCommand?: string;
}): ContentGuide {
    const baseCommand = options.baseCommand ?? 'node dist/cli/index.js';
    const contentTypeId = options.contentTypeId ?? null;
    const mode = contentTypeId === null ? 'schema-design' : 'content-authoring';
    const currentActor = options.currentActor ?? null;
    const requiredActorProfiles: Array<'api-key' | 'env-key' | 'supervisor-session' | 'mcp-local'> = [
        'api-key',
        'env-key',
        'supervisor-session',
        'mcp-local',
    ];
    const requiredScopes = ['content:write'];
    const supportedActorProfile = currentActor
        ? requiredActorProfiles.includes(currentActor.actorProfileId as typeof requiredActorProfiles[number])
        : false;
    const requiredScopesSatisfied = currentActor
        ? currentActor.scopes.includes('admin') || requiredScopes.every((scope) => currentActor.scopes.includes(scope))
        : false;
    const actorReadinessNotes: string[] = [];

    if (!currentActor) {
        actorReadinessNotes.push('No authenticated actor snapshot is available yet.');
    } else {
        actorReadinessNotes.push(`Current actor ${currentActor.actorId} is using profile ${currentActor.actorProfileId} in domain ${currentActor.domainId}.`);
        if (!supportedActorProfile) {
            actorReadinessNotes.push('Content authoring requires an API key, supervisor session, or local MCP actor profile.');
        }
        if (!requiredScopesSatisfied) {
            actorReadinessNotes.push('The current actor is missing content:write or admin scope for authoring operations.');
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
    const schemaSummary = options.contentType
        ? summarizeSchema(options.contentType.schema)
        : {
            warnings: mode === 'schema-design'
                ? ['No target content type was selected, so this guide is returning schema design guidance instead of schema-specific draft commands.']
                : ['The target schema could not be inspected because the content type is unavailable to the current actor.'],
            available: false,
            rootType: null,
            fieldCount: 0,
            requiredFieldCount: 0,
            requiredFields: [],
            fields: [] as Array<{ name: string; type: string; required: boolean }>,
            exampleDraft: null,
        };
    const workflow = options.workflow === undefined
        ? {
            status: 'unavailable' as const,
            id: null,
            name: null,
            transitionCount: 0,
            transitions: [] as Array<{ id: number; fromState: string; toState: string; requiredRoles: string[] }>,
        }
        : options.workflow === null
            ? {
                status: 'none' as const,
                id: null,
                name: null,
                transitionCount: 0,
                transitions: [] as Array<{ id: number; fromState: string; toState: string; requiredRoles: string[] }>,
            }
            : {
                status: 'active' as const,
                id: options.workflow.id,
                name: options.workflow.name,
                transitionCount: options.workflow.transitions.length,
                transitions: options.workflow.transitions.map((transition) => ({
                    id: transition.id,
                    fromState: transition.fromState,
                    toState: transition.toState,
                    requiredRoles: transition.requiredRoles ?? [],
                })),
            };
    const contentType = options.contentType
        ? {
            id: options.contentType.id,
            name: options.contentType.name,
            slug: options.contentType.slug,
            description: options.contentType.description ?? null,
            basePrice: options.contentType.basePrice ?? null,
            createdAt: options.contentType.createdAt ?? null,
            updatedAt: options.contentType.updatedAt ?? null,
        }
        : null;
    const canAuthor = schemaSummary.available && actorReadinessStatus !== 'blocked';
    const canMutateSchema = actorReadinessStatus !== 'blocked';
    const hasWorkflowTransition = workflow.status === 'active' && workflow.transitions.length > 0;
    const schemaDesignGuidance = buildSchemaDesignGuidance();

    return {
        taskId: 'author-content',
        mode,
        contentTypeId,
        requiredActorProfiles,
        requiredScopes,
        dryRunRecommended: true,
        currentActor,
        actorReadiness: {
            status: actorReadinessStatus,
            supportedActorProfile,
            requiredScopesSatisfied,
            notes: actorReadinessNotes,
        },
        contentType,
        schemaSummary: {
            available: schemaSummary.available,
            rootType: schemaSummary.rootType,
            fieldCount: schemaSummary.fieldCount,
            requiredFieldCount: schemaSummary.requiredFieldCount,
            requiredFields: schemaSummary.requiredFields,
            fields: schemaSummary.fields,
            exampleDraft: schemaSummary.exampleDraft,
        },
        workflow,
        schemaDesignGuidance,
        warnings: schemaSummary.warnings.length > 0 ? schemaSummary.warnings : undefined,
        steps: mode === 'schema-design'
            ? [
                {
                    id: 'inspect-workspace',
                    title: 'Inspect current authoring targets',
                    status: currentActor ? 'ready' : 'blocked',
                    command: `${baseCommand} workspace guide --intent authoring`,
                    purpose: 'Check whether an existing content model already fits the agent task before creating a new one.',
                    notes: currentActor
                        ? ['Pair this with content-types list if you need the raw inventory.']
                        : ['Authenticate first if you want runtime-aware authoring inventory from the current domain.'],
                },
                {
                    id: 'draft-schema-manifest',
                    title: 'Draft a schema manifest locally',
                    status: 'ready',
                    command: null,
                    purpose: 'Start from one of the schemaDesignGuidance.patterns manifests and adapt identifiers, tags, lifecycle, and provenance fields for the task.',
                    notes: [
                        'Prefer a stable key such as memoryKey, runId, or checkpointKey for idempotent writes.',
                        'Keep retrieval-critical text in a short top-level summary/title field so semantic indexing stays useful.',
                    ],
                },
                {
                    id: 'validate-content-type',
                    title: 'Dry-run the new content type',
                    status: canMutateSchema ? 'ready' : 'blocked',
                    command: `${baseCommand} content-types create --name AgentMemory --slug agent-memory --schema-manifest-file memory.manifest.json --dry-run`,
                    purpose: 'Validate the schema manifest against the runtime compiler before persisting the model.',
                },
                {
                    id: 'persist-content-type',
                    title: 'Create the content type',
                    status: canMutateSchema ? 'ready' : 'blocked',
                    command: `${baseCommand} content-types create --name AgentMemory --slug agent-memory --schema-manifest-file memory.manifest.json`,
                    purpose: 'Persist the schema once the dry-run succeeds so content authoring can target a real content type id.',
                },
                {
                    id: 'generate-artifacts',
                    title: 'Generate local client artifacts',
                    status: 'optional',
                    command: `${baseCommand} schema generate --out ./generated/wordclaw`,
                    purpose: 'Refresh generated types and helper clients after the schema lands.',
                    notes: ['Run this after the content type exists, especially when agent workers consume the schema locally.'],
                },
            ]
            : [
                {
                    id: 'inspect-schema',
                    title: 'Inspect the target schema',
                    status: contentType ? 'completed' : 'blocked',
                    command: `${baseCommand} content-types get --id ${contentTypeId}`,
                    purpose: 'Read the schema, slug, pricing, and metadata for the content model before drafting data.',
                    notes: contentType && schemaSummary.available
                        ? [
                            `Schema ${contentType.name} exposes ${schemaSummary.fieldCount} top-level field(s).`,
                            schemaSummary.requiredFields.length > 0
                                ? `Required fields: ${schemaSummary.requiredFields.join(', ')}.`
                                : 'No top-level required fields were declared.',
                        ]
                        : undefined,
                },
                {
                    id: 'validate-draft',
                    title: 'Dry-run a draft write',
                    status: canAuthor ? 'ready' : 'blocked',
                    command: `${baseCommand} content create --content-type-id ${contentTypeId} --data-file draft.json --dry-run`,
                    purpose: 'Validate the draft payload against the schema and runtime rules before persisting it.',
                    notes: schemaSummary.exampleDraft
                        ? ['Use the exampleDraft from this guide as the starting shape for draft.json.']
                        : undefined,
                },
                {
                    id: 'persist-content',
                    title: 'Persist the content item',
                    status: canAuthor ? 'ready' : 'blocked',
                    command: `${baseCommand} content create --content-type-id ${contentTypeId} --data-file draft.json`,
                    purpose: 'Create the content item after the dry-run succeeds.',
                },
                {
                    id: 'inspect-workflow',
                    title: 'Inspect the active workflow',
                    status: workflow.status === 'active' ? 'completed' : 'optional',
                    command: `${baseCommand} workflow active --content-type-id ${contentTypeId}`,
                    purpose: 'Check whether this schema has a review path that should be used after writing content.',
                    notes: workflow.status === 'active'
                        ? [`Active workflow ${workflow.name} exposes ${workflow.transitionCount} transition(s).`]
                        : ['No active workflow is currently attached to this schema.'],
                },
                {
                    id: 'submit-review',
                    title: 'Submit the item into review',
                    status: hasWorkflowTransition && canAuthor ? 'ready' : 'optional',
                    command: hasWorkflowTransition
                        ? `${baseCommand} workflow submit --id <contentItemId> --transition ${workflow.transitions[0].id}`
                        : null,
                    purpose: 'Move the newly created content item into the first available review transition when governance is enabled.',
                    notes: hasWorkflowTransition
                        ? [`Replace <contentItemId> after creation. First transition: ${workflow.transitions[0].fromState} -> ${workflow.transitions[0].toState}.`]
                        : ['Skip this step when the schema has no active workflow.'],
                },
            ],
    };
}
