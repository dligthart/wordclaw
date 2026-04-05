import OpenAI from 'openai';

import { EmbeddingService } from './embedding.js';

type JsonObject = Record<string, unknown>;
type JsonArray = unknown[];

type DraftGenerationSemanticContextResult = {
    contentItemId: number;
    contentTypeSlug: string;
    similarity: number;
    textChunk: string;
};

type DraftGenerationSemanticContext = {
    query: string;
    results: DraftGenerationSemanticContextResult[];
};

const WORKFORCE_SEMANTIC_CONTEXT_LIMIT = 4;
const WORKFORCE_SEMANTIC_QUERY_FRAGMENT_LIMIT = 12;
const WORKFORCE_SEMANTIC_QUERY_MAX_CHARS = 3000;
const WORKFORCE_SEMANTIC_QUERY_VALUE_MAX_CHARS = 240;

export type DraftGenerationProviderConfig =
    | {
        type: 'deterministic';
    }
    | {
        type: 'openai';
        model?: string;
        instructions?: string;
    }
    | {
        type: 'anthropic';
        model?: string;
        instructions?: string;
    }
    | {
        type: 'gemini';
        model?: string;
        instructions?: string;
    };

export type DraftGenerationProviderProvisioning =
    | {
        type: 'deterministic';
    }
    | {
        type: 'openai';
        apiKey: string;
        defaultModel: string | null;
    }
    | {
        type: 'anthropic';
        apiKey: string;
        defaultModel: string | null;
    }
    | {
        type: 'gemini';
        apiKey: string;
        defaultModel: string | null;
    };

export type DraftGenerationConfig = {
    targetContentTypeId: number;
    workforceAgentId?: number | null;
    agentSoul: string;
    fieldMap: Record<string, string>;
    defaultData: Record<string, unknown>;
    postGenerationWorkflowTransitionId: number | null;
    provider: DraftGenerationProviderConfig;
};

export type DraftGenerationTargetContentType = {
    id: number;
    name: string;
    slug: string;
    schema: string;
};

export type DraftGenerationWorkforceAgentReference = {
    id: number;
    slug: string;
    name: string;
    purpose: string;
};

export type DraftGenerationAssetReference = {
    assetId: number;
    path: string;
};

export type DraftGenerationAttachment = {
    assetId: number;
    path: string;
    filename: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    accessMode: 'public' | 'signed' | 'entitled';
    inlineImageDataUrl?: string | null;
    inlineImageBase64?: string | null;
};

export type DraftGenerationInput = {
    domainId: number;
    formId: number;
    formSlug: string;
    intakeContentItemId: number;
    intakeData: Record<string, unknown>;
    currentDraftData?: Record<string, unknown> | null;
    revisionPrompt?: string | null;
    targetContentType: DraftGenerationTargetContentType;
    agentSoul: string;
    fieldMap: Record<string, string>;
    defaultData: Record<string, unknown>;
    provider: DraftGenerationProviderConfig;
    providerProvisioning?: DraftGenerationProviderProvisioning | null;
    workforceAgent?: DraftGenerationWorkforceAgentReference | null;
    attachments?: DraftGenerationAttachment[];
};

export type DraftGenerationResult = {
    data: Record<string, unknown>;
    strategy: string;
    provider: {
        type: DraftGenerationProviderConfig['type'];
        model: string | null;
        responseId: string | null;
    };
};

export class DraftGenerationError extends Error {
    code: string;
    statusCode: number;

