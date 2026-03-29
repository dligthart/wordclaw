import fs from 'node:fs/promises';
import path from 'node:path';

type JsonObject = Record<string, unknown>;
type LocalizationConfig = {
    supportedLocales: string[];
    defaultLocale: string;
};

export type ArtifactContentType = {
    id: number;
    name: string;
    slug: string;
    kind: 'collection' | 'singleton';
    description?: string | null;
    schema: string;
};

export type ArtifactCapabilitySnapshot = {
    contentRuntime?: {
        globals?: unknown;
        workingCopyPreview?: unknown;
        localization?: unknown;
        reverseReferences?: unknown;
    };
};

export type GeneratedSchemaArtifact = {
    filename: string;
    content: string;
};

type ModelDescriptor = {
    id: number;
    name: string;
    slug: string;
    kind: 'collection' | 'singleton';
    description: string | null;
    schemaObject: JsonObject;
    localization: LocalizationConfig | null;
    baseName: string;
    interfaceName: string;
    schemaConstName: string;
    parseFunctionName: string;
    globalHelperName: string | null;
};

const LOCALIZED_FIELD_KEY = 'x-wordclaw-localized';
const LOCALIZATION_CONFIG_KEY = 'x-wordclaw-localization';
const SUPPORTED_CAPABILITY_KEYS = [
    'globals',
    'workingCopyPreview',
    'localization',
    'reverseReferences'
] as const;

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIdentifier(value: string) {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

function toPascalCase(value: string) {
    const normalized = value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[^A-Za-z0-9]+/g, ' ')
        .trim();

    const candidate = normalized
        .split(/\s+/)
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
        .join('');

    return candidate.length > 0 ? candidate : 'ContentModel';
}

function quoteKey(value: string) {
    return isIdentifier(value) ? value : JSON.stringify(value);
}

function indent(text: string, level = 1): string {
    const prefix = '    '.repeat(level);
    return text
        .split('\n')
        .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
        .join('\n');
}

function renderLiteral(value: unknown): string {
    return JSON.stringify(value);
}

function parseSchemaText(schemaText: string): JsonObject {
    const parsed = JSON.parse(schemaText);
    return isObject(parsed) ? parsed : {};
}

function extractLocalizationConfig(schemaObject: JsonObject): LocalizationConfig | null {
    const raw = schemaObject[LOCALIZATION_CONFIG_KEY];
    if (!isObject(raw)) {
        return null;
    }

    const supportedLocales = Array.isArray(raw.supportedLocales)
        ? raw.supportedLocales.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [];
    const defaultLocale = typeof raw.defaultLocale === 'string' && raw.defaultLocale.trim().length > 0
        ? raw.defaultLocale.trim()
        : '';

    if (supportedLocales.length === 0 || defaultLocale.length === 0) {
        return null;
    }

    return {
        supportedLocales,
        defaultLocale
    };
}

function stripLocalizedFieldFlag(schemaObject: JsonObject): JsonObject {
    const next = { ...schemaObject };
    delete next[LOCALIZED_FIELD_KEY];
    return next;
}

function renderTsPrimitiveType(typeName: string) {
    if (typeName === 'integer' || typeName === 'number') {
        return 'number';
    }
    if (typeName === 'string') {
        return 'string';
    }
    if (typeName === 'boolean') {
        return 'boolean';
    }
    if (typeName === 'null') {
        return 'null';
    }
    return 'unknown';
}

