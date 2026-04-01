import { and, asc, desc, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { contentItems, contentTypes, formDefinitions, workflowTransitions, workflows } from '../db/schema.js';
import { validateContentDataAgainstSchema } from './content-schema.js';
import {
    type DraftGenerationConfig as FormDraftGenerationConfig,
    type DraftGenerationProviderConfig,
} from './draft-generation.js';
import { getWorkforceAgentById } from './workforce-agent.js';
import { WorkflowService } from './workflow.js';
import { enqueueDraftGenerationJob, enqueueWebhookJob, type JobRecord } from './jobs.js';
import { isSafeWebhookUrl } from './webhook.js';

export type FormFieldType = 'text' | 'textarea' | 'number' | 'checkbox' | 'select';
export type FormFieldOption = {
    label?: string;
    value: string;
};
export type FormDefinitionField = {
    name: string;
    label?: string;
    description?: string;
    type?: FormFieldType;
    required?: boolean;
    placeholder?: string;
    options?: FormFieldOption[];
};
export type FormDefinitionRecord = typeof formDefinitions.$inferSelect;
export type ResolvedFormField = FormDefinitionField & {
    type: FormFieldType;
    required: boolean;
    options?: FormFieldOption[];
};
export type ResolvedFormDraftGenerationConfig = FormDraftGenerationConfig & {
    targetContentTypeName: string;
    targetContentTypeSlug: string;
    workforceAgentId: number | null;
    workforceAgentSlug: string | null;
    workforceAgentName: string | null;
    workforceAgentPurpose: string | null;
};
export type ResolvedFormDefinition = {
    id: number;
    domainId: number;
    name: string;
    slug: string;
    description: string | null;
    contentTypeId: number;
    contentTypeName: string;
    contentTypeSlug: string;
    active: boolean;
    publicRead: boolean;
    submissionStatus: string;
    workflowTransitionId: number | null;
    requirePayment: boolean;
    successMessage: string | null;
    draftGeneration?: ResolvedFormDraftGenerationConfig | null;
    fields: ResolvedFormField[];
    defaultData: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
};

type NormalizedFormInput = {
    name: string;
    slug: string;
    description: string | null;
    contentTypeId: number;
    fields: FormDefinitionField[];
    defaultData: Record<string, unknown>;
    active: boolean;
    publicRead: boolean;
    submissionStatus: string;
    workflowTransitionId: number | null;
    requirePayment: boolean;
    webhookUrl: string | null;
    webhookSecret: string | null;
    successMessage: string | null;
    draftGeneration: FormDraftGenerationConfig | null;
};

type CreateFormDefinitionInput = {
    domainId: number;
    name: string;
    slug: string;
    description?: string | null;
    contentTypeId: number;
    fields: unknown;
    defaultData?: unknown;
    active?: boolean;
    publicRead?: boolean;
    submissionStatus?: string;
    workflowTransitionId?: number | null;
    requirePayment?: boolean;
    webhookUrl?: string | null;
    webhookSecret?: string | null;
    successMessage?: string | null;
    draftGeneration?: unknown | null;
};

type UpdateFormDefinitionInput = Partial<Omit<CreateFormDefinitionInput, 'domainId'>> & {
    domainId: number;
};

type SubmitFormInput = {
    data: Record<string, unknown>;
    request: {
        ip?: string;
        userAgent?: string;
        requestId?: string;
        headers?: Record<string, string | string[] | undefined>;
    };
};

type JsonObject = Record<string, unknown>;
type SubmitFormDefinitionResult = {
    form: ResolvedFormDefinition;
    item: typeof contentItems.$inferSelect;
    reviewTaskId: number | null;
    draftGenerationJob: JobRecord | null;
};

export class FormServiceError extends Error {
    code: string;
    remediation: string;
    statusCode: number;
    context?: Record<string, unknown>;

    constructor(
        message: string,
        code: string,
        remediation: string,
        statusCode = 400,
        context?: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'FormServiceError';
        this.code = code;
        this.remediation = remediation;
        this.statusCode = statusCode;
        this.context = context;
    }
}

function isObject(value: unknown): value is JsonObject {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function normalizeFieldType(propertySchema: JsonObject): FormFieldType | null {
    if (propertySchema['x-wordclaw-localized'] === true || propertySchema['x-wordclaw-field-kind'] !== undefined) {
        return null;
    }

    if (Array.isArray(propertySchema.enum) && propertySchema.enum.every((value) => typeof value === 'string')) {
        return 'select';
    }

    if (propertySchema['x-wordclaw-ui'] && isObject(propertySchema['x-wordclaw-ui']) && propertySchema['x-wordclaw-ui'].widget === 'textarea') {
        return 'textarea';
    }

    switch (propertySchema.type) {
    case 'string':
        return 'text';
    case 'integer':
    case 'number':
        return 'number';
    case 'boolean':
        return 'checkbox';
    default:
        return null;
    }
}

function normalizeFieldOptions(value: unknown, path: string): FormFieldOption[] | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (!Array.isArray(value)) {
        throw new FormServiceError(
            'Invalid form field options',
            'FORM_FIELD_OPTIONS_INVALID',
            `${path} must be an array of { value, label } objects.`,
            400,
        );
    }

    const normalized = value.map((entry, index) => {
        if (!isObject(entry) || !nonEmptyString(entry.value)) {
            throw new FormServiceError(
                'Invalid form field option',
                'FORM_FIELD_OPTION_INVALID',
                `${path}[${index}] must include a non-empty string value.`,
                400,
            );
        }

        return {
            value: entry.value.trim(),
            label: nonEmptyString(entry.label) ? entry.label.trim() : undefined,
        };
    });

    const values = normalized.map((entry) => entry.value);
    if (new Set(values).size !== values.length) {
        throw new FormServiceError(
            'Duplicate form field option values',
            'FORM_FIELD_OPTION_DUPLICATE',
            `${path} option values must be unique.`,
            400,
        );
    }

    return normalized;
}

function parseFields(value: unknown): FormDefinitionField[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new FormServiceError(
            'Form fields are required',
            'FORM_FIELDS_REQUIRED',
            'Provide a non-empty fields array with one or more scalar form field definitions.',
            400,
        );
    }

    const fields = value.map((entry, index) => {
        if (!isObject(entry) || !nonEmptyString(entry.name)) {
            throw new FormServiceError(
                'Invalid form field',
                'FORM_FIELD_INVALID',
                `fields[${index}] must be an object with a non-empty name.`,
                400,
            );
        }

        if (entry.type !== undefined && !['text', 'textarea', 'number', 'checkbox', 'select'].includes(String(entry.type))) {
            throw new FormServiceError(
                'Invalid form field type',
                'FORM_FIELD_TYPE_INVALID',
                `fields[${index}].type must be one of text, textarea, number, checkbox, or select.`,
                400,
            );
        }

        return {
            name: entry.name.trim(),
            label: nonEmptyString(entry.label) ? entry.label.trim() : undefined,
            description: nonEmptyString(entry.description) ? entry.description.trim() : undefined,
            type: entry.type as FormFieldType | undefined,
            required: typeof entry.required === 'boolean' ? entry.required : undefined,
            placeholder: nonEmptyString(entry.placeholder) ? entry.placeholder.trim() : undefined,
            options: normalizeFieldOptions(entry.options, `fields[${index}].options`),
        };
    });

    const names = fields.map((field) => field.name);
    if (new Set(names).size !== names.length) {
        throw new FormServiceError(
            'Duplicate form field names',
            'FORM_FIELD_NAME_DUPLICATE',
            'Each form field name must be unique.',
            400,
        );
    }

    return fields;
}