    constructor(code: string, message: string, statusCode = 500) {
        super(message);
        this.name = 'DraftGenerationError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

function isObject(value: unknown): value is JsonObject {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isArray(value: unknown): value is JsonArray {
    return Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function truncateText(value: string, maxChars: number): string {
    if (value.length <= maxChars) {
        return value;
    }

    return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function collectSemanticQueryFragments(
    value: unknown,
    path: string,
    fragments: string[],
) {
    if (fragments.length >= WORKFORCE_SEMANTIC_QUERY_FRAGMENT_LIMIT) {
        return;
    }

    const normalizedString = normalizeOptionalString(value);
    if (normalizedString) {
        fragments.push(`${path}: ${truncateText(normalizedString, WORKFORCE_SEMANTIC_QUERY_VALUE_MAX_CHARS)}`);
        return;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        fragments.push(`${path}: ${String(value)}`);
        return;
    }

    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            collectSemanticQueryFragments(value[index], `${path}[${index}]`, fragments);
            if (fragments.length >= WORKFORCE_SEMANTIC_QUERY_FRAGMENT_LIMIT) {
                return;
            }
        }
        return;
    }

    if (!isObject(value)) {
        return;
    }

    for (const [key, childValue] of Object.entries(value)) {
        collectSemanticQueryFragments(
            childValue,
            path ? `${path}.${key}` : key,
            fragments,
        );
        if (fragments.length >= WORKFORCE_SEMANTIC_QUERY_FRAGMENT_LIMIT) {
            return;
        }
    }
}

function buildWorkforceSemanticSearchQuery(input: DraftGenerationInput): string | null {
    if (!input.workforceAgent) {
        return null;
    }

    const fragments: string[] = [];
    collectSemanticQueryFragments(input.intakeData, 'intake', fragments);

    const revisionPrompt = getRevisionPrompt(input);
    const currentDraftData = getCurrentDraftData(input);
    if (revisionPrompt) {
        fragments.push(`revisionPrompt: ${truncateText(revisionPrompt, WORKFORCE_SEMANTIC_QUERY_VALUE_MAX_CHARS)}`);
    }
    if (currentDraftData && fragments.length < WORKFORCE_SEMANTIC_QUERY_FRAGMENT_LIMIT) {
        collectSemanticQueryFragments(currentDraftData, 'currentDraft', fragments);
    }

    const query = [
        `Workforce agent: ${input.workforceAgent.name} (${input.workforceAgent.slug})`,
        `Purpose: ${input.workforceAgent.purpose}`,
        `SOUL: ${input.agentSoul}`,
        `Target content type: ${input.targetContentType.name} (${input.targetContentType.slug})`,
        `Form slug: ${input.formSlug}`,
        ...fragments,
    ]
        .filter((entry) => entry.trim().length > 0)
        .join('\n');

    return query.length > 0
        ? truncateText(query, WORKFORCE_SEMANTIC_QUERY_MAX_CHARS)
        : null;
}

async function resolveWorkforceSemanticContext(
    input: DraftGenerationInput,
): Promise<DraftGenerationSemanticContext | null> {
    if (!input.workforceAgent || input.provider.type === 'deterministic') {
        return null;
    }

    const query = buildWorkforceSemanticSearchQuery(input);
    if (!query) {
        return null;
    }

    try {
        const results = await EmbeddingService.searchSemanticKnowledge(
            input.domainId,
            query,
            WORKFORCE_SEMANTIC_CONTEXT_LIMIT,
        );

        const normalizedResults = results
            .map((result) => ({
                contentItemId: result.contentItemId,
                contentTypeSlug: result.contentTypeSlug,
                similarity: Number(result.similarity),
                textChunk: truncateText(result.textChunk, 600),
            }))
            .filter((result) => result.textChunk.length > 0);

        if (normalizedResults.length === 0) {
            return null;
        }

        return {
            query,
            results: normalizedResults,
        };
    } catch {
        return null;
    }
}

function parseSchemaObject(schemaText: string): JsonObject {
    let parsed: unknown;
    try {
        parsed = JSON.parse(schemaText);
    } catch {
        throw new DraftGenerationError(
            'DRAFT_GENERATION_TARGET_SCHEMA_INVALID',
            'Target content type schema is invalid JSON.',
            409,
        );
    }

    if (!isObject(parsed)) {
        throw new DraftGenerationError(
            'DRAFT_GENERATION_TARGET_SCHEMA_INVALID',
            'Target content type schema must be a JSON object.',
            409,
        );
    }

    return parsed;
}

export function parseTopLevelSchemaProperties(schemaText: string): Set<string> {
    const parsed = parseSchemaObject(schemaText);
    if (
        parsed.type !== 'object'
        || !isObject(parsed.properties)
    ) {
        throw new DraftGenerationError(
            'DRAFT_GENERATION_TARGET_SCHEMA_UNSUPPORTED',
            'Target content type schema must be a top-level object with properties for draft generation.',
            409,
        );
    }

    return new Set(Object.keys(parsed.properties as Record<string, unknown>));
}

function buildDeterministicBaselineData(input: DraftGenerationInput): Record<string, unknown> {
    const targetKeys = parseTopLevelSchemaProperties(input.targetContentType.schema);
    const mappedSourceFieldNames = new Set(Object.keys(input.fieldMap));
    const reservedTargetFieldNames = new Set(Object.values(input.fieldMap));
    const invalidMappedTargetFieldNames = Array.from(reservedTargetFieldNames).filter((targetFieldName) => !targetKeys.has(targetFieldName));
    if (invalidMappedTargetFieldNames.length > 0) {
        throw new DraftGenerationError(
            'DRAFT_GENERATION_FIELD_MAP_TARGET_INVALID',
            `Draft generation fieldMap targets not found on target content type: ${invalidMappedTargetFieldNames.join(', ')}.`,
            409,
        );
    }

    const mappedInputData = Object.fromEntries(
        Object.entries(input.fieldMap).flatMap(([sourceFieldName, targetFieldName]) => (
            Object.prototype.hasOwnProperty.call(input.intakeData, sourceFieldName)
                ? [[targetFieldName, input.intakeData[sourceFieldName]]]
                : []
        )),
    );
    const copiedInputData = Object.fromEntries(
        Object.entries(input.intakeData).filter(([key]) => (
            targetKeys.has(key)
            && !mappedSourceFieldNames.has(key)
            && !reservedTargetFieldNames.has(key)
        )),
    );

    return {
        ...input.defaultData,
        ...mappedInputData,
        ...copiedInputData,
    };
}

function stripCustomSchemaExtensions(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => stripCustomSchemaExtensions(entry));
    }

    if (!isObject(value)) {
        return value;
    }

    return Object.fromEntries(
        Object.entries(value).flatMap(([key, childValue]) => (
            key.startsWith('x-wordclaw-')
                ? []
                : [[key, stripCustomSchemaExtensions(childValue)]]
        )),
    );
}

function parseSanitizedTargetSchema(schemaText: string): JsonObject {
    const sanitizedSchema = stripCustomSchemaExtensions(parseSchemaObject(schemaText));
    if (!isObject(sanitizedSchema)) {
        throw new DraftGenerationError(
            'DRAFT_GENERATION_TARGET_SCHEMA_INVALID',
            'Target content type schema must remain a JSON object after sanitization.',
            409,
        );
    }

    return sanitizedSchema;
}

function normalizeSchemaTypeList(typeValue: unknown): string[] | null {
    if (typeof typeValue === 'string') {
        return [typeValue];
    }

    if (!isArray(typeValue)) {
        return null;
    }

    const normalized = typeValue.filter((entry): entry is string => typeof entry === 'string');
    return normalized.length > 0 ? normalized : null;
}

function schemaAllowsNull(schema: JsonObject): boolean {
    const typeList = normalizeSchemaTypeList(schema.type);
    if (typeList?.includes('null')) {
        return true;
    }

    if (isArray(schema.enum) && schema.enum.includes(null)) {
        return true;
    }

    if (schema.const === null) {
        return true;
    }

    if (isArray(schema.anyOf)) {
        return schema.anyOf.some((entry) => isObject(entry) && schemaAllowsNull(entry));
    }

    if (isArray(schema.oneOf)) {
        return schema.oneOf.some((entry) => isObject(entry) && schemaAllowsNull(entry));
    }

    return false;
}

function makeSchemaNullable(schema: JsonObject): JsonObject {
    if (schemaAllowsNull(schema)) {
        return schema;
    }

    const typeList = normalizeSchemaTypeList(schema.type);
    if (typeList) {
        return {
            ...schema,
            type: [...typeList, 'null'],
        };
    }

    if (isArray(schema.enum)) {
        return {
            ...schema,
            enum: [...schema.enum, null],
        };
    }

    if (isArray(schema.anyOf)) {
        return {
            ...schema,
            anyOf: [
                ...schema.anyOf,
                { type: 'null' },
            ],
        };
    }

    if (isArray(schema.oneOf)) {
        return {
            ...schema,
            oneOf: [
                ...schema.oneOf,
                { type: 'null' },
            ],
        };
    }

    return {
        anyOf: [
            schema,
            { type: 'null' },
        ],
    };
}

function transformSchemaForOpenAiStructuredOutputs(schema: unknown): unknown {
    if (isArray(schema)) {
        return schema.map((entry) => transformSchemaForOpenAiStructuredOutputs(entry));
    }

    if (!isObject(schema)) {
        return schema;
    }

    if (schema.type === 'object' || isObject(schema.properties)) {
        const rawProperties = isObject(schema.properties) ? schema.properties : {};
        const requiredFields = new Set(
            isArray(schema.required)
                ? schema.required.filter((entry): entry is string => typeof entry === 'string')
                : [],
        );

        const transformedProperties = Object.fromEntries(
            Object.entries(rawProperties).map(([key, value]) => {
                const transformedProperty = transformSchemaForOpenAiStructuredOutputs(value);
                if (!isObject(transformedProperty)) {
                    return [key, transformedProperty];
                }

                return [
                    key,
                    requiredFields.has(key)
                        ? transformedProperty
                        : makeSchemaNullable(transformedProperty),
                ];
            }),
        );

        return {
            ...Object.fromEntries(
                Object.entries(schema)
                    .filter(([key]) => key !== 'properties' && key !== 'required' && key !== 'additionalProperties')
                    .map(([key, value]) => [key, transformSchemaForOpenAiStructuredOutputs(value)]),
            ),
            type: 'object',
            properties: transformedProperties,
            required: Object.keys(rawProperties),
            additionalProperties: false,
        };
    }

    return Object.fromEntries(
        Object.entries(schema).map(([key, value]) => [key, transformSchemaForOpenAiStructuredOutputs(value)]),
    );
}

function pruneNullOptionalFields(value: unknown, originalSchema: unknown): unknown {
    if (value === null || !isObject(originalSchema)) {
        return value;
    }

    if (isArray(value)) {
        const itemSchema = originalSchema.items;
        return isObject(itemSchema)
            ? value.map((entry) => pruneNullOptionalFields(entry, itemSchema))
            : value;
    }

    if (!isObject(value)) {
        return value;
    }

    if (originalSchema.type === 'object' || isObject(originalSchema.properties)) {
        const propertySchemas = isObject(originalSchema.properties) ? originalSchema.properties : {};
        const requiredFields = new Set(
            isArray(originalSchema.required)
                ? originalSchema.required.filter((entry): entry is string => typeof entry === 'string')
                : [],
        );

        return Object.fromEntries(
            Object.entries(value).flatMap(([key, childValue]) => {
                const childSchema = propertySchemas[key];
                if (
                    childValue === null
                    && childSchema !== undefined
                    && !requiredFields.has(key)
                ) {
                    return [];
                }

                return [[
                    key,
                    childSchema !== undefined
                        ? pruneNullOptionalFields(childValue, childSchema)
                        : childValue,
                ]];
            }),
        );
    }

    return value;
}

function sanitizeSchemaName(input: string): string {
    const normalized = input
        .trim()
        .replace(/[^A-Za-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');

    return normalized.length > 0 ? normalized.slice(0, 64) : 'draft_generation_output';
}

function getProviderInstructions(input: DraftGenerationInput): string | null {
    if (input.provider.type === 'deterministic') {
        return null;
    }

    return normalizeOptionalString(input.provider.instructions);
}

function getRevisionPrompt(input: DraftGenerationInput): string | null {
    return normalizeOptionalString(input.revisionPrompt);
}

function getCurrentDraftData(input: DraftGenerationInput): Record<string, unknown> | null {
    return isObject(input.currentDraftData) ? input.currentDraftData : null;
}

function isRevisionGeneration(input: DraftGenerationInput): boolean {
    return Boolean(getRevisionPrompt(input) || getCurrentDraftData(input));
}

function mergeProviderGeneratedData(
    generatedData: Record<string, unknown>,
    deterministicBaseline: Record<string, unknown>,
): Record<string, unknown> {
    return {
        ...deterministicBaseline,
        ...generatedData,
    };
}

function buildContentSpecificInstructions(input: DraftGenerationInput): string[] {
    const targetKeys = parseTopLevelSchemaProperties(input.targetContentType.schema);
    const looksLikeProposal = (
        targetKeys.has('recommendedApproach')
        && targetKeys.has('deliveryPlan')
        && targetKeys.has('nextSteps')
    );

    if (!looksLikeProposal) {
        return [];
    }

    return [
        'This target schema represents a proposal-style document.',
        'Do not keep the proposal high level when the intake contains concrete scope, constraints, integrations, rollout needs, governance, or delivery sequencing.',
        'Write detailed, client-specific proposal content rather than a generic template.',
        'In recommendedApproach, explain the proposed solution shape, delivery strategy, major workstreams, integration or architecture considerations, and quality or governance controls.',
        'In deliveryPlan, break the work into concrete phases or work packages with enough detail that a human reviewer can understand scope, sequencing, dependencies, and expected outcomes.',
        'In assumptions, include operational, technical, security, compliance, stakeholder, and delivery assumptions that are reasonably implied by the intake.',
        'In nextSteps, include concrete commercial and delivery actions such as workshops, discovery tasks, approvals, architecture validation, and kickoff preparation.',
        'Prefer multi-sentence or enumerated detail in long-form fields when the intake supports it.',
    ];
}

function buildOpenAiInstructions(
    input: DraftGenerationInput,
    semanticContext: DraftGenerationSemanticContext | null,
): string {
    const baseInstructions = [
        'You are WordClaw\'s governed draft generation worker.',
        input.workforceAgent
            ? `You are acting as workforce agent "${input.workforceAgent.name}" (${input.workforceAgent.slug}).`
            : 'You are acting as a tenant-defined drafting agent.',
        input.workforceAgent
            ? `Declared purpose: ${input.workforceAgent.purpose}`
            : 'Declared purpose: produce governed draft output for this intake submission.',
        `SOUL: ${input.agentSoul}`,
        'Produce a single JSON object that matches the supplied output schema exactly.',
        'Ground the output in the intake payload and the deterministic baseline fields provided to you.',
        'Do not invent facts that are not supported by the intake payload.',
        'If a field is optional and the intake does not support it, omit it instead of fabricating content.',
    ];

    if (semanticContext?.results.length) {
        baseInstructions.push(
            'Retrieved same-domain semantic context may be provided below. Use it as supporting workspace knowledge when it clearly fits the current request.',
        );
        baseInstructions.push(
            'Never let retrieved context override explicit intake facts, supervisor revision instructions, or the target schema.',
        );
    }

    const revisionPrompt = getRevisionPrompt(input);
    if (revisionPrompt) {
        baseInstructions.push('A human supervisor has asked you to revise an existing draft that is still pending review.');
        baseInstructions.push(`Supervisor revision request: ${revisionPrompt}`);
        baseInstructions.push('Treat the supervisor revision request as a required change request, not a hint.');
        baseInstructions.push('Use the current draft as editable context, keep supported facts grounded in the intake payload, and make the requested changes directly.');
        baseInstructions.push('You may revise baseline-derived fields when needed to satisfy the supervisor request.');
        baseInstructions.push('Keep unchanged fields stable where possible, but do not preserve wording that conflicts with the revision request.');
    } else {
        baseInstructions.push('Treat deterministic baseline fields as fallback scaffolding, not the final answer.');
        baseInstructions.push('When the intake supports a more specific or tailored value, replace generic baseline wording instead of copying it verbatim.');
        baseInstructions.push('Use the baseline mainly to ensure required fields stay populated when the intake is sparse.');
    }

    baseInstructions.push(...buildContentSpecificInstructions(input));

    const extraInstructions = getProviderInstructions(input);

    if (extraInstructions) {
        baseInstructions.push(`Additional operator instructions: ${extraInstructions}`);
    }

    return baseInstructions.join('\n');
}

function formatSemanticContextForPrompt(semanticContext: DraftGenerationSemanticContext): string {
    return [
        `Semantic search query: ${semanticContext.query}`,
        ...semanticContext.results.map((result, index) => [
            `${index + 1}. contentItemId=${result.contentItemId}, contentType=${result.contentTypeSlug}, similarity=${result.similarity.toFixed(4)}`,
            result.textChunk,
        ].join('\n')),
    ].join('\n\n');
}

function buildOpenAiInputText(
    input: DraftGenerationInput,
    deterministicBaseline: Record<string, unknown>,
    semanticContext: DraftGenerationSemanticContext | null,
): string {
    const currentDraftData = getCurrentDraftData(input);
    const revisionPrompt = getRevisionPrompt(input);

    return [
        'Create governed draft content for this intake submission.',
        '',
        `Domain ID: ${input.domainId}`,
        `Form ID: ${input.formId}`,
        `Form Slug: ${input.formSlug}`,
        `Intake Content Item ID: ${input.intakeContentItemId}`,
        `Target Content Type: ${input.targetContentType.name} (${input.targetContentType.slug})`,
        ...(input.workforceAgent
            ? [
                `Workforce Agent ID: ${input.workforceAgent.id}`,
                `Workforce Agent Slug: ${input.workforceAgent.slug}`,
                `Workforce Agent Name: ${input.workforceAgent.name}`,
                `Workforce Agent Purpose: ${input.workforceAgent.purpose}`,
            ]
            : []),
        `SOUL: ${input.agentSoul}`,
        '',
        'Deterministic baseline fields:',
        JSON.stringify(deterministicBaseline, null, 2),
        '',
        'Intake payload:',
        JSON.stringify(input.intakeData, null, 2),
        ...(revisionPrompt
            ? [
                '',
                'Supervisor revision request:',
                revisionPrompt,
            ]
            : []),
        ...(currentDraftData
            ? [
                '',
                'Current draft to revise:',
                JSON.stringify(currentDraftData, null, 2),
            ]
            : []),
        '',
        'Explicit field mapping:',
        JSON.stringify(input.fieldMap, null, 2),
        '',
        'Referenced image attachments:',
        buildAttachmentManifestText(input.attachments ?? []),
        ...(semanticContext?.results.length
            ? [
                '',
                'Retrieved same-domain semantic context:',
                formatSemanticContextForPrompt(semanticContext),
            ]
            : []),
    ].join('\n');
}

function buildAttachmentManifestText(attachments: DraftGenerationAttachment[]): string {
    const imageAttachments = attachments.filter((attachment) =>
        Boolean(normalizeInlineImageMimeType(attachment.mimeType)),
    );

    if (imageAttachments.length === 0) {
        return 'No supported image attachments were referenced in the intake payload.';
    }

    return imageAttachments.map((attachment, index) => {
        const delivery = attachment.inlineImageDataUrl
            ? 'inline image attached'
            : 'metadata only';

        return [
            `${index + 1}. assetId=${attachment.assetId}`,
            `path=${attachment.path}`,
            `filename=${attachment.originalFilename}`,
            `mimeType=${attachment.mimeType}`,
            `sizeBytes=${attachment.sizeBytes}`,
            `accessMode=${attachment.accessMode}`,
            `delivery=${delivery}`,
        ].join(', ');
    }).join('\n');
}

function normalizeInlineImageMimeType(mimeType: string): string | null {
    const normalized = mimeType.trim().toLowerCase();
    if (normalized === 'image/jpg') {
        return 'image/jpeg';
    }

    return ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(normalized)
        ? normalized
        : null;
}

function buildUnifiedPromptText(
    input: DraftGenerationInput,
    deterministicBaseline: Record<string, unknown>,
    semanticContext: DraftGenerationSemanticContext | null,
): string {
    return [
        buildOpenAiInstructions(input, semanticContext),
        '',
        buildOpenAiInputText(input, deterministicBaseline, semanticContext),
    ].join('\n');
}

function buildOpenAiInputContent(
    input: DraftGenerationInput,
    deterministicBaseline: Record<string, unknown>,
    semanticContext: DraftGenerationSemanticContext | null,
) {
    const content: Array<
        { type: 'input_text'; text: string }
        | { type: 'input_image'; image_url: string; detail: 'auto' }
    > = [{
        type: 'input_text',
        text: buildOpenAiInputText(input, deterministicBaseline, semanticContext),
    }];

    for (const attachment of input.attachments ?? []) {
        if (normalizeOptionalString(attachment.inlineImageDataUrl)) {
            content.push({
                type: 'input_image',
                image_url: attachment.inlineImageDataUrl as string,
                detail: 'auto',
            });
        }
    }

    return content;
}

function buildAnthropicInputContent(
    input: DraftGenerationInput,
    deterministicBaseline: Record<string, unknown>,
    semanticContext: DraftGenerationSemanticContext | null,
) {
    const content: Array<
        { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
        | { type: 'text'; text: string }
    > = [];

    for (const attachment of input.attachments ?? []) {
        const mediaType = normalizeInlineImageMimeType(attachment.mimeType);
        const inlineImageBase64 = normalizeOptionalString(attachment.inlineImageBase64);
        if (mediaType && inlineImageBase64) {
            content.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: inlineImageBase64,
                },
            });
        }
    }

    content.push({
        type: 'text',
        text: buildOpenAiInputText(input, deterministicBaseline, semanticContext),
    });

    return content;
}

function buildGeminiParts(
    input: DraftGenerationInput,
    deterministicBaseline: Record<string, unknown>,
    semanticContext: DraftGenerationSemanticContext | null,
) {
    const parts: Array<
        { inlineData: { mimeType: string; data: string } }
        | { text: string }
    > = [];

    for (const attachment of input.attachments ?? []) {
        const mimeType = normalizeInlineImageMimeType(attachment.mimeType);
        const inlineImageBase64 = normalizeOptionalString(attachment.inlineImageBase64);
        if (mimeType && inlineImageBase64) {
            parts.push({
                inlineData: {
                    mimeType,
                    data: inlineImageBase64,
                },
            });
        }
    }

    parts.push({
        text: buildUnifiedPromptText(input, deterministicBaseline, semanticContext),
    });

    return parts;
}

async function parseJsonTextResult(
    outputText: string | null,
    emptyCode: string,
    emptyMessage: string,
    invalidCode: string,
    invalidMessagePrefix: string,
): Promise<Record<string, unknown>> {
    const normalizedOutputText = normalizeOptionalString(outputText);
    if (!normalizedOutputText) {
        throw new DraftGenerationError(emptyCode, emptyMessage, 502);
    }

    let generatedData: unknown;
    try {
        generatedData = JSON.parse(normalizedOutputText);
    } catch (error) {
        throw new DraftGenerationError(
            invalidCode,
            `${invalidMessagePrefix}: ${error instanceof Error ? error.message : String(error)}`,
            502,
        );
    }

    if (!isObject(generatedData)) {
        throw new DraftGenerationError(
            invalidCode,
            `${invalidMessagePrefix}: top-level JSON object required.`,
            502,
        );
    }

    return generatedData;
}

function requireProvisionedProvider<TProviderType extends 'openai' | 'anthropic' | 'gemini'>(
    input: DraftGenerationInput,
    providerType: TProviderType,
): Extract<DraftGenerationProviderProvisioning, { type: TProviderType }> {
    const provisionedProvider = input.providerProvisioning?.type === providerType
        ? input.providerProvisioning
        : null;
    const apiKey = normalizeOptionalString(provisionedProvider?.apiKey);
    if (!provisionedProvider || !apiKey) {
        throw new DraftGenerationError(
            'DRAFT_GENERATION_PROVIDER_NOT_PROVISIONED',
            `Draft generation provider "${providerType}" is not configured for the active tenant.`,
            503,
        );
    }

    return {
        ...provisionedProvider,
        apiKey,
    } as Extract<DraftGenerationProviderProvisioning, { type: TProviderType }>;
}

function resolveExplicitProviderModel(
    provider: Extract<DraftGenerationProviderConfig, { type: 'anthropic' | 'gemini' }>,
    provisioning: Extract<DraftGenerationProviderProvisioning, { type: 'anthropic' | 'gemini' }>,
): string {
    const model = normalizeOptionalString(provider.model)
        ?? normalizeOptionalString(provisioning.defaultModel);
    if (!model) {
        throw new DraftGenerationError(
            'DRAFT_GENERATION_PROVIDER_MODEL_REQUIRED',
            `Draft generation provider "${provider.type}" requires an explicit model on the workforce agent/form provider config or the tenant provider provisioning record.`,
            409,
        );
    }

    return model;
}

async function generateDraftDataWithOpenAI(
    input: DraftGenerationInput,
    deterministicBaseline: Record<string, unknown>,
    semanticContext: DraftGenerationSemanticContext | null,
): Promise<DraftGenerationResult> {
    const provisionedOpenAi = requireProvisionedProvider(input, 'openai');
    const apiKey = provisionedOpenAi.apiKey;

    const model = normalizeOptionalString(input.provider.type === 'openai' ? input.provider.model : null)
        ?? normalizeOptionalString(provisionedOpenAi?.defaultModel)
        ?? process.env.OPENAI_DRAFT_GENERATION_MODEL
        ?? 'gpt-4o';
    const sanitizedSchema = parseSanitizedTargetSchema(input.targetContentType.schema);
    const openAiSchema = transformSchemaForOpenAiStructuredOutputs(sanitizedSchema);
    if (!isObject(openAiSchema)) {
        throw new DraftGenerationError(
            'DRAFT_GENERATION_TARGET_SCHEMA_INVALID',
            'Target content type schema must remain a JSON object after OpenAI schema translation.',
            409,
        );
    }

    const openai = new OpenAI({ apiKey });
    const response = await openai.responses.create({
        model,
        store: false,
        instructions: buildOpenAiInstructions(input, semanticContext),
        input: [{
            role: 'user',
            content: buildOpenAiInputContent(input, deterministicBaseline, semanticContext),
        }],
        text: {
            format: {
                type: 'json_schema',
                name: sanitizeSchemaName(`${input.targetContentType.slug}_draft_output`),
                strict: true,
                schema: openAiSchema,
            },
        },
    });

    const generatedData = await parseJsonTextResult(
        response.output_text ?? null,
        'DRAFT_GENERATION_OPENAI_EMPTY_OUTPUT',
        'OpenAI draft generation returned no output text.',
        'DRAFT_GENERATION_OPENAI_INVALID_OUTPUT',
        'OpenAI draft generation returned invalid JSON',
    );
    const normalizedGeneratedData = pruneNullOptionalFields(generatedData, sanitizedSchema);

    return {
        data: mergeProviderGeneratedData(
            (isObject(normalizedGeneratedData) ? normalizedGeneratedData : generatedData),
            deterministicBaseline,
        ),
        strategy: 'openai_structured_outputs_v1',
        provider: {
            type: 'openai',
            model,
            responseId: response.id ?? null,
        },
    };
}

async function generateDraftDataWithAnthropic(
    input: DraftGenerationInput,
    deterministicBaseline: Record<string, unknown>,
    semanticContext: DraftGenerationSemanticContext | null,
): Promise<DraftGenerationResult> {
    if (input.provider.type !== 'anthropic') {
        throw new DraftGenerationError(
            'DRAFT_GENERATION_PROVIDER_MISMATCH',
            'Anthropic generation called with a non-Anthropic provider config.',
            500,
        );
    }

    const provisionedAnthropic = requireProvisionedProvider(input, 'anthropic');
    const model = resolveExplicitProviderModel(input.provider, provisionedAnthropic);
    const sanitizedSchema = parseSanitizedTargetSchema(input.targetContentType.schema);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': provisionedAnthropic.apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model,
            max_tokens: 4096,
            system: buildOpenAiInstructions(input, semanticContext),
            messages: [{
                role: 'user',
                content: buildAnthropicInputContent(input, deterministicBaseline, semanticContext),
            }],
            tools: [{
                name: 'submit_draft',
                description: 'Return the final governed draft as a JSON object that matches the target schema exactly.',
                input_schema: sanitizedSchema,
            }],
            tool_choice: {
                type: 'tool',
                name: 'submit_draft',
            },
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new DraftGenerationError(
            'DRAFT_GENERATION_ANTHROPIC_REQUEST_FAILED',
            `Anthropic draft generation failed with ${response.status}${text ? `: ${text.slice(0, 240)}` : ''}`,
            502,
        );
    }