function renderTsType(schema: unknown, level = 0): string {
    if (!isObject(schema)) {
        return 'unknown';
    }

    if (schema[LOCALIZED_FIELD_KEY] === true) {
        return `LocalizedField<${renderTsType(stripLocalizedFieldFlag(schema), level)}>`;
    }

    if (schema.const !== undefined) {
        return renderLiteral(schema.const);
    }

    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        return schema.enum.map((value) => renderLiteral(value)).join(' | ');
    }

    const composite = Array.isArray(schema.oneOf)
        ? schema.oneOf
        : Array.isArray(schema.anyOf)
            ? schema.anyOf
            : null;
    if (composite && composite.length > 0) {
        return composite.map((entry) => renderTsType(entry, level)).join(' | ');
    }

    if (Array.isArray(schema.type) && schema.type.length > 0) {
        return schema.type.map((value) => renderTsPrimitiveType(String(value))).join(' | ');
    }

    if (schema.type === 'array' || schema.items !== undefined) {
        return `Array<${renderTsType(schema.items, level + 1)}>`;
    }

    if (schema.type === 'object' || isObject(schema.properties)) {
        const properties = isObject(schema.properties)
            ? Object.entries(schema.properties)
            : [];

        if (properties.length === 0) {
            return schema.additionalProperties === false ? 'Record<string, never>' : 'Record<string, unknown>';
        }

        const required = new Set(
            Array.isArray(schema.required)
                ? schema.required.filter((value): value is string => typeof value === 'string')
                : []
        );
        const lines = properties.map(([key, childSchema]) => {
            const optional = required.has(key) ? '' : '?';
            return `${quoteKey(key)}${optional}: ${renderTsType(childSchema, level + 1)};`;
        });
        return `{\n${indent(lines.join('\n'), level + 1)}\n${'    '.repeat(level)}}`;
    }

    if (typeof schema.type === 'string') {
        return renderTsPrimitiveType(schema.type);
    }

    return 'unknown';
}

function renderZodEnum(schema: JsonObject): string {
    const values = schema.enum as unknown[];
    if (values.every((value) => typeof value === 'string')) {
        return `z.enum([${values.map((value) => renderLiteral(value)).join(', ')}])`;
    }

    if (values.length === 1) {
        return `z.literal(${renderLiteral(values[0])})`;
    }

    return `z.union([${values.map((value) => `z.literal(${renderLiteral(value)})`).join(', ')}])`;
}

function renderZodType(schema: unknown): string {
    if (!isObject(schema)) {
        return 'z.unknown()';
    }

    if (schema[LOCALIZED_FIELD_KEY] === true) {
        return `localizedField(${renderZodType(stripLocalizedFieldFlag(schema))})`;
    }

    if (schema.const !== undefined) {
        return `z.literal(${renderLiteral(schema.const)})`;
    }

    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
        return renderZodEnum(schema);
    }

    const composite = Array.isArray(schema.oneOf)
        ? schema.oneOf
        : Array.isArray(schema.anyOf)
            ? schema.anyOf
            : null;
    if (composite && composite.length > 0) {
        if (composite.length === 1) {
            return renderZodType(composite[0]);
        }
        return `z.union([${composite.map((entry) => renderZodType(entry)).join(', ')}])`;
    }

    if (Array.isArray(schema.type) && schema.type.length > 0) {
        const rendered = schema.type.map((value) => renderZodType({ ...schema, type: value }));
        return rendered.length === 1 ? rendered[0] : `z.union([${rendered.join(', ')}])`;
    }

    if (schema.type === 'array' || schema.items !== undefined) {
        let expression = `z.array(${renderZodType(schema.items)})`;
        if (typeof schema.minItems === 'number') {
            expression += `.min(${schema.minItems})`;
        }
        if (typeof schema.maxItems === 'number') {
            expression += `.max(${schema.maxItems})`;
        }
        return expression;
    }

    if (schema.type === 'object' || isObject(schema.properties)) {
        const properties = isObject(schema.properties)
            ? Object.entries(schema.properties)
            : [];
        const required = new Set(
            Array.isArray(schema.required)
                ? schema.required.filter((value): value is string => typeof value === 'string')
                : []
        );

        const shape = properties.length === 0
            ? '{}'
            : `{\n${indent(properties.map(([key, childSchema]) => {
                const optional = required.has(key) ? '' : '.optional()';
                return `${quoteKey(key)}: ${renderZodType(childSchema)}${optional},`;
            }).join('\n'))}\n}`;

        let expression = `z.object(${shape})`;
        if (schema.additionalProperties === false) {
            expression += '.strict()';
        }
        return expression;
    }

    if (schema.type === 'string') {
        let expression = 'z.string()';
        if (typeof schema.minLength === 'number') {
            expression += `.min(${schema.minLength})`;
        }
        if (typeof schema.maxLength === 'number') {
            expression += `.max(${schema.maxLength})`;
        }
        return expression;
    }

    if (schema.type === 'integer') {
        let expression = 'z.number().int()';
        if (typeof schema.minimum === 'number') {
            expression += `.min(${schema.minimum})`;
        }
        if (typeof schema.maximum === 'number') {
            expression += `.max(${schema.maximum})`;
        }
        return expression;
    }

    if (schema.type === 'number') {
        let expression = 'z.number()';
        if (typeof schema.minimum === 'number') {
            expression += `.min(${schema.minimum})`;
        }
        if (typeof schema.maximum === 'number') {
            expression += `.max(${schema.maximum})`;
        }
        return expression;
    }

    if (schema.type === 'boolean') {
        return 'z.boolean()';
    }

    if (schema.type === 'null') {
        return 'z.null()';
    }

    return 'z.unknown()';
}

