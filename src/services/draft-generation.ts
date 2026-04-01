import OpenAI from 'openai';

type JsonObject = Record<string, unknown>;
type JsonArray = unknown[];

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

function buildOpenAiInstructions(input: DraftGenerationInput): string {
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
        'Preserve baseline values unless the schema requires adding other compatible fields around them.',
    ];

    const extraInstructions = getProviderInstructions(input);

    if (extraInstructions) {
        baseInstructions.push(`Additional operator instructions: ${extraInstructions}`);
    }

    return baseInstructions.join('\n');
}

function buildOpenAiInputText(input: DraftGenerationInput, deterministicBaseline: Record<string, unknown>): string {
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
        '',
        'Explicit field mapping:',
        JSON.stringify(input.fieldMap, null, 2),
        '',
        'Referenced image attachments:',
        buildAttachmentManifestText(input.attachments ?? []),
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

function buildUnifiedPromptText(input: DraftGenerationInput, deterministicBaseline: Record<string, unknown>): string {
    return [
        buildOpenAiInstructions(input),
        '',
        buildOpenAiInputText(input, deterministicBaseline),
    ].join('\n');
}

function buildOpenAiInputContent(input: DraftGenerationInput, deterministicBaseline: Record<string, unknown>) {
    const content: Array<
        { type: 'input_text'; text: string }
        | { type: 'input_image'; image_url: string; detail: 'auto' }
    > = [{
        type: 'input_text',
        text: buildOpenAiInputText(input, deterministicBaseline),
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

function buildAnthropicInputContent(input: DraftGenerationInput, deterministicBaseline: Record<string, unknown>) {
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
        text: buildOpenAiInputText(input, deterministicBaseline),
    });

    return content;
}

function buildGeminiParts(input: DraftGenerationInput, deterministicBaseline: Record<string, unknown>) {
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
        text: buildUnifiedPromptText(input, deterministicBaseline),
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
): Promise<DraftGenerationResult> {
    const provisionedOpenAi = requireProvisionedProvider(input, 'openai');
    const apiKey = provisionedOpenAi.apiKey;

    const model = normalizeOptionalString(input.provider.type === 'openai' ? input.provider.model : null)
        ?? normalizeOptionalString(provisionedOpenAi?.defaultModel)
        ?? process.env.OPENAI_DRAFT_GENERATION_MODEL
        ?? 'gpt-4o';
    const sanitizedSchema = stripCustomSchemaExtensions(parseSchemaObject(input.targetContentType.schema));
    if (!isObject(sanitizedSchema)) {
        throw new DraftGenerationError(
            'DRAFT_GENERATION_TARGET_SCHEMA_INVALID',
            'Target content type schema must remain a JSON object after sanitization.',
            409,
        );
    }

    const openai = new OpenAI({ apiKey });
    const response = await openai.responses.create({
        model,
        store: false,
        instructions: buildOpenAiInstructions(input),
        input: [{
            role: 'user',
            content: buildOpenAiInputContent(input, deterministicBaseline),
        }],
        text: {
            format: {
                type: 'json_schema',
                name: sanitizeSchemaName(`${input.targetContentType.slug}_draft_output`),
                strict: true,
                schema: sanitizedSchema,
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

    return {
        data: {
            ...generatedData,
            ...deterministicBaseline,
        },
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
    const sanitizedSchema = stripCustomSchemaExtensions(parseSchemaObject(input.targetContentType.schema));
    if (!isObject(sanitizedSchema)) {
        throw new DraftGenerationError(
            'DRAFT_GENERATION_TARGET_SCHEMA_INVALID',
            'Target content type schema must remain a JSON object after sanitization.',
            409,
        );
    }

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
            system: buildOpenAiInstructions(input),
            messages: [{
                role: 'user',
                content: buildAnthropicInputContent(input, deterministicBaseline),
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
        data: {
            ...toolUse.input,
            ...deterministicBaseline,
        },
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
    const sanitizedSchema = stripCustomSchemaExtensions(parseSchemaObject(input.targetContentType.schema));
    if (!isObject(sanitizedSchema)) {
        throw new DraftGenerationError(
            'DRAFT_GENERATION_TARGET_SCHEMA_INVALID',
            'Target content type schema must remain a JSON object after sanitization.',
            409,
        );
    }

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
                    parts: buildGeminiParts(input, deterministicBaseline),
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
        data: {
            ...generatedData,
            ...deterministicBaseline,
        },
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

    if (input.provider.type === 'openai') {
        return generateDraftDataWithOpenAI(input, deterministicBaseline);
    }

    if (input.provider.type === 'anthropic') {
        return generateDraftDataWithAnthropic(input, deterministicBaseline);
    }

    if (input.provider.type === 'gemini') {
        return generateDraftDataWithGemini(input, deterministicBaseline);
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