function parseSchemaProperties(schemaText: string): {
    properties: Record<string, JsonObject>;
    required: Set<string>;
} {
    let parsed: unknown;
    try {
        parsed = JSON.parse(schemaText);
    } catch (error) {
        throw new FormServiceError(
            'Target content type schema is invalid',
            'FORM_CONTENT_SCHEMA_INVALID',
            'Repair the target content type schema before attaching a form definition.',
            409,
            {
                details: error instanceof Error ? error.message : String(error),
            },
        );
    }

    if (!isObject(parsed) || parsed.type !== 'object' || !isObject(parsed.properties)) {
        throw new FormServiceError(
            'Target content type schema is not form-compatible',
            'FORM_CONTENT_SCHEMA_UNSUPPORTED',
            'Target content type schema must be a top-level object with top-level scalar properties.',
            409,
        );
    }

    const required = Array.isArray(parsed.required)
        ? parsed.required.filter((entry): entry is string => typeof entry === 'string')
        : [];

    return {
        properties: parsed.properties as Record<string, JsonObject>,
        required: new Set(required),
    };
}

function normalizeDefaultData(value: unknown): Record<string, unknown> {
    if (value === undefined) {
        return {};
    }

    if (!isObject(value)) {
        throw new FormServiceError(
            'Invalid form default data',
            'FORM_DEFAULT_DATA_INVALID',
            'defaultData must be a JSON object when provided.',
            400,
        );
    }

    return value;
}

function normalizeOptionalString(value: unknown): string | null {
    return nonEmptyString(value) ? value.trim() : null;
}