function buildModelDescriptors(contentTypes: ArtifactContentType[]): ModelDescriptor[] {
    const usedNames = new Set<string>();

    return contentTypes.map((contentType) => {
        const parsedSchema = parseSchemaText(contentType.schema);
        const preferredBase = toPascalCase(contentType.name || contentType.slug);
        let baseName = preferredBase;
        if (usedNames.has(baseName)) {
            baseName = `${preferredBase}${contentType.id}`;
        }
        usedNames.add(baseName);

        return {
            id: contentType.id,
            name: contentType.name,
            slug: contentType.slug,
            kind: contentType.kind === 'singleton' ? 'singleton' : 'collection',
            description: contentType.description ?? null,
            schemaObject: parsedSchema,
            localization: extractLocalizationConfig(parsedSchema),
            baseName,
            interfaceName: `${baseName}Data`,
            schemaConstName: `${baseName}DataSchema`,
            parseFunctionName: `parse${baseName}Data`,
            globalHelperName: contentType.kind === 'singleton' ? `get${baseName}Global` : null
        };
    });
}

function extractCapabilitySubset(snapshot: ArtifactCapabilitySnapshot): JsonObject {
    const contentRuntime = isObject(snapshot.contentRuntime) ? snapshot.contentRuntime : {};
    const subset: JsonObject = {};

    for (const key of SUPPORTED_CAPABILITY_KEYS) {
        const value = contentRuntime[key];
        if (value !== undefined) {
            subset[key] = value;
        }
    }

    return {
        contentRuntime: subset
    };
}

function renderRuntimeFile(
    descriptors: ModelDescriptor[],
    capabilitySnapshot: ArtifactCapabilitySnapshot,
    packageName: string
) {
    const models = Object.fromEntries(descriptors.map((descriptor) => [descriptor.slug, {
        id: descriptor.id,
        name: descriptor.name,
        slug: descriptor.slug,
        kind: descriptor.kind,
        description: descriptor.description,
        localization: descriptor.localization
    }]));
    const globals = descriptors
        .filter((descriptor) => descriptor.kind === 'singleton')
        .map((descriptor) => descriptor.slug);

    return `export const packageName = ${renderLiteral(packageName)} as const;
export const generatedAt = ${renderLiteral(new Date().toISOString())} as const;
export const capabilitySnapshot = ${JSON.stringify(extractCapabilitySubset(capabilitySnapshot), null, 2)} as const;
export const contentModels = ${JSON.stringify(models, null, 2)} as const;
export const contentTypeIdsBySlug = ${JSON.stringify(
        Object.fromEntries(descriptors.map((descriptor) => [descriptor.slug, descriptor.id])),
        null,
        2
    )} as const;
export const globalSlugs = ${JSON.stringify(globals, null, 2)} as const;
`;
}