    const payload = await response.json().catch(() => null) as {
        id?: string;
        content?: Array<{ type?: string; name?: string; input?: unknown }>;
    } | null;
    const toolUse = payload?.content?.find((entry) => entry?.type === 'tool_use' && entry?.name === 'submit_draft');
    if (!toolUse || !isObject(toolUse.input)) {
        throw new DraftGenerationError(
            'DRAFT_GENERATION_ANTHROPIC_INVALID_OUTPUT',
            'Anthropic draft generation did not return the expected structured tool output.',
            502,
        );
    }

    return {
        data: mergeProviderGeneratedData(toolUse.input, deterministicBaseline),
        strategy: 'anthropic_tool_schema_v1',
        provider: {
            type: 'anthropic',
            model,
            responseId: normalizeOptionalString(payload?.id) ?? null,
        },
    };
}

async function generateDraftDataWithGemini(
    input: DraftGenerationInput,
    deterministicBaseline: Record<string, unknown>,
    semanticContext: DraftGenerationSemanticContext | null,
): Promise<DraftGenerationResult> {
    if (input.provider.type !== 'gemini') {
        throw new DraftGenerationError(
            'DRAFT_GENERATION_PROVIDER_MISMATCH',
            'Gemini generation called with a non-Gemini provider config.',
            500,
        );
    }

    const provisionedGemini = requireProvisionedProvider(input, 'gemini');
    const model = resolveExplicitProviderModel(input.provider, provisionedGemini);
    const sanitizedSchema = parseSanitizedTargetSchema(input.targetContentType.schema);

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-goog-api-key': provisionedGemini.apiKey,
            },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: buildGeminiParts(input, deterministicBaseline, semanticContext),
                }],
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseJsonSchema: sanitizedSchema,
                },
            }),
        },
    );

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new DraftGenerationError(
            'DRAFT_GENERATION_GEMINI_REQUEST_FAILED',
            `Gemini draft generation failed with ${response.status}${text ? `: ${text.slice(0, 240)}` : ''}`,
            502,
        );
    }

    const payload = await response.json().catch(() => null) as {
        candidates?: Array<{
            content?: {
                parts?: Array<{ text?: string }>;
            };
        }>;
        responseId?: string;
    } | null;
    const outputText = payload?.candidates?.[0]?.content?.parts
        ?.map((part) => normalizeOptionalString(part?.text))
        .filter((entry): entry is string => Boolean(entry))
        .join('\n') ?? null;
    const generatedData = await parseJsonTextResult(
        outputText,
        'DRAFT_GENERATION_GEMINI_EMPTY_OUTPUT',
        'Gemini draft generation returned no output text.',
        'DRAFT_GENERATION_GEMINI_INVALID_OUTPUT',
        'Gemini draft generation returned invalid JSON',
    );

    return {
        data: mergeProviderGeneratedData(generatedData, deterministicBaseline),
        strategy: 'gemini_structured_outputs_v1',
        provider: {
            type: 'gemini',
            model,
            responseId: normalizeOptionalString(payload?.responseId) ?? null,
        },
    };
}

export async function generateDraftData(input: DraftGenerationInput): Promise<DraftGenerationResult> {
    const deterministicBaseline = buildDeterministicBaselineData(input);
    const semanticContext = await resolveWorkforceSemanticContext(input);

    if (input.provider.type === 'openai') {
        return generateDraftDataWithOpenAI(input, deterministicBaseline, semanticContext);
    }

    if (input.provider.type === 'anthropic') {
        return generateDraftDataWithAnthropic(input, deterministicBaseline, semanticContext);
    }

    if (input.provider.type === 'gemini') {
        return generateDraftDataWithGemini(input, deterministicBaseline, semanticContext);
    }

    return {
        data: deterministicBaseline,
        strategy: 'schema_overlap_defaults_v1',
        provider: {
            type: 'deterministic',
            model: null,
            responseId: null,
        },
    };
}