function normalizeDraftGenerationProviderConfig(value: unknown): DraftGenerationProviderConfig {
    if (value === undefined || value === null) {
        return {
            type: 'deterministic',
        };
    }

    if (!isObject(value)) {
        throw new FormServiceError(
            'Invalid draft generation provider config',
            'FORM_DRAFT_GENERATION_PROVIDER_INVALID',
            'Provide draftGeneration.provider as an object when configured.',
            400,
        );
    }

    const type = normalizeOptionalString(value.type) ?? 'deterministic';
    if (type === 'deterministic') {
        return {
            type: 'deterministic',
        };
    }

    if (type === 'openai') {
        return {
            type: 'openai',
            ...(normalizeOptionalString(value.model) ? { model: normalizeOptionalString(value.model) as string } : {}),
            ...(normalizeOptionalString(value.instructions) ? { instructions: normalizeOptionalString(value.instructions) as string } : {}),
        };
    }

    if (type === 'anthropic') {
        return {
            type: 'anthropic',
            ...(normalizeOptionalString(value.model) ? { model: normalizeOptionalString(value.model) as string } : {}),
            ...(normalizeOptionalString(value.instructions) ? { instructions: normalizeOptionalString(value.instructions) as string } : {}),
        };
    }

    if (type === 'gemini') {
        return {
            type: 'gemini',
            ...(normalizeOptionalString(value.model) ? { model: normalizeOptionalString(value.model) as string } : {}),
            ...(normalizeOptionalString(value.instructions) ? { instructions: normalizeOptionalString(value.instructions) as string } : {}),
        };
    }

    throw new FormServiceError(
        'Unsupported draft generation provider',
        'FORM_DRAFT_GENERATION_PROVIDER_UNSUPPORTED',
        'Use draftGeneration.provider.type = deterministic, openai, anthropic, or gemini.',
        400,
    );
}

async function loadTargetContentType(domainId: number, contentTypeId: number) {
    const [contentType] = await db.select()
        .from(contentTypes)
        .where(and(
            eq(contentTypes.domainId, domainId),
            eq(contentTypes.id, contentTypeId),
        ));

    if (!contentType) {
        throw new FormServiceError(
            'Target content type not found',
            'FORM_CONTENT_TYPE_NOT_FOUND',
            `Choose a content type that exists in the current domain before configuring a form.`,
            404,
            { contentTypeId },
        );
    }

    return contentType;
}

async function validateWorkflowTransition(
    domainId: number,
    contentTypeId: number,
    workflowTransitionId: number | null,
) {
    if (workflowTransitionId === null) {
        return null;
    }

    const [row] = await db.select({
        transitionId: workflowTransitions.id,
        requiredRoles: workflowTransitions.requiredRoles,
        contentTypeId: workflows.contentTypeId,
        active: workflows.active,
    })
        .from(workflowTransitions)
        .innerJoin(workflows, eq(workflowTransitions.workflowId, workflows.id))
        .where(and(
            eq(workflowTransitions.id, workflowTransitionId),
            eq(workflows.domainId, domainId),
        ));

    if (!row) {
        throw new FormServiceError(
            'Workflow transition not found',
            'FORM_WORKFLOW_TRANSITION_NOT_FOUND',
            'Choose a workflow transition that exists in the current domain.',
            404,
        );
    }

    if (row.contentTypeId !== contentTypeId) {
        throw new FormServiceError(
            'Workflow transition content type mismatch',
            'FORM_WORKFLOW_TRANSITION_CONTENT_TYPE_MISMATCH',
            'Choose a workflow transition attached to the same target content type as the form.',
            409,
        );
    }

    if (!row.active) {
        throw new FormServiceError(
            'Workflow transition is inactive',
            'FORM_WORKFLOW_TRANSITION_INACTIVE',
            'Activate the target workflow before attaching it to a form.',
            409,
        );
    }

    if (Array.isArray(row.requiredRoles) && row.requiredRoles.length > 0) {
        throw new FormServiceError(
            'Workflow transition requires authenticated roles',
            'FORM_WORKFLOW_TRANSITION_REQUIRES_ROLES',
            'Choose a transition without required roles for automatic public form submission.',
            409,
        );
    }

    return row;
}