function renderTypesFile(descriptors: ModelDescriptor[]) {
    const contentMapEntries = descriptors.map((descriptor) => `${renderLiteral(descriptor.slug)}: ${descriptor.interfaceName};`);
    const globalDescriptors = descriptors.filter((descriptor) => descriptor.kind === 'singleton');
    const globalMapEntries = globalDescriptors.map((descriptor) => `${renderLiteral(descriptor.slug)}: ${descriptor.interfaceName};`);
    const anyGlobalRecord = globalDescriptors.length > 0
        ? `{ [K in GlobalSlug]: WordClawGlobalRecord<GlobalModelsBySlug[K], Extract<K, string>> }[GlobalSlug]`
        : 'never';

    return `export type ContentTypeKind = 'collection' | 'singleton';
export type PublicationState = 'draft' | 'published' | 'changed';
export type LocalizedField<T> = Record<string, T>;

export type ContentLocaleResolution = {
    requestedLocale: string;
    fallbackLocale: string;
    defaultLocale: string;
    localizedFieldCount: number;
    resolvedFieldCount: number;
    fallbackFieldCount: number;
    unresolvedFields: string[];
};

export type WordClawContentTypeMeta<TKind extends ContentTypeKind = ContentTypeKind, TSlug extends string = string> = {
    id: number;
    name: string;
    slug: TSlug;
    kind: TKind;
    description?: string | null;
};

export type WordClawContentItem<TData> = {
    id: number;
    contentTypeId: number;
    data: TData;
    status: string;
    version: number;
    createdAt: string;
    updatedAt: string;
    publicationState: PublicationState;
    workingCopyVersion: number;
    publishedVersion: number | null;
    localeResolution?: ContentLocaleResolution;
};

export type WordClawGlobalRecord<TData, TSlug extends string = string> = {
    contentType: WordClawContentTypeMeta<'singleton', TSlug>;
    item: WordClawContentItem<TData> | null;
};

export type ReferenceUsage = {
    contentItemId: number;
    contentTypeId: number;
    contentTypeName: string;
    contentTypeSlug: string;
    path: string;
    version: number;
    status?: string;
    contentItemVersionId?: number;
};

export type ReferenceUsageSummary = {
    activeReferenceCount: number;
    historicalReferenceCount: number;
    activeReferences: ReferenceUsage[];
    historicalReferences: ReferenceUsage[];
};

${descriptors.map((descriptor) => `export interface ${descriptor.interfaceName} ${renderTsType(descriptor.schemaObject)}\n`).join('\n')}
export type ContentModelsBySlug = {
${indent(contentMapEntries.join('\n'))}
};

export type GlobalModelsBySlug = {
${indent(globalMapEntries.join('\n'))}
};

export type ContentTypeSlug = keyof ContentModelsBySlug;
export type GlobalSlug = keyof GlobalModelsBySlug;
export type AnyGlobalRecord = ${anyGlobalRecord};
`;
}

