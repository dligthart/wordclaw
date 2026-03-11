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

export type ContentGuide = {
    taskId: 'author-content';
    contentTypeId: number;
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

export function buildContentGuide(options: {
    contentTypeId: number;
    contentType?: ContentTypeLike | null;
    workflow?: WorkflowLike | null;
    currentActor?: CurrentActorSnapshot | null;
    baseCommand?: string;
}): ContentGuide {
    const baseCommand = options.baseCommand ?? 'node dist/cli/index.js';
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
            warnings: ['The target schema could not be inspected because the content type is unavailable to the current actor.'],
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
    const hasWorkflowTransition = workflow.status === 'active' && workflow.transitions.length > 0;

    return {
        taskId: 'author-content',
        contentTypeId: options.contentTypeId,
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
        warnings: schemaSummary.warnings.length > 0 ? schemaSummary.warnings : undefined,
        steps: [
            {
                id: 'inspect-schema',
                title: 'Inspect the target schema',
                status: contentType ? 'completed' : 'blocked',
                command: `${baseCommand} content-types get --id ${options.contentTypeId}`,
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
                command: `${baseCommand} content create --content-type-id ${options.contentTypeId} --data-file draft.json --dry-run`,
                purpose: 'Validate the draft payload against the schema and runtime rules before persisting it.',
                notes: schemaSummary.exampleDraft
                    ? ['Use the exampleDraft from this guide as the starting shape for draft.json.']
                    : undefined,
            },
            {
                id: 'persist-content',
                title: 'Persist the content item',
                status: canAuthor ? 'ready' : 'blocked',
                command: `${baseCommand} content create --content-type-id ${options.contentTypeId} --data-file draft.json`,
                purpose: 'Create the content item after the dry-run succeeds.',
            },
            {
                id: 'inspect-workflow',
                title: 'Inspect the active workflow',
                status: workflow.status === 'active' ? 'completed' : 'optional',
                command: `${baseCommand} workflow active --content-type-id ${options.contentTypeId}`,
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