async function normalizeInput(input: CreateFormDefinitionInput | UpdateFormDefinitionInput, existing?: FormDefinitionRecord): Promise<NormalizedFormInput> {
    const name = normalizeOptionalString(input.name) ?? existing?.name ?? null;
    const slug = normalizeOptionalString(input.slug) ?? existing?.slug ?? null;
    const contentTypeId = input.contentTypeId ?? existing?.contentTypeId ?? null;

    if (!name || !slug || !contentTypeId) {
        throw new FormServiceError(
            'Missing required form definition fields',
            'FORM_DEFINITION_REQUIRED_FIELDS',
            'Provide name, slug, contentTypeId, and fields when creating a form definition.',
            400,
        );
    }

    const contentType = await loadTargetContentType(input.domainId, contentTypeId);
    const { properties, required } = parseSchemaProperties(contentType.schema);
    const rawFields = input.fields ?? existing?.fields;
    const fields = parseFields(rawFields);

    const normalizedFields = fields.map((field) => {
        const propertySchema = properties[field.name];
        if (!propertySchema) {
            throw new FormServiceError(
                'Form field does not exist on target content type',
                'FORM_FIELD_NOT_IN_SCHEMA',
                `Remove '${field.name}' or add it to the target content type schema before saving the form.`,
                409,
            );
        }

        const derivedType = normalizeFieldType(propertySchema);
        if (!derivedType) {
            throw new FormServiceError(
                'Form field is not a supported scalar field',
                'FORM_FIELD_UNSUPPORTED',
                `Field '${field.name}' must be a top-level string, number, boolean, or enum-backed select field.`,
                409,
            );
        }

        const requestedType = field.type ?? derivedType;
        if (requestedType !== derivedType) {
            const compatibleStringOverride = (derivedType === 'text' || derivedType === 'textarea')
                && (requestedType === 'text' || requestedType === 'textarea');

            if (!compatibleStringOverride) {
                throw new FormServiceError(
                    'Form field type does not match schema',
                    'FORM_FIELD_TYPE_MISMATCH',
                    `Field '${field.name}' must use the compatible form field type for its target schema property.`,
                    409,
                );
            }
        }

        const enumOptions = Array.isArray(propertySchema.enum)
            ? propertySchema.enum.filter((entry): entry is string => typeof entry === 'string')
            : null;
        if (requestedType === 'select') {
            const configuredOptions = field.options ?? enumOptions?.map((value) => ({ value, label: value }));
            if (!configuredOptions || configuredOptions.length === 0) {
                throw new FormServiceError(
                    'Select field options are required',
                    'FORM_FIELD_SELECT_OPTIONS_REQUIRED',
                    `Provide options for '${field.name}' or add enum values to the target schema property.`,
                    409,
                );
            }

            if (enumOptions) {
                const optionValues = configuredOptions.map((option) => option.value);
                if (optionValues.some((value) => !enumOptions.includes(value))) {
                    throw new FormServiceError(
                        'Select field options do not match schema enum',
                        'FORM_FIELD_SELECT_OPTIONS_INVALID',
                        `Ensure '${field.name}' options only use values declared in the target schema enum.`,
                        409,
                    );
                }
            }
        }

        return {
            ...field,
            type: requestedType,
            required: field.required ?? required.has(field.name),
        };
    });

    const defaultData = normalizeDefaultData(input.defaultData ?? existing?.defaultData);
    const workflowTransitionId = input.workflowTransitionId === undefined
        ? (existing?.workflowTransitionId ?? null)
        : input.workflowTransitionId;
    await validateWorkflowTransition(input.domainId, contentTypeId, workflowTransitionId ?? null);

    const webhookUrl = input.webhookUrl === undefined
        ? normalizeOptionalString(existing?.webhookUrl)
        : normalizeOptionalString(input.webhookUrl);
    if (webhookUrl && !(await isSafeWebhookUrl(webhookUrl))) {
        throw new FormServiceError(
            'Form webhook URL is not allowed',
            'FORM_WEBHOOK_URL_UNSAFE',
            'Use an HTTPS webhook URL that does not resolve to localhost, private, or link-local networks.',
            400,
        );
    }

    const requirePayment = input.requirePayment ?? existing?.requirePayment ?? false;
    if (requirePayment && ((contentType.basePrice ?? 0) <= 0)) {
        throw new FormServiceError(
            'Form payment requirement has no backing price',
            'FORM_PAYMENT_PRICE_MISSING',
            'Set a positive basePrice on the target content type before enabling requirePayment on the form.',
            409,
        );
    }

    const rawDraftGeneration = input.draftGeneration === undefined
        ? existing?.draftGeneration
        : input.draftGeneration;
    const draftGeneration = await normalizeDraftGenerationConfig(
        input.domainId,
        rawDraftGeneration,
        new Set(normalizedFields.map((field) => field.name)),
    );

    return {
        name,
        slug,
        description: normalizeOptionalString(input.description) ?? normalizeOptionalString(existing?.description),
        contentTypeId,
        fields: normalizedFields,
        defaultData,
        active: input.active ?? existing?.active ?? true,
        publicRead: input.publicRead ?? existing?.publicRead ?? true,
        submissionStatus: normalizeOptionalString(input.submissionStatus) ?? existing?.submissionStatus ?? 'draft',
        workflowTransitionId: workflowTransitionId ?? null,
        requirePayment,
        webhookUrl,
        webhookSecret: input.webhookSecret === undefined
            ? normalizeOptionalString(existing?.webhookSecret)
            : normalizeOptionalString(input.webhookSecret),
        successMessage: normalizeOptionalString(input.successMessage) ?? normalizeOptionalString(existing?.successMessage),
        draftGeneration,
    };
}