function renderValidatorsFile(descriptors: ModelDescriptor[]) {
    const schemaMapEntries = descriptors.map((descriptor) => `${renderLiteral(descriptor.slug)}: ${descriptor.schemaConstName},`);
    const globalSchemaMapEntries = descriptors
        .filter((descriptor) => descriptor.kind === 'singleton')
        .map((descriptor) => `${renderLiteral(descriptor.slug)}: ${descriptor.schemaConstName},`);

    return `import { z } from 'zod';

export const localizedField = <T extends z.ZodTypeAny>(valueSchema: T) => z.record(z.string(), valueSchema);

export function parseJsonValue(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value;
    }

    return JSON.parse(value);
}

export function parseWithSchema<TSchema extends z.ZodTypeAny>(schema: TSchema, value: unknown): z.infer<TSchema> {
    return schema.parse(parseJsonValue(value));
}

${descriptors.map((descriptor) => `export const ${descriptor.schemaConstName} = ${renderZodType(descriptor.schemaObject)};
export const ${descriptor.parseFunctionName} = (value: unknown) => parseWithSchema(${descriptor.schemaConstName}, value);
`).join('\n')}
export const contentSchemasBySlug = {
${indent(schemaMapEntries.join('\n'))}
} as const;

export const globalSchemasBySlug = {
${indent(globalSchemaMapEntries.join('\n'))}
} as const;
`;
}

function renderClientFile(descriptors: ModelDescriptor[]) {
    const singletonHelpers = descriptors
        .filter((descriptor) => descriptor.globalHelperName)
        .map((descriptor) => `    async ${descriptor.globalHelperName}(
        options: LocalizedReadOptions = {}
    ): Promise<RestEnvelope<WordClawGlobalRecord<GlobalModelsBySlug[${renderLiteral(descriptor.slug)}], ${renderLiteral(descriptor.slug)}>>> {
        return this.getGlobal(${renderLiteral(descriptor.slug)}, options);
    }
`);
    const mcpSingletonHelpers = descriptors
        .filter((descriptor) => descriptor.globalHelperName)
        .map((descriptor) => `        ${descriptor.globalHelperName}: (options: LocalizedReadOptions = {}) =>
            helpers.getGlobal(${renderLiteral(descriptor.slug)}, options),`);

    return `import { contentTypeIdsBySlug } from './runtime';
import type {
    AnyGlobalRecord,
    ContentModelsBySlug,
    ContentTypeSlug,
    GlobalModelsBySlug,
    GlobalSlug,
    ReferenceUsageSummary,
    WordClawContentItem,
    WordClawGlobalRecord
} from './types';
import { contentSchemasBySlug, globalSchemasBySlug, parseWithSchema } from './validators';

export type LocalizedReadOptions = {
    draft?: boolean;
    locale?: string;
    fallbackLocale?: string;
};

export type ListContentItemsOptions = LocalizedReadOptions & {
    status?: string;
    q?: string;
    limit?: number;
    offset?: number;
    cursor?: string;
    includeArchived?: boolean;
};

export type RestEnvelope<T> = {
    data: T;
    meta?: Record<string, unknown>;
};

export type RawContentItem = WordClawContentItem<string>;
export type RawGlobalRecord = {
    contentType: {
        id: number;
        name: string;
        slug: string;
        kind: 'singleton';
        description?: string | null;
    };
    item: RawContentItem | null;
};

function normalizeBaseUrl(rawBaseUrl: string): string {
    const withoutTrailingSlash = rawBaseUrl.replace(/\\/+$/, '');
    return withoutTrailingSlash.endsWith('/api')
        ? withoutTrailingSlash
        : \`\${withoutTrailingSlash}/api\`;
}

function resolveApiUrl(
    rawBaseUrl: string,
    path: string,
    query: Record<string, string | number | boolean | undefined> = {}
): string {
    const baseUrl = normalizeBaseUrl(rawBaseUrl);
    const normalizedPath = path.startsWith('/api/')
        ? path.slice('/api'.length)
        : path.startsWith('/')
            ? path
            : \`/\${path}\`;
    const url = new URL(\`\${baseUrl}\${normalizedPath}\`);

    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
            url.searchParams.set(key, String(value));
        }
    }

    return url.toString();
}

function parseContentItemRecord<TSlug extends ContentTypeSlug>(
    slug: TSlug,
    item: RawContentItem
): WordClawContentItem<ContentModelsBySlug[TSlug]> {
    return {
        ...item,
        data: parseWithSchema(contentSchemasBySlug[slug], item.data) as ContentModelsBySlug[TSlug]
    };
}

function parseGlobalRecord<TSlug extends GlobalSlug>(
    slug: TSlug,
    record: RawGlobalRecord
): WordClawGlobalRecord<GlobalModelsBySlug[TSlug], Extract<TSlug, string>> {
    return {
        contentType: record.contentType as WordClawGlobalRecord<GlobalModelsBySlug[TSlug], Extract<TSlug, string>>['contentType'],
        item: record.item
            ? {
                ...record.item,
                data: parseWithSchema(globalSchemasBySlug[slug], record.item.data) as GlobalModelsBySlug[TSlug]
            }
            : null
    };
}

export type WordClawRestClientConfig = {
    baseUrl: string;
    apiKey?: string;
    fetchImpl?: typeof fetch;
};

export class WordClawRestClient {
    private readonly baseUrl: string;
    private readonly apiKey?: string;
    private readonly fetchImpl: typeof fetch;

    constructor(config: WordClawRestClientConfig) {
        this.baseUrl = config.baseUrl;
        this.apiKey = config.apiKey;
        this.fetchImpl = config.fetchImpl ?? fetch;
    }

    private async request<T>(
        method: string,
        path: string,
        query: Record<string, string | number | boolean | undefined> = {}
    ): Promise<RestEnvelope<T>> {
        const headers: Record<string, string> = {
            accept: 'application/json'
        };
        if (this.apiKey) {
            headers['x-api-key'] = this.apiKey;
        }

        const response = await this.fetchImpl(resolveApiUrl(this.baseUrl, path, query), {
            method,
            headers
        });
        if (!response.ok) {
            throw new Error(\`Request failed (\${response.status}): \${await response.text()}\`);
        }

        return response.json() as Promise<RestEnvelope<T>>;
    }

    async getGlobal<TSlug extends GlobalSlug>(
        slug: TSlug,
        options: LocalizedReadOptions = {}
    ): Promise<RestEnvelope<WordClawGlobalRecord<GlobalModelsBySlug[TSlug], Extract<TSlug, string>>>> {
        const response = await this.request<RawGlobalRecord>('GET', \`/globals/\${slug}\`, options);
        return {
            ...response,
            data: parseGlobalRecord(slug, response.data)
        };
    }

${singletonHelpers.join('\n')}
    async listGlobals(
        options: LocalizedReadOptions = {}
    ): Promise<RestEnvelope<AnyGlobalRecord[]>> {
        const response = await this.request<RawGlobalRecord[]>('GET', '/globals', options);
        return {
            ...response,
            data: response.data.map((entry) => parseGlobalRecord(entry.contentType.slug as GlobalSlug, entry)) as AnyGlobalRecord[]
        };
    }

    async getContentItem<TSlug extends ContentTypeSlug>(
        slug: TSlug,
        id: number,
        options: LocalizedReadOptions = {}
    ): Promise<RestEnvelope<WordClawContentItem<ContentModelsBySlug[TSlug]>>> {
        const response = await this.request<RawContentItem>('GET', \`/content-items/\${id}\`, options);
        return {
            ...response,
            data: parseContentItemRecord(slug, response.data)
        };
    }

    async listContentItems<TSlug extends ContentTypeSlug>(
        slug: TSlug,
        options: ListContentItemsOptions = {}
    ): Promise<RestEnvelope<Array<WordClawContentItem<ContentModelsBySlug[TSlug]>>>> {
        const response = await this.request<RawContentItem[]>('GET', '/content-items', {
            ...options,
            contentTypeId: contentTypeIdsBySlug[slug]
        });
        return {
            ...response,
            data: response.data.map((item) => parseContentItemRecord(slug, item))
        };
    }

    async getContentItemUsage(id: number): Promise<RestEnvelope<ReferenceUsageSummary>> {
        return this.request<ReferenceUsageSummary>('GET', \`/content-items/\${id}/used-by\`);
    }

    async getAssetUsage(id: number): Promise<RestEnvelope<ReferenceUsageSummary>> {
        return this.request<ReferenceUsageSummary>('GET', \`/assets/\${id}/used-by\`);
    }
}

export type McpToolCaller = <T = unknown>(tool: string, args?: Record<string, unknown>) => Promise<T>;

export function createWordClawMcpHelpers(callTool: McpToolCaller) {
    const helpers = {
        getGlobal: async <TSlug extends GlobalSlug>(
            slug: TSlug,
            options: LocalizedReadOptions = {}
        ) => parseGlobalRecord(
            slug,
            await callTool<RawGlobalRecord>('get_global', { slug, ...options })
        ),
        listGlobals: async (options: LocalizedReadOptions = {}) => {
            const rows = await callTool<RawGlobalRecord[]>('list_globals', options);
            return rows.map((entry) => parseGlobalRecord(entry.contentType.slug as GlobalSlug, entry)) as AnyGlobalRecord[];
        },
        getContentItem: async <TSlug extends ContentTypeSlug>(
            slug: TSlug,
            id: number,
            options: LocalizedReadOptions = {}
        ) => parseContentItemRecord(
            slug,
            await callTool<RawContentItem>('get_content_item', { id, ...options })
        ),
        listContentItems: async <TSlug extends ContentTypeSlug>(
            slug: TSlug,
            options: ListContentItemsOptions = {}
        ) => {
            const response = await callTool<{ items: RawContentItem[]; [key: string]: unknown }>('get_content_items', {
                ...options,
                contentTypeId: contentTypeIdsBySlug[slug]
            });
            return {
                ...response,
                items: response.items.map((item) => parseContentItemRecord(slug, item))
            };
        },
        getContentItemUsage: (id: number) =>
            callTool<{ item: unknown; usage: ReferenceUsageSummary }>('get_content_item_usage', { id }),
        getAssetUsage: (id: number) =>
            callTool<{ asset: unknown; usage: ReferenceUsageSummary }>('get_asset_usage', { id })
    };

    return {
        ...helpers,
${indent(mcpSingletonHelpers.join('\n'), 2)}
    };
}
`;
}