async function normalizeDraftGenerationConfig(
    domainId: number,
    value: unknown,
    sourceFieldNames: Set<string>,
): Promise<FormDraftGenerationConfig | null> {
    if (value === undefined || value === null) {
        return null;
    }

    if (!isObject(value)) {
        throw new FormServiceError(
            'Invalid draft generation config',
            'FORM_DRAFT_GENERATION_INVALID',
            'draftGeneration must be an object when provided.',
            400,
        );
    }

    const targetContentTypeId = typeof value.targetContentTypeId === 'number'
        && Number.isInteger(value.targetContentTypeId)
        && value.targetContentTypeId > 0
        ? value.targetContentTypeId
        : null;
    if (targetContentTypeId === null) {
        throw new FormServiceError(
            'Draft generation target content type is required',
            'FORM_DRAFT_GENERATION_TARGET_CONTENT_TYPE_REQUIRED',
            'Provide draftGeneration.targetContentTypeId as a positive integer.',
            400,
        );
    }

    const workforceAgentId = value.workforceAgentId === undefined || value.workforceAgentId === null
        ? null
        : typeof value.workforceAgentId === 'number'
            && Number.isInteger(value.workforceAgentId)
            && value.workforceAgentId > 0
            ? value.workforceAgentId
            : null;
    if (
        value.workforceAgentId !== undefined
        && value.workforceAgentId !== null
        && workforceAgentId === null
    ) {
        throw new FormServiceError(
            'Draft generation workforce agent is invalid',
            'FORM_DRAFT_GENERATION_WORKFORCE_AGENT_INVALID',
            'Provide draftGeneration.workforceAgentId as a positive integer or null.',
            400,
        );
    }

    const workforceAgent = workforceAgentId
        ? await getWorkforceAgentById(domainId, workforceAgentId)
        : null;
    if (workforceAgentId && (!workforceAgent || !workforceAgent.active)) {
        throw new FormServiceError(
            'Draft generation workforce agent not found',
            'FORM_DRAFT_GENERATION_WORKFORCE_AGENT_NOT_FOUND',
            `Use an active workforce agent for draftGeneration.workforceAgentId=${workforceAgentId} before saving the form.`,
            409,
        );
    }

    const agentSoul = normalizeOptionalString(value.agentSoul) ?? workforceAgent?.soul ?? null;
    if (!agentSoul) {
        throw new FormServiceError(
            'Draft generation agent soul is required',
            'FORM_DRAFT_GENERATION_AGENT_SOUL_REQUIRED',
            'Provide draftGeneration.agentSoul as a non-empty string, or reference an active workforce agent with a configured SOUL.',
            400,
        );
    }

    const targetContentType = await loadTargetContentType(domainId, targetContentTypeId);
    const { properties: targetProperties } = parseSchemaProperties(targetContentType.schema);
    const fieldMapValue = value.fieldMap;
    let fieldMap: Record<string, string> = {};
    if (fieldMapValue !== undefined) {
        if (!isObject(fieldMapValue)) {
            throw new FormServiceError(
                'Invalid draft generation field map',
                'FORM_DRAFT_GENERATION_FIELD_MAP_INVALID',
                'Provide draftGeneration.fieldMap as an object mapping form field names to target content field names.',
                400,
            );
        }

        const normalizedEntries = Object.entries(fieldMapValue).map(([sourceFieldName, targetFieldName]) => {
            const normalizedSourceFieldName = sourceFieldName.trim();
            const normalizedTargetFieldName = normalizeOptionalString(targetFieldName);

            if (!normalizedSourceFieldName || !normalizedTargetFieldName) {
                throw new FormServiceError(
                    'Invalid draft generation field map entry',
                    'FORM_DRAFT_GENERATION_FIELD_MAP_ENTRY_INVALID',
                    'Each draftGeneration.fieldMap entry must use non-empty string source and target field names.',
                    400,
                );
            }

            if (!sourceFieldNames.has(normalizedSourceFieldName)) {
                throw new FormServiceError(
                    'Draft generation field map source is invalid',
                    'FORM_DRAFT_GENERATION_FIELD_MAP_SOURCE_INVALID',
                    `Map only from declared form fields. '${normalizedSourceFieldName}' is not part of this form definition.`,
                    409,
                );
            }

            if (!Object.hasOwn(targetProperties, normalizedTargetFieldName)) {
                throw new FormServiceError(
                    'Draft generation field map target is invalid',
                    'FORM_DRAFT_GENERATION_FIELD_MAP_TARGET_INVALID',
                    `Map only to top-level fields on the target content type. '${normalizedTargetFieldName}' does not exist there.`,
                    409,
                );
            }

            return [normalizedSourceFieldName, normalizedTargetFieldName] as const;
        });

        const targetFieldNames = normalizedEntries.map(([, targetFieldName]) => targetFieldName);
        if (new Set(targetFieldNames).size !== targetFieldNames.length) {
            throw new FormServiceError(
                'Draft generation field map targets must be unique',
                'FORM_DRAFT_GENERATION_FIELD_MAP_TARGET_DUPLICATE',
                'Each target field can only be mapped once in draftGeneration.fieldMap.',
                409,
            );
        }

        fieldMap = Object.fromEntries(normalizedEntries);
    }

    const defaultData = normalizeDefaultData(value.defaultData);
    const provider = value.provider === undefined
        ? workforceAgent?.provider ?? normalizeDraftGenerationProviderConfig(undefined)
        : normalizeDraftGenerationProviderConfig(value.provider);

    const transitionValue = value.postGenerationWorkflowTransitionId;
    let postGenerationWorkflowTransitionId: number | null = null;
    if (transitionValue === null) {
        postGenerationWorkflowTransitionId = null;
    } else if (transitionValue !== undefined) {
        if (
            typeof transitionValue !== 'number'
            || !Number.isInteger(transitionValue)
            || transitionValue <= 0
        ) {
            throw new FormServiceError(
                'Invalid draft generation workflow transition',
                'FORM_DRAFT_GENERATION_WORKFLOW_TRANSITION_INVALID',
                'Provide draftGeneration.postGenerationWorkflowTransitionId as a positive integer or null.',
                400,
            );
        }
        postGenerationWorkflowTransitionId = transitionValue;
    }

    await validateWorkflowTransition(
        domainId,
        targetContentTypeId,
        postGenerationWorkflowTransitionId,
    );

    return {
        targetContentTypeId,
        workforceAgentId,
        agentSoul,
        fieldMap,
        defaultData,
        postGenerationWorkflowTransitionId,
        provider,
    };
}