function renderIndexFile() {
    return `export * from './runtime';
export * from './types';
export * from './validators';
export * from './client';
`;
}

export function generateSchemaArtifacts(input: {
    contentTypes: ArtifactContentType[];
    capabilitySnapshot: ArtifactCapabilitySnapshot;
    packageName?: string;
}): GeneratedSchemaArtifact[] {
    const packageName = input.packageName?.trim() || 'wordclaw-generated';
    const descriptors = buildModelDescriptors(
        [...input.contentTypes].sort((left, right) => left.slug.localeCompare(right.slug))
    );

    return [
        {
            filename: 'runtime.ts',
            content: renderRuntimeFile(descriptors, input.capabilitySnapshot, packageName)
        },
        {
            filename: 'types.ts',
            content: renderTypesFile(descriptors)
        },
        {
            filename: 'validators.ts',
            content: renderValidatorsFile(descriptors)
        },
        {
            filename: 'client.ts',
            content: renderClientFile(descriptors)
        },
        {
            filename: 'index.ts',
            content: renderIndexFile()
        }
    ];
}

export async function writeSchemaArtifacts(
    outputDir: string,
    artifacts: GeneratedSchemaArtifact[]
): Promise<string[]> {
    const absoluteOutputDir = path.resolve(outputDir);
    await fs.mkdir(absoluteOutputDir, { recursive: true });

    const writtenFiles: string[] = [];
    for (const artifact of artifacts) {
        const filePath = path.join(absoluteOutputDir, artifact.filename);
        await fs.writeFile(filePath, artifact.content, 'utf8');
        writtenFiles.push(filePath);
    }

    return writtenFiles;
}