async function resolveDraftGenerationConfig(
    domainId: number,
    value: unknown,
): Promise<ResolvedFormDraftGenerationConfig | null> {
    if (!isObject(value)) {
        return null;
    }

    const targetContentTypeId = typeof value.targetContentTypeId === 'number'
        && Number.isInteger(value.targetContentTypeId)
        && value.targetContentTypeId > 0
        ? value.targetContentTypeId
        : null;
    const workforceAgentId = typeof value.workforceAgentId === 'number'
        && Number.isInteger(value.workforceAgentId)
        && value.workforceAgentId > 0
        ? value.workforceAgentId
        : null;
    const workforceAgent = workforceAgentId
        ? await getWorkforceAgentById(domainId, workforceAgentId)
        : null;
    const agentSoul = workforceAgent?.soul ?? normalizeOptionalString(value.agentSoul);
    if (targetContentTypeId === null || !agentSoul) {
        return null;
    }

    const [targetContentType] = await db.select({
        id: contentTypes.id,
        name: contentTypes.name,
        slug: contentTypes.slug,
    })
        .from(contentTypes)
        .where(and(
            eq(contentTypes.domainId, domainId),
            eq(contentTypes.id, targetContentTypeId),
        ));

    return {
        targetContentTypeId,
        targetContentTypeName: targetContentType?.name ?? '(missing)',
        targetContentTypeSlug: targetContentType?.slug ?? '(missing)',
        workforceAgentId,
        workforceAgentSlug: workforceAgent?.slug ?? null,
        workforceAgentName: workforceAgent?.name ?? null,
        workforceAgentPurpose: workforceAgent?.purpose ?? null,
        agentSoul,
        fieldMap: isObject(value.fieldMap)
            ? Object.fromEntries(
                Object.entries(value.fieldMap).flatMap(([sourceFieldName, targetFieldName]) => {
                    const normalizedSourceFieldName = sourceFieldName.trim();
                    const normalizedTargetFieldName = normalizeOptionalString(targetFieldName);
                    if (!normalizedSourceFieldName || !normalizedTargetFieldName) {
                        return [];
                    }

                    return [[normalizedSourceFieldName, normalizedTargetFieldName]];
                }),
            )
            : {},
        defaultData: isObject(value.defaultData) ? value.defaultData : {},
        postGenerationWorkflowTransitionId: typeof value.postGenerationWorkflowTransitionId === 'number'
            && Number.isInteger(value.postGenerationWorkflowTransitionId)
            && value.postGenerationWorkflowTransitionId > 0
            ? value.postGenerationWorkflowTransitionId
            : null,
        provider: workforceAgent?.provider ?? normalizeDraftGenerationProviderConfig(value.provider),
    };
}

async function resolveFormDefinition(row: FormDefinitionRecord): Promise<ResolvedFormDefinition> {
    const contentType = await loadTargetContentType(row.domainId, row.contentTypeId);
    const draftGeneration = await resolveDraftGenerationConfig(row.domainId, row.draftGeneration);

    return {
        id: row.id,
        domainId: row.domainId,
        name: row.name,
        slug: row.slug,
        description: row.description,
        contentTypeId: row.contentTypeId,
        contentTypeName: contentType.name,
        contentTypeSlug: contentType.slug,
        active: row.active,
        publicRead: row.publicRead,
        submissionStatus: row.submissionStatus,
        workflowTransitionId: row.workflowTransitionId,
        requirePayment: row.requirePayment,
        successMessage: row.successMessage,
        draftGeneration,
        fields: Array.isArray(row.fields) ? row.fields as ResolvedFormField[] : [],
        defaultData: isObject(row.defaultData) ? row.defaultData : {},
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export async function listFormDefinitions(domainId: number) {
    const rows = await db.select()
        .from(formDefinitions)
        .where(eq(formDefinitions.domainId, domainId))
        .orderBy(asc(formDefinitions.slug), desc(formDefinitions.id));

    return Promise.all(rows.map((row) => resolveFormDefinition(row)));
}

export async function getFormDefinitionById(domainId: number, id: number) {
    const [row] = await db.select()
        .from(formDefinitions)
        .where(and(
            eq(formDefinitions.domainId, domainId),
            eq(formDefinitions.id, id),
        ));

    return row ? resolveFormDefinition(row) : null;
}

export async function getFormDefinitionBySlug(domainId: number, slug: string) {
    const [row] = await db.select()
        .from(formDefinitions)
        .where(and(
            eq(formDefinitions.domainId, domainId),
            eq(formDefinitions.slug, slug),
        ));

    return row ? resolveFormDefinition(row) : null;
}

export async function createFormDefinition(input: CreateFormDefinitionInput) {
    const normalized = await normalizeInput(input);
    const [created] = await db.insert(formDefinitions).values({
        domainId: input.domainId,
        name: normalized.name,
        slug: normalized.slug,
        description: normalized.description,
        contentTypeId: normalized.contentTypeId,
        fields: normalized.fields,
        defaultData: normalized.defaultData,
        active: normalized.active,
        publicRead: normalized.publicRead,
        submissionStatus: normalized.submissionStatus,
        workflowTransitionId: normalized.workflowTransitionId,
        requirePayment: normalized.requirePayment,
        webhookUrl: normalized.webhookUrl,
        webhookSecret: normalized.webhookSecret,
        successMessage: normalized.successMessage,
        draftGeneration: normalized.draftGeneration,
    }).returning();

    return resolveFormDefinition(created);
}

export async function updateFormDefinition(id: number, input: UpdateFormDefinitionInput) {
    const [existing] = await db.select()
        .from(formDefinitions)
        .where(and(
            eq(formDefinitions.domainId, input.domainId),
            eq(formDefinitions.id, id),
        ));

    if (!existing) {
        throw new FormServiceError(
            'Form definition not found',
            'FORM_DEFINITION_NOT_FOUND',
            `No form definition exists with id ${id} in the current domain.`,
            404,
        );
    }

    const normalized = await normalizeInput(input, existing);
    const [updated] = await db.update(formDefinitions)
        .set({
            name: normalized.name,
            slug: normalized.slug,
            description: normalized.description,
            contentTypeId: normalized.contentTypeId,
            fields: normalized.fields,
            defaultData: normalized.defaultData,
            active: normalized.active,
            publicRead: normalized.publicRead,
            submissionStatus: normalized.submissionStatus,
            workflowTransitionId: normalized.workflowTransitionId,
            requirePayment: normalized.requirePayment,
            webhookUrl: normalized.webhookUrl,
            webhookSecret: normalized.webhookSecret,
            successMessage: normalized.successMessage,
            draftGeneration: normalized.draftGeneration,
            updatedAt: new Date(),
        })
        .where(and(
            eq(formDefinitions.domainId, input.domainId),
            eq(formDefinitions.id, id),
        ))
        .returning();

    return resolveFormDefinition(updated);
}

export async function deleteFormDefinition(domainId: number, id: number) {
    const [deleted] = await db.delete(formDefinitions)
        .where(and(
            eq(formDefinitions.domainId, domainId),
            eq(formDefinitions.id, id),
        ))
        .returning();

    return deleted ? resolveFormDefinition(deleted) : null;
}

export async function submitFormDefinition(domainId: number, slug: string, input: SubmitFormInput): Promise<SubmitFormDefinitionResult> {
    const form = await getFormDefinitionBySlug(domainId, slug);
    if (!form) {
        throw new FormServiceError(
            'Form definition not found',
            'FORM_DEFINITION_NOT_FOUND',
            `No form definition exists with slug '${slug}' in the current domain.`,
            404,
        );
    }

    if (!form.active) {
        throw new FormServiceError(
            'Form definition is inactive',
            'FORM_DEFINITION_INACTIVE',
            `Activate form '${slug}' before accepting submissions.`,
            409,
        );
    }

    const targetContentType = await loadTargetContentType(domainId, form.contentTypeId);
    const [internalConfig] = await db.select({
        webhookUrl: formDefinitions.webhookUrl,
        webhookSecret: formDefinitions.webhookSecret,
    })
        .from(formDefinitions)
        .where(and(
            eq(formDefinitions.domainId, domainId),
            eq(formDefinitions.id, form.id),
        ));
    const payload = input.data;
    const allowedFields = new Set(form.fields.map((field) => field.name));
    const unknownFields = Object.keys(payload).filter((key) => !allowedFields.has(key));
    if (unknownFields.length > 0) {
        throw new FormServiceError(
            'Form submission contains unknown fields',
            'FORM_SUBMISSION_UNKNOWN_FIELDS',
            `Remove unexpected field(s): ${unknownFields.join(', ')}.`,
            400,
            {
                fields: unknownFields,
            },
        );
    }

    for (const field of form.fields) {
        if (field.required && payload[field.name] === undefined) {
            throw new FormServiceError(
                'Form submission is missing a required field',
                'FORM_SUBMISSION_REQUIRED_FIELD_MISSING',
                `Provide '${field.name}' before retrying the form submission.`,
                400,
                {
                    field: field.name,
                },
            );
        }
    }

    const mergedData = {
        ...form.defaultData,
        ...payload,
    };
    const serializedData = JSON.stringify(mergedData);
    const validationFailure = await validateContentDataAgainstSchema(targetContentType.schema, serializedData, domainId);
    if (validationFailure) {
        throw new FormServiceError(
            validationFailure.error,
            validationFailure.code,
            validationFailure.remediation,
            400,
            validationFailure.context,
        );
    }

    const [item] = await db.insert(contentItems).values({
        domainId,
        contentTypeId: form.contentTypeId,
        data: serializedData,
        status: form.submissionStatus,
    }).returning();

    let reviewTaskId: number | null = null;
    if (form.workflowTransitionId) {
        const task = await WorkflowService.submitForReview({
            domainId,
            contentItemId: item.id,
            workflowTransitionId: form.workflowTransitionId,
        });
        reviewTaskId = task.id;
    }

    let draftGenerationJob: JobRecord | null = null;
    if (form.draftGeneration) {
        const workforceAgent = form.draftGeneration.workforceAgentId
            ? await getWorkforceAgentById(domainId, form.draftGeneration.workforceAgentId)
            : null;
        if (form.draftGeneration.workforceAgentId && (!workforceAgent || !workforceAgent.active)) {
            throw new FormServiceError(
                'Draft generation workforce agent is unavailable',
                'FORM_DRAFT_GENERATION_WORKFORCE_AGENT_UNAVAILABLE',
                `The referenced workforce agent ${form.draftGeneration.workforceAgentId} is missing or inactive. Update the form to use an active agent before accepting submissions.`,
                409,
            );
        }

        const draftProvider = workforceAgent?.provider ?? form.draftGeneration.provider;
        const draftSoul = workforceAgent?.soul ?? form.draftGeneration.agentSoul;
        draftGenerationJob = await enqueueDraftGenerationJob({
            domainId,
            formId: form.id,
            formSlug: form.slug,
            intakeContentItemId: item.id,
            intakeData: mergedData,
            targetContentTypeId: form.draftGeneration.targetContentTypeId,
            workforceAgentId: workforceAgent?.id ?? form.draftGeneration.workforceAgentId ?? null,
            workforceAgentSlug: workforceAgent?.slug ?? form.draftGeneration.workforceAgentSlug ?? null,
            workforceAgentName: workforceAgent?.name ?? form.draftGeneration.workforceAgentName ?? null,
            workforceAgentPurpose: workforceAgent?.purpose ?? form.draftGeneration.workforceAgentPurpose ?? null,
            agentSoul: draftSoul,
            fieldMap: form.draftGeneration.fieldMap,
            defaultData: form.draftGeneration.defaultData,
            postGenerationWorkflowTransitionId: form.draftGeneration.postGenerationWorkflowTransitionId,
            provider: draftProvider,
        });
    }

    if (internalConfig?.webhookUrl) {
        await enqueueWebhookJob({
            domainId,
            url: internalConfig.webhookUrl,
            secret: normalizeOptionalString(internalConfig.webhookSecret) ?? null,
            source: 'form',
            body: {
                event: 'form.submitted',
                form: {
                    id: form.id,
                    slug: form.slug,
                    name: form.name,
                    contentTypeId: form.contentTypeId,
                    contentTypeSlug: form.contentTypeSlug,
                },
                submission: {
                    contentItemId: item.id,
                    status: item.status,
                    reviewTaskId,
                    draftGenerationJobId: draftGenerationJob?.id ?? null,
                    data: mergedData,
                },
                request: {
                    ip: input.request.ip ?? null,
                    userAgent: input.request.userAgent ?? null,
                    requestId: input.request.requestId ?? null,
                },
            },
        });
    }

    return {
        form,
        item,
        reviewTaskId,
        draftGenerationJob,
    };
}
