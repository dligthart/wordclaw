import Ajv, { AnySchema, ErrorObject } from 'ajv';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db/index.js';
import { assets, contentItems, contentTypes } from '../db/schema.js';

export type ValidationFailure = {
    error: string;
    code: string;
    remediation: string;
    context?: Record<string, unknown>;
};

const ajv = new Ajv({
    allErrors: true,
    strict: false,
});

const validatorCache = new Map<string, ReturnType<Ajv['compile']>>();

type JsonObject = Record<string, unknown>;
type AssetSchemaKind = 'asset' | 'asset-list';
type ContentSchemaKind = 'content-ref' | 'content-ref-list';
export type PublicWriteOperation = 'create' | 'update';
export type ContentLifecycleClock = 'createdAt' | 'updatedAt';
export type PublicWriteSchemaConfig = {
    enabled: true;
    subjectField: string;
    allowedOperations: PublicWriteOperation[];
    requiredStatus: string;
};
export type ContentLifecycleSchemaConfig = {
    enabled: true;
    ttlSeconds: number;
    archiveStatus: string;
    clock: ContentLifecycleClock;
};
export type AssetReference = {
    assetId: number;
    path: string;
};
export type ContentReference = {
    contentItemId: number;
    path: string;
    allowedContentTypeIds: number[];
    allowedContentTypeSlugs: string[];
};
export type QueryableContentFieldType = 'string' | 'number' | 'boolean';
export type QueryableContentField = {
    name: string;
    type: QueryableContentFieldType;
};
export type ContentLocalizationSchemaConfig = {
    enabled: true;
    supportedLocales: string[];
    defaultLocale: string;
};
export type LocalizeContentDataOptions = {
    locale?: string;
    fallbackLocale?: string;
};
export type ContentLocaleResolution = {
    requestedLocale: string;
    fallbackLocale: string;
    defaultLocale: string;
    localizedFieldCount: number;
    resolvedFieldCount: number;
    fallbackFieldCount: number;
    unresolvedFields: string[];
};
export type ContentTypeSchemaSource = 'schema' | 'manifest';
export type ContentTypeSchemaSourceInput = {
    schema?: unknown;
    schemaManifest?: unknown;
};
export type ResolvedContentTypeSchemaSource = {
    source: ContentTypeSchemaSource;
    schema: string;
    schemaManifest: string | null;
};
export type ContentTypeSchemaManifestFieldType =
    | 'text'
    | 'textarea'
    | 'number'
    | 'checkbox'
    | 'select'
    | 'asset'
    | 'asset-list'
    | 'content-ref'
    | 'content-ref-list'
    | 'group'
    | 'array'
    | 'block-set';
export type ContentTypeSchemaManifestOption = {
    label?: string;
    value: string;
};
export type ContentTypeSchemaManifestField = {
    name: string;
    type: ContentTypeSchemaManifestFieldType;
    label?: string;
    description?: string;
    required?: boolean;
    localized?: boolean;
    integer?: boolean;
    min?: number;
    max?: number;
    minItems?: number;
    maxItems?: number;
    options?: Array<string | ContentTypeSchemaManifestOption>;
    itemType?: 'text' | 'textarea' | 'number' | 'checkbox' | 'select';
    itemInteger?: boolean;
    itemOptions?: Array<string | ContentTypeSchemaManifestOption>;
    allowedContentTypeIds?: number[];
    allowedContentTypeSlugs?: string[];
    fields?: ContentTypeSchemaManifestField[];
    blocks?: ContentTypeSchemaManifestBlock[];
};
export type ContentTypeSchemaManifestBlock = {
    type: string;
    label?: string;
    description?: string;
    fields: ContentTypeSchemaManifestField[];
};
export type ContentTypeSchemaManifest = {
    version?: number;
    title?: string;
    description?: string;
    fields: ContentTypeSchemaManifestField[];
    localization?: {
        enabled?: boolean;
        supportedLocales: string[];
        defaultLocale: string;
    };
    publicWrite?: {
        enabled?: boolean;
        subjectField: string;
        allowedOperations?: PublicWriteOperation[];
        requiredStatus?: string;
    };
    lifecycle?: {
        enabled?: boolean;
        ttlSeconds: number;
        archiveStatus?: string;
        clock?: ContentLifecycleClock;
    };
    preview?: {
        titleField?: string;
        subtitleField?: string;
        imageField?: string;
    };
};

const PUBLIC_WRITE_EXTENSION_KEY = 'x-wordclaw-public-write';
const PUBLIC_WRITE_EXTENSION_CODE = 'INVALID_CONTENT_SCHEMA_PUBLIC_WRITE_EXTENSION';
const LIFECYCLE_EXTENSION_KEY = 'x-wordclaw-lifecycle';
const LIFECYCLE_EXTENSION_CODE = 'INVALID_CONTENT_SCHEMA_LIFECYCLE_EXTENSION';
const LOCALIZATION_EXTENSION_KEY = 'x-wordclaw-localization';
const LOCALIZATION_EXTENSION_CODE = 'INVALID_CONTENT_SCHEMA_LOCALIZATION_EXTENSION';
const LOCALIZED_FIELD_KEY = 'x-wordclaw-localized';
const SCHEMA_MANIFEST_EXTENSION_KEY = 'x-wordclaw-schema-manifest';
const SCHEMA_UI_EXTENSION_KEY = 'x-wordclaw-ui';
const SCHEMA_PREVIEW_EXTENSION_KEY = 'x-wordclaw-preview';
const SCHEMA_MANIFEST_JSON_CODE = 'INVALID_CONTENT_SCHEMA_MANIFEST_JSON';
const SCHEMA_MANIFEST_TYPE_CODE = 'INVALID_CONTENT_SCHEMA_MANIFEST_TYPE';
const SCHEMA_MANIFEST_DEFINITION_CODE = 'INVALID_CONTENT_SCHEMA_MANIFEST_DEFINITION';
const SCHEMA_SOURCE_REQUIRED_CODE = 'CONTENT_TYPE_SCHEMA_SOURCE_REQUIRED';
const SCHEMA_SOURCE_CONFLICT_CODE = 'CONTENT_TYPE_SCHEMA_SOURCE_CONFLICT';

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
    if (!errors || errors.length === 0) {
        return 'Unknown schema validation failure';
    }

    const top = errors[0];
    const path = top.instancePath || '/';
    return `${path} ${top.message || 'is invalid'}`.trim();
}

function isObject(value: unknown): value is JsonObject {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepCloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function normalizePointerPath(path: string, segment: string): string {
    if (!path || path === '/') {
        return `/${segment}`;
    }

    return `${path}/${segment}`;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function normalizeJsonText(value: unknown): string | null {
    if (typeof value === 'string') {
        return value;
    }

    if (isObject(value)) {
        return JSON.stringify(value);
    }

    return null;
}

function manifestFailure(error: string, remediation: string, details: string, code = SCHEMA_MANIFEST_DEFINITION_CODE): ValidationFailure {
    return {
        error,
        code,
        remediation,
        context: {
            details
        }
    };
}

function normalizeManifestOptions(
    options: unknown,
    path: string
): { ok: true; options: ContentTypeSchemaManifestOption[] } | { ok: false; failure: ValidationFailure } {
    if (!Array.isArray(options) || options.length === 0) {
        return {
            ok: false,
            failure: manifestFailure(
                'Invalid schema manifest select field',
                'Select fields must define a non-empty options array.',
                `${path}/options must be a non-empty array of strings or { value, label } objects.`
            )
        };
    }

    const normalized = options.map((option) => {
        if (typeof option === 'string' && option.trim().length > 0) {
            return {
                value: option.trim(),
                label: option.trim()
            };
        }

        if (isObject(option) && isNonEmptyString(option.value)) {
            return {
                value: option.value.trim(),
                label: isNonEmptyString(option.label) ? option.label.trim() : option.value.trim()
            };
        }

        return null;
    });

    if (normalized.some((option) => option === null)) {
        return {
            ok: false,
            failure: manifestFailure(
                'Invalid schema manifest select field',
                'Select field options must be strings or objects with a non-empty value.',
                `${path}/options contains an invalid option entry.`
            )
        };
    }

    const values = normalized.map((option) => option!.value);
    if (new Set(values).size !== values.length) {
        return {
            ok: false,
            failure: manifestFailure(
                'Invalid schema manifest select field',
                'Select field option values must be unique.',
                `${path}/options contains duplicate values.`
            )
        };
    }

    return {
        ok: true,
        options: normalized as ContentTypeSchemaManifestOption[]
    };
}

function applyManifestFieldCommon(
    field: ContentTypeSchemaManifestField,
    schemaNode: JsonObject,
    path: string
): ValidationFailure | null {
    if (!isNonEmptyString(field.name)) {
        return manifestFailure(
            'Invalid schema manifest field',
            'Each manifest field requires a non-empty name.',
            `${path}/name must be a non-empty string.`
        );
    }

    if (field.label !== undefined && !isNonEmptyString(field.label)) {
        return manifestFailure(
            'Invalid schema manifest field',
            'Field labels must be non-empty strings when provided.',
            `${path}/label must be a non-empty string when provided.`
        );
    }

    if (field.description !== undefined && !isNonEmptyString(field.description)) {
        return manifestFailure(
            'Invalid schema manifest field',
            'Field descriptions must be non-empty strings when provided.',
            `${path}/description must be a non-empty string when provided.`
        );
    }

    if (field.localized !== undefined && typeof field.localized !== 'boolean') {
        return manifestFailure(
            'Invalid schema manifest field',
            'localized must be true or false when provided.',
            `${path}/localized must be a boolean when provided.`
        );
    }

    if (field.label) {
        schemaNode.title = field.label.trim();
    }

    if (field.description) {
        schemaNode.description = field.description.trim();
    }

    if (field.localized === true) {
        schemaNode[LOCALIZED_FIELD_KEY] = true;
    }

    return null;
}

function validateManifestFieldList(
    fields: unknown,
    path: string
): { ok: true; fields: ContentTypeSchemaManifestField[] } | { ok: false; failure: ValidationFailure } {
    if (!Array.isArray(fields)) {
        return {
            ok: false,
            failure: manifestFailure(
                'Invalid schema manifest field list',
                'Manifest fields must be declared as an array.',
                `${path} must be an array of field definitions.`
            )
        };
    }

    const normalized = fields as ContentTypeSchemaManifestField[];
    const names = normalized.map((field) => (isObject(field) && typeof field.name === 'string' ? field.name.trim() : ''));
    if (names.some((name) => name.length === 0)) {
        return {
            ok: false,
            failure: manifestFailure(
                'Invalid schema manifest field list',
                'Each field definition requires a non-empty name.',
                `${path} contains a field without a valid name.`
            )
        };
    }

    if (new Set(names).size !== names.length) {
        return {
            ok: false,
            failure: manifestFailure(
                'Invalid schema manifest field list',
                'Field names must be unique within the same object scope.',
                `${path} contains duplicate field names.`
            )
        };
    }

    return {
        ok: true,
        fields: normalized
    };
}

function compileManifestScalarField(field: ContentTypeSchemaManifestField, path: string): { ok: true; schema: JsonObject } | { ok: false; failure: ValidationFailure } {
    const schema: JsonObject = {};
    const commonFailure = applyManifestFieldCommon(field, schema, path);
    if (commonFailure) {
        return {
            ok: false,
            failure: commonFailure
        };
    }

    switch (field.type) {
    case 'text':
    case 'textarea':
        schema.type = 'string';
        if (field.type === 'textarea') {
            schema[SCHEMA_UI_EXTENSION_KEY] = {
                widget: 'textarea'
            };
        }
        break;
    case 'number':
        schema.type = field.integer === true ? 'integer' : 'number';
        if (field.min !== undefined) {
            if (typeof field.min !== 'number') {
                return {
                    ok: false,
                    failure: manifestFailure(
                        'Invalid schema manifest number field',
                        'Numeric field bounds must be numeric values.',
                        `${path}/min must be a number when provided.`
                    )
                };
            }
            schema.minimum = field.min;
        }
        if (field.max !== undefined) {
            if (typeof field.max !== 'number') {
                return {
                    ok: false,
                    failure: manifestFailure(
                        'Invalid schema manifest number field',
                        'Numeric field bounds must be numeric values.',
                        `${path}/max must be a number when provided.`
                    )
                };
            }
            schema.maximum = field.max;
        }
        break;
    case 'checkbox':
        schema.type = 'boolean';
        break;
    case 'select': {
        const optionsResult = normalizeManifestOptions(field.options, path);
        if (!optionsResult.ok) {
            return optionsResult;
        }
        schema.type = 'string';
        schema.enum = optionsResult.options.map((option) => option.value);
        schema[SCHEMA_UI_EXTENSION_KEY] = {
            widget: 'select',
            options: optionsResult.options
        };
        break;
    }
    default:
        return {
            ok: false,
            failure: manifestFailure(
                'Invalid schema manifest field',
                'Scalar field compilation received an unsupported field type.',
                `${path}/type "${field.type}" is not supported in this context.`
            )
        };
    }

    return {
        ok: true,
        schema
    };
}

function compileManifestObjectFromFields(
    fields: ContentTypeSchemaManifestField[],
    path: string
): { ok: true; schema: JsonObject } | { ok: false; failure: ValidationFailure } {
    const properties: JsonObject = {};
    const required = fields
        .filter((field) => field.required === true)
        .map((field) => field.name.trim());

    for (let index = 0; index < fields.length; index += 1) {
        const field = fields[index];
        const compiled = compileManifestField(field, `${path}/${field.name || index}`);
        if (!compiled.ok) {
            return compiled;
        }

        properties[field.name.trim()] = compiled.schema;
    }

    const schema: JsonObject = {
        type: 'object',
        additionalProperties: false,
        properties
    };
    if (required.length > 0) {
        schema.required = required;
    }

    return {
        ok: true,
        schema
    };
}

function compileManifestField(field: ContentTypeSchemaManifestField, path: string): { ok: true; schema: JsonObject } | { ok: false; failure: ValidationFailure } {
    if (!isObject(field)) {
        return {
            ok: false,
            failure: manifestFailure(
                'Invalid schema manifest field',
                'Each field definition must be a JSON object.',
                `${path} must be a JSON object.`
            )
        };
    }

    if (!isNonEmptyString(field.type)) {
        return {
            ok: false,
            failure: manifestFailure(
                'Invalid schema manifest field',
                'Each field definition requires a supported type.',
                `${path}/type must be a non-empty string.`
            )
        };
    }

    if (field.type === 'text' || field.type === 'textarea' || field.type === 'number' || field.type === 'checkbox' || field.type === 'select') {
        return compileManifestScalarField(field, path);
    }

    if (field.type === 'asset' || field.type === 'asset-list') {
        const schema: JsonObject = {};
        const commonFailure = applyManifestFieldCommon(field, schema, path);
        if (commonFailure) {
            return {
                ok: false,
                failure: commonFailure
            };
        }

        const assetItemSchema: JsonObject = {
            type: 'object',
            additionalProperties: false,
            properties: {
                assetId: { type: 'integer' }
            },
            required: ['assetId']
        };

        if (field.type === 'asset') {
            return {
                ok: true,
                schema: {
                    ...schema,
                    ...assetItemSchema,
                    'x-wordclaw-field-kind': 'asset'
                }
            };
        }

        if (field.minItems !== undefined && (!Number.isInteger(field.minItems) || field.minItems < 0)) {
            return {
                ok: false,
                failure: manifestFailure(
                    'Invalid schema manifest array field',
                    'minItems must be a non-negative integer when provided.',
                    `${path}/minItems must be a non-negative integer when provided.`
                )
            };
        }

        if (field.maxItems !== undefined && (!Number.isInteger(field.maxItems) || field.maxItems < 0)) {
            return {
                ok: false,
                failure: manifestFailure(
                    'Invalid schema manifest array field',
                    'maxItems must be a non-negative integer when provided.',
                    `${path}/maxItems must be a non-negative integer when provided.`
                )
            };
        }

        return {
            ok: true,
            schema: {
                ...schema,
                type: 'array',
                ...(field.minItems !== undefined ? { minItems: field.minItems } : {}),
                ...(field.maxItems !== undefined ? { maxItems: field.maxItems } : {}),
                'x-wordclaw-field-kind': 'asset-list',
                items: assetItemSchema
            }
        };
    }

    if (field.type === 'content-ref' || field.type === 'content-ref-list') {
        const schema: JsonObject = {};
        const commonFailure = applyManifestFieldCommon(field, schema, path);
        if (commonFailure) {
            return {
                ok: false,
                failure: commonFailure
            };
        }

        const allowedContentTypeIds = field.allowedContentTypeIds;
        if (
            allowedContentTypeIds !== undefined
            && (!Array.isArray(allowedContentTypeIds) || allowedContentTypeIds.some((value) => !Number.isInteger(value)))
        ) {
            return {
                ok: false,
                failure: manifestFailure(
                    'Invalid schema manifest content reference field',
                    'allowedContentTypeIds must be an array of integer IDs when provided.',
                    `${path}/allowedContentTypeIds must be an array of integers when provided.`
                )
            };
        }

        const allowedContentTypeSlugs = field.allowedContentTypeSlugs;
        if (
            allowedContentTypeSlugs !== undefined
            && (!Array.isArray(allowedContentTypeSlugs) || allowedContentTypeSlugs.some((value) => !isNonEmptyString(value)))
        ) {
            return {
                ok: false,
                failure: manifestFailure(
                    'Invalid schema manifest content reference field',
                    'allowedContentTypeSlugs must be an array of non-empty slugs when provided.',
                    `${path}/allowedContentTypeSlugs must be an array of non-empty strings when provided.`
                )
            };
        }

        if (field.minItems !== undefined && (!Number.isInteger(field.minItems) || field.minItems < 0)) {
            return {
                ok: false,
                failure: manifestFailure(
                    'Invalid schema manifest array field',
                    'minItems must be a non-negative integer when provided.',
                    `${path}/minItems must be a non-negative integer when provided.`
                )
            };
        }

        if (field.maxItems !== undefined && (!Number.isInteger(field.maxItems) || field.maxItems < 0)) {
            return {
                ok: false,
                failure: manifestFailure(
                    'Invalid schema manifest array field',
                    'maxItems must be a non-negative integer when provided.',
                    `${path}/maxItems must be a non-negative integer when provided.`
                )
            };
        }

        const contentRefItemSchema: JsonObject = {
            type: 'object',
            additionalProperties: false,
            properties: {
                contentItemId: { type: 'integer' }
            },
            required: ['contentItemId'],
            ...(allowedContentTypeIds && allowedContentTypeIds.length > 0 ? { allowedContentTypeIds } : {}),
            ...(allowedContentTypeSlugs && allowedContentTypeSlugs.length > 0 ? { allowedContentTypeSlugs: allowedContentTypeSlugs.map((value) => value.trim()) } : {})
        };

        if (field.type === 'content-ref') {
            return {
                ok: true,
                schema: {
                    ...schema,
                    ...contentRefItemSchema,
                    'x-wordclaw-field-kind': 'content-ref'
                }
            };
        }

        return {
            ok: true,
            schema: {
                ...schema,
                type: 'array',
                ...(field.minItems !== undefined ? { minItems: field.minItems } : {}),
                ...(field.maxItems !== undefined ? { maxItems: field.maxItems } : {}),
                'x-wordclaw-field-kind': 'content-ref-list',
                items: {
                    ...contentRefItemSchema,
                    'x-wordclaw-field-kind': 'content-ref'
                }
            }
        };
    }

    if (field.type === 'group') {
        const schema: JsonObject = {};
        const commonFailure = applyManifestFieldCommon(field, schema, path);
        if (commonFailure) {
            return {
                ok: false,
                failure: commonFailure
            };
        }

        const fieldsResult = validateManifestFieldList(field.fields, `${path}/fields`);
        if (!fieldsResult.ok) {
            return fieldsResult;
        }

        const compiledGroup = compileManifestObjectFromFields(fieldsResult.fields, `${path}/fields`);
        if (!compiledGroup.ok) {
            return compiledGroup;
        }

        return {
            ok: true,
            schema: {
                ...compiledGroup.schema,
                ...schema
            }
        };
    }

    if (field.type === 'array') {
        const schema: JsonObject = {};
        const commonFailure = applyManifestFieldCommon(field, schema, path);
        if (commonFailure) {
            return {
                ok: false,
                failure: commonFailure
            };
        }

        if (field.minItems !== undefined && (!Number.isInteger(field.minItems) || field.minItems < 0)) {
            return {
                ok: false,
                failure: manifestFailure(
                    'Invalid schema manifest array field',
                    'minItems must be a non-negative integer when provided.',
                    `${path}/minItems must be a non-negative integer when provided.`
                )
            };
        }

        if (field.maxItems !== undefined && (!Number.isInteger(field.maxItems) || field.maxItems < 0)) {
            return {
                ok: false,
                failure: manifestFailure(
                    'Invalid schema manifest array field',
                    'maxItems must be a non-negative integer when provided.',
                    `${path}/maxItems must be a non-negative integer when provided.`
                )
            };
        }

        let items: JsonObject | null = null;
        if (field.fields !== undefined) {
            const fieldsResult = validateManifestFieldList(field.fields, `${path}/fields`);
            if (!fieldsResult.ok) {
                return fieldsResult;
            }
            const compiledItems = compileManifestObjectFromFields(fieldsResult.fields, `${path}/fields`);
            if (!compiledItems.ok) {
                return compiledItems;
            }
            items = compiledItems.schema;
        } else if (field.itemType !== undefined) {
            const itemField: ContentTypeSchemaManifestField = {
                name: `${field.name.trim()}Item`,
                type: field.itemType,
                label: field.label,
                description: field.description,
                integer: field.itemInteger,
                options: field.itemOptions
            };
            const compiledItems = compileManifestField(itemField, `${path}/itemType`);
            if (!compiledItems.ok) {
                return compiledItems;
            }
            const itemSchema = deepCloneJson(compiledItems.schema);
            delete itemSchema.title;
            delete itemSchema.description;
            delete itemSchema[LOCALIZED_FIELD_KEY];
            items = itemSchema;
        }

        if (!items) {
            return {
                ok: false,
                failure: manifestFailure(
                    'Invalid schema manifest array field',
                    'Array fields require either fields for object items or itemType for scalar items.',
                    `${path} must define either fields or itemType.`
                )
            };
        }

        return {
            ok: true,
            schema: {
                ...schema,
                type: 'array',
                ...(field.minItems !== undefined ? { minItems: field.minItems } : {}),
                ...(field.maxItems !== undefined ? { maxItems: field.maxItems } : {}),
                items
            }
        };
    }

    if (field.type === 'block-set') {
        const schema: JsonObject = {};
        const commonFailure = applyManifestFieldCommon(field, schema, path);
        if (commonFailure) {
            return {
                ok: false,
                failure: commonFailure
            };
        }

        if (field.minItems !== undefined && (!Number.isInteger(field.minItems) || field.minItems < 0)) {
            return {
                ok: false,
                failure: manifestFailure(
                    'Invalid schema manifest array field',
                    'minItems must be a non-negative integer when provided.',
                    `${path}/minItems must be a non-negative integer when provided.`
                )
            };
        }

        if (field.maxItems !== undefined && (!Number.isInteger(field.maxItems) || field.maxItems < 0)) {
            return {
                ok: false,
                failure: manifestFailure(
                    'Invalid schema manifest array field',
                    'maxItems must be a non-negative integer when provided.',
                    `${path}/maxItems must be a non-negative integer when provided.`
                )
            };
        }

        if (!Array.isArray(field.blocks) || field.blocks.length === 0) {
            return {
                ok: false,
                failure: manifestFailure(
                    'Invalid schema manifest block-set field',
                    'Block-set fields require a non-empty blocks array.',
                    `${path}/blocks must be a non-empty array.`
                )
            };
        }

        const blockTypes = field.blocks.map((block) => (isObject(block) && typeof block.type === 'string' ? block.type.trim() : ''));
        if (blockTypes.some((value) => value.length === 0) || new Set(blockTypes).size !== blockTypes.length) {
            return {
                ok: false,
                failure: manifestFailure(
                    'Invalid schema manifest block-set field',
                    'Each block requires a unique non-empty type.',
                    `${path}/blocks must declare unique non-empty block types.`
                )
            };
        }

        const oneOf: JsonObject[] = [];
        const uiBlocks: Array<{ type: string; label: string; description?: string }> = [];
        for (const block of field.blocks) {
            if (!isObject(block)) {
                return {
                    ok: false,
                    failure: manifestFailure(
                        'Invalid schema manifest block-set field',
                        'Each block definition must be a JSON object.',
                        `${path}/blocks contains an invalid block definition.`
                    )
                };
            }

            const fieldsResult = validateManifestFieldList(block.fields, `${path}/blocks/${block.type}/fields`);
            if (!fieldsResult.ok) {
                return fieldsResult;
            }

            const compiledBlock = compileManifestObjectFromFields(fieldsResult.fields, `${path}/blocks/${block.type}/fields`);
            if (!compiledBlock.ok) {
                return compiledBlock;
            }

            const blockSchema = compiledBlock.schema;
            const blockProperties = isObject(blockSchema.properties) ? deepCloneJson(blockSchema.properties) : {};
            blockProperties.blockType = {
                type: 'string',
                const: block.type.trim()
            };
            const blockRequired = Array.isArray(blockSchema.required)
                ? ['blockType', ...blockSchema.required.filter((value): value is string => typeof value === 'string')]
                : ['blockType'];

            oneOf.push({
                ...blockSchema,
                title: isNonEmptyString(block.label) ? block.label.trim() : block.type.trim(),
                ...(isNonEmptyString(block.description) ? { description: block.description.trim() } : {}),
                properties: blockProperties,
                required: blockRequired
            });

            uiBlocks.push({
                type: block.type.trim(),
                label: isNonEmptyString(block.label) ? block.label.trim() : block.type.trim(),
                ...(isNonEmptyString(block.description) ? { description: block.description.trim() } : {})
            });
        }

        return {
            ok: true,
            schema: {
                ...schema,
                type: 'array',
                ...(field.minItems !== undefined ? { minItems: field.minItems } : {}),
                ...(field.maxItems !== undefined ? { maxItems: field.maxItems } : {}),
                items: {
                    oneOf
                },
                [SCHEMA_UI_EXTENSION_KEY]: {
                    widget: 'block-set',
                    blocks: uiBlocks
                }
            }
        };
    }

    return {
        ok: false,
        failure: manifestFailure(
            'Invalid schema manifest field',
            'Each field definition requires a supported field type.',
            `${path}/type "${field.type}" is not supported.`
        )
    };
}

export function compileSchemaManifest(manifestText: string): { ok: true; manifest: ContentTypeSchemaManifest; schema: JsonObject; schemaText: string; manifestText: string } | { ok: false; failure: ValidationFailure } {
    const parsedManifest = parseJson(
        manifestText,
        SCHEMA_MANIFEST_JSON_CODE,
        'Invalid schema manifest JSON',
        'Provide a valid JSON object in the content type "schemaManifest" field.'
    );

    if (!parsedManifest.ok) {
        return parsedManifest;
    }

    if (!isObject(parsedManifest.parsed)) {
        return {
            ok: false,
            failure: {
                error: 'Invalid schema manifest type',
                code: SCHEMA_MANIFEST_TYPE_CODE,
                remediation: 'Content type schema manifests must be JSON objects with a top-level fields array.'
            }
        };
    }

    const manifest = parsedManifest.parsed as ContentTypeSchemaManifest;
    const fieldsResult = validateManifestFieldList(manifest.fields, '/fields');
    if (!fieldsResult.ok) {
        return fieldsResult;
    }

    if (manifest.version !== undefined && (!Number.isInteger(manifest.version) || manifest.version < 1)) {
        return {
            ok: false,
            failure: manifestFailure(
                'Invalid schema manifest version',
                'Manifest version must be a positive integer when provided.',
                `/version must be a positive integer when provided.`
            )
        };
    }

    const compiledObject = compileManifestObjectFromFields(fieldsResult.fields, '/fields');
    if (!compiledObject.ok) {
        return compiledObject;
    }

    const schema = compiledObject.schema;

    if (isNonEmptyString(manifest.title)) {
        schema.title = manifest.title.trim();
    }
    if (isNonEmptyString(manifest.description)) {
        schema.description = manifest.description.trim();
    }

    if (manifest.localization !== undefined) {
        if (!isObject(manifest.localization)) {
            return {
                ok: false,
                failure: manifestFailure(
                    'Invalid schema manifest localization config',
                    'localization must be an object when provided.',
                    '/localization must be a JSON object when provided.'
                )
            };
        }
        schema[LOCALIZATION_EXTENSION_KEY] = manifest.localization;
    }

    if (manifest.publicWrite !== undefined) {
        if (!isObject(manifest.publicWrite)) {
            return {
                ok: false,
                failure: manifestFailure(
                    'Invalid schema manifest public-write config',
                    'publicWrite must be an object when provided.',
                    '/publicWrite must be a JSON object when provided.'
                )
            };
        }
        schema[PUBLIC_WRITE_EXTENSION_KEY] = manifest.publicWrite;
    }

    if (manifest.lifecycle !== undefined) {
        if (!isObject(manifest.lifecycle)) {
            return {
                ok: false,
                failure: manifestFailure(
                    'Invalid schema manifest lifecycle config',
                    'lifecycle must be an object when provided.',
                    '/lifecycle must be a JSON object when provided.'
                )
            };
        }
        schema[LIFECYCLE_EXTENSION_KEY] = manifest.lifecycle;
    }

    if (manifest.preview !== undefined) {
        if (!isObject(manifest.preview)) {
            return {
                ok: false,
                failure: manifestFailure(
                    'Invalid schema manifest preview config',
                    'preview must be an object when provided.',
                    '/preview must be a JSON object when provided.'
                )
            };
        }
        schema[SCHEMA_PREVIEW_EXTENSION_KEY] = manifest.preview;
    }

    schema[SCHEMA_MANIFEST_EXTENSION_KEY] = {
        version: manifest.version ?? 1
    };

    const schemaText = JSON.stringify(schema, null, 2);
    const schemaFailure = validateContentTypeSchema(schemaText);
    if (schemaFailure) {
        return {
            ok: false,
            failure: schemaFailure.code === 'INVALID_CONTENT_SCHEMA_JSON' || schemaFailure.code === 'INVALID_CONTENT_SCHEMA_TYPE'
                ? {
                    ...schemaFailure,
                    code: SCHEMA_MANIFEST_DEFINITION_CODE
                }
                : schemaFailure
        };
    }

    return {
        ok: true,
        manifest,
        schema,
        schemaText,
        manifestText: JSON.stringify(manifest, null, 2)
    };
}

export function validateContentTypeSchemaManifest(manifestText: string): ValidationFailure | null {
    const compiled = compileSchemaManifest(manifestText);
    return compiled.ok ? null : compiled.failure;
}

export function resolveContentTypeSchemaSource(
    input: ContentTypeSchemaSourceInput,
    options: { requireSource?: boolean } = {}
): { ok: true; value: ResolvedContentTypeSchemaSource | null } | { ok: false; failure: ValidationFailure } {
    const hasSchema = input.schema !== undefined;
    const hasSchemaManifest = input.schemaManifest !== undefined;

    if (hasSchema && hasSchemaManifest) {
        return {
            ok: false,
            failure: {
                error: 'Conflicting schema sources',
                code: SCHEMA_SOURCE_CONFLICT_CODE,
                remediation: 'Provide either schema or schemaManifest, but not both in the same request.'
            }
        };
    }

    if (!hasSchema && !hasSchemaManifest) {
        if (options.requireSource) {
            return {
                ok: false,
                failure: {
                    error: 'Missing schema source',
                    code: SCHEMA_SOURCE_REQUIRED_CODE,
                    remediation: 'Provide either schema or schemaManifest when creating a content type.'
                }
            };
        }

        return {
            ok: true,
            value: null
        };
    }

    if (hasSchema) {
        const schemaText = normalizeJsonText(input.schema);
        if (!schemaText) {
            return {
                ok: false,
                failure: {
                    error: 'Invalid content schema type',
                    code: 'INVALID_CONTENT_SCHEMA_TYPE',
                    remediation: 'Content type schema must be provided as a JSON object or JSON string.'
                }
            };
        }

        const schemaFailure = validateContentTypeSchema(schemaText);
        if (schemaFailure) {
            return {
                ok: false,
                failure: schemaFailure
            };
        }

        return {
            ok: true,
            value: {
                source: 'schema',
                schema: schemaText,
                schemaManifest: null
            }
        };
    }

    const manifestText = normalizeJsonText(input.schemaManifest);
    if (!manifestText) {
        return {
            ok: false,
            failure: {
                error: 'Invalid schema manifest type',
                code: SCHEMA_MANIFEST_TYPE_CODE,
                remediation: 'Content type schema manifests must be provided as a JSON object or JSON string.'
            }
        };
    }

    const compiledManifest = compileSchemaManifest(manifestText);
    if (!compiledManifest.ok) {
        return {
            ok: false,
            failure: compiledManifest.failure
        };
    }

    return {
        ok: true,
        value: {
            source: 'manifest',
            schema: compiledManifest.schemaText,
            schemaManifest: compiledManifest.manifestText
        }
    };
}

function validateAssetReferenceShape(schemaNode: JsonObject, path: string, kind: AssetSchemaKind): ValidationFailure | null {
    if (kind === 'asset') {
        if (schemaNode.type !== 'object') {
            return {
                error: 'Invalid asset field schema',
                code: 'INVALID_CONTENT_SCHEMA_ASSET_EXTENSION',
                remediation: 'Fields marked with x-wordclaw-field-kind="asset" must be objects with a required assetId field.',
                context: {
                    details: `${path} must declare type "object" for asset fields.`
                }
            };
        }

        const properties = isObject(schemaNode.properties) ? schemaNode.properties : null;
        const assetIdSchema = properties && isObject(properties.assetId) ? properties.assetId : null;
        const required = Array.isArray(schemaNode.required) ? schemaNode.required : [];
        if (!assetIdSchema || !required.includes('assetId')) {
            return {
                error: 'Invalid asset field schema',
                code: 'INVALID_CONTENT_SCHEMA_ASSET_EXTENSION',
                remediation: 'Fields marked with x-wordclaw-field-kind="asset" must define properties.assetId and include assetId in required.',
                context: {
                    details: `${path} must define a required assetId field.`
                }
            };
        }

        const assetIdType = assetIdSchema.type;
        if (assetIdType !== 'integer' && assetIdType !== 'number') {
            return {
                error: 'Invalid asset field schema',
                code: 'INVALID_CONTENT_SCHEMA_ASSET_EXTENSION',
                remediation: 'Asset fields must model assetId as a numeric JSON Schema type.',
                context: {
                    details: `${path}/properties/assetId must declare type "integer" or "number".`
                }
            };
        }

        return null;
    }

    if (schemaNode.type !== 'array' || !isObject(schemaNode.items)) {
        return {
            error: 'Invalid asset-list field schema',
            code: 'INVALID_CONTENT_SCHEMA_ASSET_EXTENSION',
            remediation: 'Fields marked with x-wordclaw-field-kind="asset-list" must be arrays of asset reference objects.',
            context: {
                details: `${path} must declare type "array" with object items for asset-list fields.`
            }
        };
    }

    return validateAssetReferenceShape(schemaNode.items, `${path}/items`, 'asset');
}

function validateContentReferenceConstraints(schemaNode: JsonObject, path: string): ValidationFailure | null {
    const allowedContentTypeIds = schemaNode.allowedContentTypeIds;
    if (allowedContentTypeIds !== undefined) {
        if (!Array.isArray(allowedContentTypeIds) || allowedContentTypeIds.some((value) => typeof value !== 'number' || !Number.isInteger(value))) {
            return {
                error: 'Invalid content-ref field schema',
                code: 'INVALID_CONTENT_SCHEMA_CONTENT_REFERENCE_EXTENSION',
                remediation: 'allowedContentTypeIds must be an array of integer content type ids.',
                context: {
                    details: `${path}/allowedContentTypeIds must be an array of integers.`
                }
            };
        }
    }

    const allowedContentTypeSlugs = schemaNode.allowedContentTypeSlugs;
    if (allowedContentTypeSlugs !== undefined) {
        if (!Array.isArray(allowedContentTypeSlugs) || allowedContentTypeSlugs.some((value) => typeof value !== 'string' || value.trim().length === 0)) {
            return {
                error: 'Invalid content-ref field schema',
                code: 'INVALID_CONTENT_SCHEMA_CONTENT_REFERENCE_EXTENSION',
                remediation: 'allowedContentTypeSlugs must be an array of non-empty content type slugs.',
                context: {
                    details: `${path}/allowedContentTypeSlugs must be an array of non-empty strings.`
                }
            };
        }
    }

    return null;
}

function validateContentReferenceShape(schemaNode: JsonObject, path: string, kind: ContentSchemaKind): ValidationFailure | null {
    if (kind === 'content-ref') {
        if (schemaNode.type !== 'object') {
            return {
                error: 'Invalid content-ref field schema',
                code: 'INVALID_CONTENT_SCHEMA_CONTENT_REFERENCE_EXTENSION',
                remediation: 'Fields marked with x-wordclaw-field-kind="content-ref" must be objects with a required contentItemId field.',
                context: {
                    details: `${path} must declare type "object" for content-ref fields.`
                }
            };
        }

        const properties = isObject(schemaNode.properties) ? schemaNode.properties : null;
        const contentItemIdSchema = properties && isObject(properties.contentItemId) ? properties.contentItemId : null;
        const required = Array.isArray(schemaNode.required) ? schemaNode.required : [];
        if (!contentItemIdSchema || !required.includes('contentItemId')) {
            return {
                error: 'Invalid content-ref field schema',
                code: 'INVALID_CONTENT_SCHEMA_CONTENT_REFERENCE_EXTENSION',
                remediation: 'Fields marked with x-wordclaw-field-kind="content-ref" must define properties.contentItemId and include contentItemId in required.',
                context: {
                    details: `${path} must define a required contentItemId field.`
                }
            };
        }

        const contentItemIdType = contentItemIdSchema.type;
        if (contentItemIdType !== 'integer' && contentItemIdType !== 'number') {
            return {
                error: 'Invalid content-ref field schema',
                code: 'INVALID_CONTENT_SCHEMA_CONTENT_REFERENCE_EXTENSION',
                remediation: 'Content reference fields must model contentItemId as a numeric JSON Schema type.',
                context: {
                    details: `${path}/properties/contentItemId must declare type "integer" or "number".`
                }
            };
        }

        return validateContentReferenceConstraints(schemaNode, path);
    }

    if (schemaNode.type !== 'array' || !isObject(schemaNode.items)) {
        return {
            error: 'Invalid content-ref-list field schema',
            code: 'INVALID_CONTENT_SCHEMA_CONTENT_REFERENCE_EXTENSION',
            remediation: 'Fields marked with x-wordclaw-field-kind="content-ref-list" must be arrays of content reference objects.',
            context: {
                details: `${path} must declare type "array" with object items for content-ref-list fields.`
            }
        };
    }

    return validateContentReferenceShape(schemaNode.items, `${path}/items`, 'content-ref');
}

function normalizePublicWriteOperations(value: unknown): PublicWriteOperation[] | null {
    if (value === undefined) {
        return ['create'];
    }

    if (!Array.isArray(value) || value.length === 0) {
        return null;
    }

    const normalized = value.filter((entry): entry is PublicWriteOperation => entry === 'create' || entry === 'update');
    if (normalized.length !== value.length) {
        return null;
    }

    return [...new Set(normalized)];
}

function normalizeLifecycleClock(value: unknown): ContentLifecycleClock | null {
    if (value === undefined) {
        return 'updatedAt';
    }

    if (value === 'createdAt' || value === 'updatedAt') {
        return value;
    }

    return null;
}

function validateLifecycleExtension(schemaNode: JsonObject, path: string): ValidationFailure | null {
    const rawConfig = schemaNode[LIFECYCLE_EXTENSION_KEY];
    if (rawConfig === undefined) {
        return null;
    }

    if (!isObject(rawConfig)) {
        return {
            error: 'Invalid lifecycle schema extension',
            code: LIFECYCLE_EXTENSION_CODE,
            remediation: 'x-wordclaw-lifecycle must be an object when declared on a content type schema.',
            context: {
                details: `${path}/${LIFECYCLE_EXTENSION_KEY} must be a JSON object.`
            }
        };
    }

    if (rawConfig.enabled === false) {
        return null;
    }

    if (schemaNode.type !== 'object' || !isObject(schemaNode.properties)) {
        return {
            error: 'Invalid lifecycle schema extension',
            code: LIFECYCLE_EXTENSION_CODE,
            remediation: 'Lifecycle-managed content requires a top-level object schema with addressable properties.',
            context: {
                details: `${path} must declare type "object" with properties before enabling x-wordclaw-lifecycle.`
            }
        };
    }

    const ttlSeconds = rawConfig.ttlSeconds;
    if (typeof ttlSeconds !== 'number' || !Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 31_536_000) {
        return {
            error: 'Invalid lifecycle schema extension',
            code: LIFECYCLE_EXTENSION_CODE,
            remediation: 'ttlSeconds must be an integer between 60 and 31536000.',
            context: {
                details: `${path}/${LIFECYCLE_EXTENSION_KEY}/ttlSeconds must be an integer between 60 and 31536000.`
            }
        };
    }

    if (
        rawConfig.archiveStatus !== undefined
        && (typeof rawConfig.archiveStatus !== 'string' || rawConfig.archiveStatus.trim().length === 0)
    ) {
        return {
            error: 'Invalid lifecycle schema extension',
            code: LIFECYCLE_EXTENSION_CODE,
            remediation: 'archiveStatus must be a non-empty string when provided.',
            context: {
                details: `${path}/${LIFECYCLE_EXTENSION_KEY}/archiveStatus must be a non-empty string.`
            }
        };
    }

    const clock = normalizeLifecycleClock(rawConfig.clock);
    if (!clock) {
        return {
            error: 'Invalid lifecycle schema extension',
            code: LIFECYCLE_EXTENSION_CODE,
            remediation: 'clock must be either "createdAt" or "updatedAt" when provided.',
            context: {
                details: `${path}/${LIFECYCLE_EXTENSION_KEY}/clock must be "createdAt" or "updatedAt".`
            }
        };
    }

    return null;
}

function normalizeSupportedLocales(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length === 0) {
        return null;
    }

    const normalized = value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0);

    if (normalized.length !== value.length) {
        return null;
    }

    return [...new Set(normalized)];
}

function parseLocalizationSchemaConfig(schemaNode: JsonObject): ContentLocalizationSchemaConfig | null {
    const rawConfig = isObject(schemaNode[LOCALIZATION_EXTENSION_KEY]) ? schemaNode[LOCALIZATION_EXTENSION_KEY] : null;
    if (!rawConfig || rawConfig.enabled === false) {
        return null;
    }

    const supportedLocales = normalizeSupportedLocales(rawConfig.supportedLocales);
    const defaultLocale = typeof rawConfig.defaultLocale === 'string' ? rawConfig.defaultLocale.trim() : '';
    if (!supportedLocales || !defaultLocale || !supportedLocales.includes(defaultLocale)) {
        return null;
    }

    return {
        enabled: true,
        supportedLocales,
        defaultLocale
    };
}

function validateLocalizationExtension(schemaNode: JsonObject, path: string): ValidationFailure | null {
    const rawConfig = schemaNode[LOCALIZATION_EXTENSION_KEY];
    if (rawConfig === undefined) {
        return null;
    }

    if (!isObject(rawConfig)) {
        return {
            error: 'Invalid localization schema extension',
            code: LOCALIZATION_EXTENSION_CODE,
            remediation: 'x-wordclaw-localization must be an object when declared on a content type schema.',
            context: {
                details: `${path}/${LOCALIZATION_EXTENSION_KEY} must be a JSON object.`
            }
        };
    }

    if (rawConfig.enabled === false) {
        return null;
    }

    if (schemaNode.type !== 'object' || !isObject(schemaNode.properties)) {
        return {
            error: 'Invalid localization schema extension',
            code: LOCALIZATION_EXTENSION_CODE,
            remediation: 'Localized content requires a top-level object schema with addressable properties.',
            context: {
                details: `${path} must declare type "object" with properties before enabling ${LOCALIZATION_EXTENSION_KEY}.`
            }
        };
    }

    const supportedLocales = normalizeSupportedLocales(rawConfig.supportedLocales);
    if (!supportedLocales) {
        return {
            error: 'Invalid localization schema extension',
            code: LOCALIZATION_EXTENSION_CODE,
            remediation: 'supportedLocales must be a non-empty array of unique locale strings.',
            context: {
                details: `${path}/${LOCALIZATION_EXTENSION_KEY}/supportedLocales must be a non-empty array of unique strings.`
            }
        };
    }

    const defaultLocale = typeof rawConfig.defaultLocale === 'string' ? rawConfig.defaultLocale.trim() : '';
    if (!defaultLocale || !supportedLocales.includes(defaultLocale)) {
        return {
            error: 'Invalid localization schema extension',
            code: LOCALIZATION_EXTENSION_CODE,
            remediation: 'defaultLocale must be a non-empty string that is also present in supportedLocales.',
            context: {
                details: `${path}/${LOCALIZATION_EXTENSION_KEY}/defaultLocale must match one of the configured supportedLocales.`
            }
        };
    }

    return null;
}

function validateLocalizedFieldExtension(
    schemaNode: JsonObject,
    path: string,
    localizationConfig: ContentLocalizationSchemaConfig | null
): ValidationFailure | null {
    const rawFlag = schemaNode[LOCALIZED_FIELD_KEY];
    if (rawFlag === undefined) {
        return null;
    }

    if (typeof rawFlag !== 'boolean') {
        return {
            error: 'Invalid localized field schema extension',
            code: LOCALIZATION_EXTENSION_CODE,
            remediation: `${LOCALIZED_FIELD_KEY} must be a boolean when declared on a field schema.`,
            context: {
                details: `${path}/${LOCALIZED_FIELD_KEY} must be true or false.`
            }
        };
    }

    if (!rawFlag) {
        return null;
    }

    if (path === '/') {
        return {
            error: 'Invalid localized field schema extension',
            code: LOCALIZATION_EXTENSION_CODE,
            remediation: `Only addressable fields may use ${LOCALIZED_FIELD_KEY}; declare ${LOCALIZATION_EXTENSION_KEY} on the root object instead.`,
            context: {
                details: `${path} cannot itself be marked with ${LOCALIZED_FIELD_KEY}.`
            }
        };
    }

    if (!localizationConfig) {
        return {
            error: 'Invalid localized field schema extension',
            code: LOCALIZATION_EXTENSION_CODE,
            remediation: `Fields marked with ${LOCALIZED_FIELD_KEY} require a valid top-level ${LOCALIZATION_EXTENSION_KEY} declaration.`,
            context: {
                details: `${path} is localized but the schema does not define supportedLocales/defaultLocale at the root.`
            }
        };
    }

    return null;
}

function validatePublicWriteExtension(schemaNode: JsonObject, path: string): ValidationFailure | null {
    const rawConfig = schemaNode[PUBLIC_WRITE_EXTENSION_KEY];
    if (rawConfig === undefined) {
        return null;
    }

    if (!isObject(rawConfig)) {
        return {
            error: 'Invalid public-write schema extension',
            code: PUBLIC_WRITE_EXTENSION_CODE,
            remediation: 'x-wordclaw-public-write must be an object when declared on a content type schema.',
            context: {
                details: `${path}/${PUBLIC_WRITE_EXTENSION_KEY} must be a JSON object.`
            }
        };
    }

    if (rawConfig.enabled === false) {
        return null;
    }

    if (schemaNode.type !== 'object' || !isObject(schemaNode.properties)) {
        return {
            error: 'Invalid public-write schema extension',
            code: PUBLIC_WRITE_EXTENSION_CODE,
            remediation: 'Public write lanes require a top-level object schema with addressable properties.',
            context: {
                details: `${path} must declare type "object" with properties before enabling x-wordclaw-public-write.`
            }
        };
    }

    const subjectField = typeof rawConfig.subjectField === 'string' ? rawConfig.subjectField.trim() : '';
    if (!subjectField) {
        return {
            error: 'Invalid public-write schema extension',
            code: PUBLIC_WRITE_EXTENSION_CODE,
            remediation: 'Public write lanes must declare subjectField so tokens can bind one session or player subject.',
            context: {
                details: `${path}/${PUBLIC_WRITE_EXTENSION_KEY}/subjectField must be a non-empty string.`
            }
        };
    }

    const subjectSchema = schemaNode.properties[subjectField];
    if (!isObject(subjectSchema) || subjectSchema.type !== 'string') {
        return {
            error: 'Invalid public-write schema extension',
            code: PUBLIC_WRITE_EXTENSION_CODE,
            remediation: 'subjectField must reference a required top-level string property in the schema.',
            context: {
                details: `${path}/properties/${subjectField} must declare type "string".`
            }
        };
    }

    const requiredFields = Array.isArray(schemaNode.required) ? schemaNode.required : [];
    if (!requiredFields.includes(subjectField)) {
        return {
            error: 'Invalid public-write schema extension',
            code: PUBLIC_WRITE_EXTENSION_CODE,
            remediation: 'subjectField must also appear in the top-level required list so public writes always bind a subject.',
            context: {
                details: `${path}/required must include "${subjectField}".`
            }
        };
    }

    const allowedOperations = normalizePublicWriteOperations(rawConfig.allowedOperations);
    if (!allowedOperations) {
        return {
            error: 'Invalid public-write schema extension',
            code: PUBLIC_WRITE_EXTENSION_CODE,
            remediation: 'allowedOperations must be a non-empty array containing only "create" and/or "update".',
            context: {
                details: `${path}/${PUBLIC_WRITE_EXTENSION_KEY}/allowedOperations must be a non-empty array of supported operations.`
            }
        };
    }

    if (rawConfig.requiredStatus !== undefined && (typeof rawConfig.requiredStatus !== 'string' || rawConfig.requiredStatus.trim().length === 0)) {
        return {
            error: 'Invalid public-write schema extension',
            code: PUBLIC_WRITE_EXTENSION_CODE,
            remediation: 'requiredStatus must be a non-empty string when provided.',
            context: {
                details: `${path}/${PUBLIC_WRITE_EXTENSION_KEY}/requiredStatus must be a non-empty string.`
            }
        };
    }

    return null;
}

function validateSchemaExtensions(
    schemaNode: unknown,
    path = '/',
    localizationConfig: ContentLocalizationSchemaConfig | null = null
): ValidationFailure | null {
    if (!isObject(schemaNode)) {
        return null;
    }

    let activeLocalizationConfig = localizationConfig;
    if (path === '/') {
        const lifecycleFailure = validateLifecycleExtension(schemaNode, path);
        if (lifecycleFailure) {
            return lifecycleFailure;
        }

        const publicWriteFailure = validatePublicWriteExtension(schemaNode, path);
        if (publicWriteFailure) {
            return publicWriteFailure;
        }

        const localizationFailure = validateLocalizationExtension(schemaNode, path);
        if (localizationFailure) {
            return localizationFailure;
        }

        activeLocalizationConfig = parseLocalizationSchemaConfig(schemaNode);
    }

    const localizedFieldFailure = validateLocalizedFieldExtension(schemaNode, path, activeLocalizationConfig);
    if (localizedFieldFailure) {
        return localizedFieldFailure;
    }

    const kind = schemaNode['x-wordclaw-field-kind'];
    if (kind === 'asset' || kind === 'asset-list') {
        const failure = validateAssetReferenceShape(schemaNode, path, kind);
        if (failure) {
            return failure;
        }
    } else if (kind === 'content-ref' || kind === 'content-ref-list') {
        const failure = validateContentReferenceShape(schemaNode, path, kind);
        if (failure) {
            return failure;
        }
    }

    if (isObject(schemaNode.properties)) {
        for (const [key, childSchema] of Object.entries(schemaNode.properties)) {
            const failure = validateSchemaExtensions(childSchema, normalizePointerPath(path, key), activeLocalizationConfig);
            if (failure) {
                return failure;
            }
        }
    }

    if (isObject(schemaNode.items)) {
        const failure = validateSchemaExtensions(schemaNode.items, `${path}/items`, activeLocalizationConfig);
        if (failure) {
            return failure;
        }
    }

    return null;
}

function transformLocalizedSchema(
    schemaNode: unknown,
    localizationConfig: ContentLocalizationSchemaConfig,
    requireDefaultLocale = false
): unknown {
    if (!isObject(schemaNode)) {
        return schemaNode;
    }

    if (schemaNode[LOCALIZED_FIELD_KEY] === true) {
        const innerSchema = { ...schemaNode };
        delete innerSchema[LOCALIZED_FIELD_KEY];

        const transformedInner = transformLocalizedSchema(innerSchema, localizationConfig, false);
        const localizedProperties: JsonObject = {};
        for (const locale of localizationConfig.supportedLocales) {
            localizedProperties[locale] = deepCloneJson(transformedInner);
        }

        const localizedWrapper: JsonObject = {
            type: 'object',
            additionalProperties: false,
            properties: localizedProperties
        };

        if (requireDefaultLocale) {
            localizedWrapper.required = [localizationConfig.defaultLocale];
        }

        if (typeof schemaNode.title === 'string') {
            localizedWrapper.title = schemaNode.title;
        }
        if (typeof schemaNode.description === 'string') {
            localizedWrapper.description = schemaNode.description;
        }
        if (schemaNode.premium === true) {
            localizedWrapper.premium = true;
        }

        return localizedWrapper;
    }

    const transformed: JsonObject = { ...schemaNode };
    if (isObject(schemaNode.properties)) {
        const requiredFields = Array.isArray(schemaNode.required)
            ? new Set(schemaNode.required.filter((value): value is string => typeof value === 'string'))
            : new Set<string>();
        const transformedProperties: JsonObject = {};

        for (const [key, childSchema] of Object.entries(schemaNode.properties)) {
            transformedProperties[key] = transformLocalizedSchema(childSchema, localizationConfig, requiredFields.has(key));
        }

        transformed.properties = transformedProperties;
    }

    if (isObject(schemaNode.items)) {
        transformed.items = transformLocalizedSchema(schemaNode.items, localizationConfig, false);
    }

    return transformed;
}

function collectAssetReferences(schemaNode: unknown, dataNode: unknown, path = '/'): AssetReference[] {
    if (!isObject(schemaNode) || dataNode === undefined || dataNode === null) {
        return [];
    }

    const kind = schemaNode['x-wordclaw-field-kind'];
    if (kind === 'asset') {
        if (isObject(dataNode) && typeof dataNode.assetId === 'number' && Number.isInteger(dataNode.assetId)) {
            return [{
                assetId: dataNode.assetId,
                path
            }];
        }
        return [];
    }

    if (kind === 'asset-list') {
        if (!Array.isArray(dataNode)) {
            return [];
        }

        return dataNode.flatMap((item, index) => {
            if (isObject(item) && typeof item.assetId === 'number' && Number.isInteger(item.assetId)) {
                return [{
                    assetId: item.assetId,
                    path: `${path}/${index}`
                }];
            }
            return [];
        });
    }

    if (isObject(schemaNode.properties) && isObject(dataNode)) {
        return Object.entries(schemaNode.properties).flatMap(([key, childSchema]) =>
            collectAssetReferences(childSchema, dataNode[key], normalizePointerPath(path, key))
        );
    }

    if (isObject(schemaNode.items) && Array.isArray(dataNode)) {
        return dataNode.flatMap((item, index) => collectAssetReferences(schemaNode.items, item, `${path}/${index}`));
    }

    return [];
}

function collectContentReferences(schemaNode: unknown, dataNode: unknown, path = '/'): ContentReference[] {
    if (!isObject(schemaNode) || dataNode === undefined || dataNode === null) {
        return [];
    }

    const kind = schemaNode['x-wordclaw-field-kind'];
    if (kind === 'content-ref') {
        if (isObject(dataNode) && typeof dataNode.contentItemId === 'number' && Number.isInteger(dataNode.contentItemId)) {
            return [{
                contentItemId: dataNode.contentItemId,
                path,
                allowedContentTypeIds: Array.isArray(schemaNode.allowedContentTypeIds)
                    ? schemaNode.allowedContentTypeIds.filter((value): value is number => typeof value === 'number' && Number.isInteger(value))
                    : [],
                allowedContentTypeSlugs: Array.isArray(schemaNode.allowedContentTypeSlugs)
                    ? schemaNode.allowedContentTypeSlugs.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                    : []
            }];
        }
        return [];
    }

    if (kind === 'content-ref-list') {
        if (!Array.isArray(dataNode) || !isObject(schemaNode.items)) {
            return [];
        }

        return dataNode.flatMap((item, index) => collectContentReferences(schemaNode.items, item, `${path}/${index}`));
    }

    if (isObject(schemaNode.properties) && isObject(dataNode)) {
        return Object.entries(schemaNode.properties).flatMap(([key, childSchema]) =>
            collectContentReferences(childSchema, dataNode[key], normalizePointerPath(path, key))
        );
    }

    if (isObject(schemaNode.items) && Array.isArray(dataNode)) {
        return dataNode.flatMap((item, index) => collectContentReferences(schemaNode.items, item, `${path}/${index}`));
    }

    return [];
}

function parseJson(value: string, invalidCode: string, invalidError: string, remediation: string): { ok: true; parsed: unknown } | { ok: false; failure: ValidationFailure } {
    try {
        return { ok: true, parsed: JSON.parse(value) };
    } catch (error) {
        return {
            ok: false,
            failure: {
                error: invalidError,
                code: invalidCode,
                remediation,
                context: {
                    details: error instanceof Error ? error.message : String(error)
                }
            }
        };
    }
}

function toQueryableFieldType(schemaNode: unknown): QueryableContentFieldType | null {
    if (!isObject(schemaNode)) {
        return null;
    }

    if (schemaNode['x-wordclaw-field-kind'] !== undefined || schemaNode[LOCALIZED_FIELD_KEY] === true) {
        return null;
    }

    switch (schemaNode.type) {
    case 'string':
        return 'string';
    case 'integer':
    case 'number':
        return 'number';
    case 'boolean':
        return 'boolean';
    default:
        return null;
    }
}

function compileSchema(schemaText: string): {
    ok: true;
    sourceSchema: AnySchema;
    schema: AnySchema;
    validate: ReturnType<Ajv['compile']>;
} | {
    ok: false;
    failure: ValidationFailure;
} {
    const parsedSchema = parseJson(
        schemaText,
        'INVALID_CONTENT_SCHEMA_JSON',
        'Invalid content schema JSON',
        'Provide a valid JSON object in the content type "schema" field.'
    );

    if (!parsedSchema.ok) {
        return parsedSchema;
    }

    if (!parsedSchema.parsed || typeof parsedSchema.parsed !== 'object' || Array.isArray(parsedSchema.parsed)) {
        return {
            ok: false,
            failure: {
                error: 'Invalid content schema type',
                code: 'INVALID_CONTENT_SCHEMA_TYPE',
                remediation: 'Content type schema must be a JSON object that follows JSON Schema format.'
            }
        };
    }

    const sourceSchema = parsedSchema.parsed as JsonObject;
    const schemaExtensionFailure = validateSchemaExtensions(sourceSchema);
    if (schemaExtensionFailure) {
        return {
            ok: false,
            failure: schemaExtensionFailure
        };
    }

    const localizationConfig = parseLocalizationSchemaConfig(sourceSchema);
    const compiledSchema = localizationConfig
        ? transformLocalizedSchema(sourceSchema, localizationConfig)
        : sourceSchema;

    const cached = validatorCache.get(schemaText);
    if (cached) {
        return {
            ok: true,
            sourceSchema: sourceSchema as AnySchema,
            schema: compiledSchema as AnySchema,
            validate: cached
        };
    }

    try {
        const validate = ajv.compile(compiledSchema as AnySchema);
        validatorCache.set(schemaText, validate);
        return {
            ok: true,
            sourceSchema: sourceSchema as AnySchema,
            schema: compiledSchema as AnySchema,
            validate
        };
    } catch (error) {
        return {
            ok: false,
            failure: {
                error: 'Invalid JSON Schema definition',
                code: 'INVALID_CONTENT_SCHEMA_DEFINITION',
                remediation: 'Ensure the schema is valid JSON Schema syntax (types, required, properties, etc.).',
                context: {
                    details: error instanceof Error ? error.message : String(error)
                }
            }
        };
    }
}

export function validateContentTypeSchema(schemaText: string): ValidationFailure | null {
    const compiled = compileSchema(schemaText);
    if (!compiled.ok) {
        return compiled.failure;
    }

    return null;
}

export function listQueryableContentFields(schemaText: string): QueryableContentField[] {
    const compiled = compileSchema(schemaText);
    if (!compiled.ok) {
        return [];
    }

    const schema = compiled.sourceSchema as JsonObject;
    if (schema.type !== 'object' || !isObject(schema.properties)) {
        return [];
    }

    return Object.entries(schema.properties).flatMap(([name, propertySchema]) => {
        const type = toQueryableFieldType(propertySchema);
        return type ? [{ name, type }] : [];
    });
}

export function getPublicWriteSchemaConfig(schemaText: string): PublicWriteSchemaConfig | null {
    const compiled = compileSchema(schemaText);
    if (!compiled.ok) {
        return null;
    }

    const schema = compiled.sourceSchema as JsonObject;
    const rawConfig = isObject(schema[PUBLIC_WRITE_EXTENSION_KEY]) ? schema[PUBLIC_WRITE_EXTENSION_KEY] : null;
    if (!rawConfig || rawConfig.enabled === false) {
        return null;
    }

    const subjectField = typeof rawConfig.subjectField === 'string' ? rawConfig.subjectField.trim() : '';
    const allowedOperations = normalizePublicWriteOperations(rawConfig.allowedOperations);
    if (!subjectField || !allowedOperations || allowedOperations.length === 0) {
        return null;
    }

    return {
        enabled: true,
        subjectField,
        allowedOperations,
        requiredStatus: typeof rawConfig.requiredStatus === 'string' && rawConfig.requiredStatus.trim().length > 0
            ? rawConfig.requiredStatus.trim()
            : 'draft'
    };
}

export function getContentLifecycleSchemaConfig(schemaText: string): ContentLifecycleSchemaConfig | null {
    const compiled = compileSchema(schemaText);
    if (!compiled.ok) {
        return null;
    }

    const schema = compiled.sourceSchema as JsonObject;
    const rawConfig = isObject(schema[LIFECYCLE_EXTENSION_KEY]) ? schema[LIFECYCLE_EXTENSION_KEY] : null;
    if (!rawConfig || rawConfig.enabled === false) {
        return null;
    }

    const clock = normalizeLifecycleClock(rawConfig.clock);
    if (
        typeof rawConfig.ttlSeconds !== 'number'
        || !Number.isInteger(rawConfig.ttlSeconds)
        || rawConfig.ttlSeconds < 60
        || rawConfig.ttlSeconds > 31_536_000
        || !clock
    ) {
        return null;
    }

    return {
        enabled: true,
        ttlSeconds: rawConfig.ttlSeconds,
        archiveStatus: typeof rawConfig.archiveStatus === 'string' && rawConfig.archiveStatus.trim().length > 0
            ? rawConfig.archiveStatus.trim()
            : 'archived',
        clock,
    };
}

export function getContentLocalizationSchemaConfig(schemaText: string): ContentLocalizationSchemaConfig | null {
    const compiled = compileSchema(schemaText);
    if (!compiled.ok) {
        return null;
    }

    return parseLocalizationSchemaConfig(compiled.sourceSchema as JsonObject);
}

export function getPublicWriteSubjectValue(schemaText: string, dataText: string): string | null {
    const config = getPublicWriteSchemaConfig(schemaText);
    if (!config) {
        return null;
    }

    const parsedData = parseJson(
        dataText,
        'INVALID_CONTENT_DATA_JSON',
        'Invalid content data JSON',
        'Provide valid JSON for the content item "data" field.'
    );

    if (!parsedData.ok || !isObject(parsedData.parsed)) {
        return null;
    }

    const subjectValue = parsedData.parsed[config.subjectField];
    return typeof subjectValue === 'string' && subjectValue.trim().length > 0
        ? subjectValue
        : null;
}

export async function validateContentDataAgainstSchema(schemaText: string, dataText: string, domainId: number): Promise<ValidationFailure | null> {
    const compiled = compileSchema(schemaText);
    if (!compiled.ok) {
        return compiled.failure;
    }

    const parsedData = parseJson(
        dataText,
        'INVALID_CONTENT_DATA_JSON',
        'Invalid content data JSON',
        'Provide valid JSON for the content item "data" field.'
    );

    if (!parsedData.ok) {
        return parsedData.failure;
    }

    const isValid = compiled.validate(parsedData.parsed);
    if (isValid) {
        const assetReferences = collectAssetReferences(compiled.schema as JsonObject, parsedData.parsed);
        if (assetReferences.length > 0) {
            const uniqueAssetIds = [...new Set(assetReferences.map((reference) => reference.assetId))];
            const matchingAssets = await db.select({ id: assets.id })
                .from(assets)
                .where(and(
                    eq(assets.domainId, domainId),
                    eq(assets.status, 'active'),
                    inArray(assets.id, uniqueAssetIds)
                ));

            const matchingAssetIds = new Set(matchingAssets.map((asset) => asset.id));
            const missingReferences = assetReferences.filter((reference) => !matchingAssetIds.has(reference.assetId));
            if (missingReferences.length > 0) {
                return {
                    error: 'Content data references unavailable assets',
                    code: 'CONTENT_ASSET_REFERENCE_INVALID',
                    remediation: 'Adjust asset references so each assetId exists in the current domain and is still active.',
                    context: {
                        details: missingReferences
                            .map((reference) => `${reference.path} references missing or unavailable asset ${reference.assetId}`)
                            .join('; '),
                        invalidAssetIds: [...new Set(missingReferences.map((reference) => reference.assetId))]
                    }
                };
            }
        }

        const contentReferences = collectContentReferences(compiled.schema as JsonObject, parsedData.parsed);
        if (contentReferences.length === 0) {
            return null;
        }

        const uniqueContentItemIds = [...new Set(contentReferences.map((reference) => reference.contentItemId))];
        const matchingContentItems = await db.select({
            id: contentItems.id,
            contentTypeId: contentItems.contentTypeId
        })
            .from(contentItems)
            .where(and(
                eq(contentItems.domainId, domainId),
                inArray(contentItems.id, uniqueContentItemIds)
            ));

        const matchingContentItemsById = new Map(matchingContentItems.map((item) => [item.id, item]));
        const missingContentReferences = contentReferences.filter((reference) => !matchingContentItemsById.has(reference.contentItemId));
        if (missingContentReferences.length > 0) {
            return {
                error: 'Content data references unavailable content items',
                code: 'CONTENT_REFERENCE_INVALID',
                remediation: 'Adjust content references so each contentItemId exists in the current domain.',
                context: {
                    details: missingContentReferences
                        .map((reference) => `${reference.path} references missing or unavailable content item ${reference.contentItemId}`)
                        .join('; '),
                    invalidContentItemIds: [...new Set(missingContentReferences.map((reference) => reference.contentItemId))]
                }
            };
        }

        const uniqueAllowedSlugs = [...new Set(contentReferences.flatMap((reference) => reference.allowedContentTypeSlugs))];
        const allowedContentTypeIdsBySlug = new Map<string, number>();
        if (uniqueAllowedSlugs.length > 0) {
            const matchingContentTypes = await db.select({
                id: contentTypes.id,
                slug: contentTypes.slug
            })
                .from(contentTypes)
                .where(and(
                    eq(contentTypes.domainId, domainId),
                    inArray(contentTypes.slug, uniqueAllowedSlugs)
                ));

            for (const contentType of matchingContentTypes) {
                allowedContentTypeIdsBySlug.set(contentType.slug, contentType.id);
            }
        }

        const mismatchedContentReferences = contentReferences.filter((reference) => {
            const contentItem = matchingContentItemsById.get(reference.contentItemId);
            if (!contentItem) {
                return false;
            }

            const allowedContentTypeIds = new Set(reference.allowedContentTypeIds);
            for (const slug of reference.allowedContentTypeSlugs) {
                const allowedId = allowedContentTypeIdsBySlug.get(slug);
                if (allowedId !== undefined) {
                    allowedContentTypeIds.add(allowedId);
                }
            }

            if (allowedContentTypeIds.size === 0) {
                return false;
            }

            return !allowedContentTypeIds.has(contentItem.contentTypeId);
        });

        if (mismatchedContentReferences.length > 0) {
            return {
                error: 'Content data references disallowed content item types',
                code: 'CONTENT_REFERENCE_TYPE_MISMATCH',
                remediation: 'Adjust content references so each contentItemId points at an allowed content type for that field.',
                context: {
                    details: mismatchedContentReferences.map((reference) => {
                        const contentItem = matchingContentItemsById.get(reference.contentItemId);
                        const allowed = [
                            ...reference.allowedContentTypeIds.map((value) => `id:${value}`),
                            ...reference.allowedContentTypeSlugs.map((value) => `slug:${value}`)
                        ];
                        return `${reference.path} references content item ${reference.contentItemId} of content type ${contentItem?.contentTypeId ?? 'unknown'}, allowed: ${allowed.join(', ')}`;
                    }).join('; '),
                    invalidContentItemIds: [...new Set(mismatchedContentReferences.map((reference) => reference.contentItemId))]
                }
            };
        }

        return null;
    }

    return {
        error: 'Content data does not satisfy content type schema',
        code: 'CONTENT_SCHEMA_VALIDATION_FAILED',
        remediation: 'Adjust content item data so it matches the content type JSON schema.',
        context: {
            details: formatAjvErrors(compiled.validate.errors)
        }
    };
}

export function extractAssetReferencesFromContent(schemaText: string, dataText: string): AssetReference[] {
    const compiled = compileSchema(schemaText);
    if (!compiled.ok) {
        return [];
    }

    const parsedData = parseJson(
        dataText,
        'INVALID_CONTENT_DATA_JSON',
        'Invalid content data JSON',
        'Provide valid JSON for the content item "data" field.'
    );

    if (!parsedData.ok) {
        return [];
    }

    return collectAssetReferences(compiled.schema as JsonObject, parsedData.parsed);
}

export function extractContentReferencesFromContent(schemaText: string, dataText: string): ContentReference[] {
    const compiled = compileSchema(schemaText);
    if (!compiled.ok) {
        return [];
    }

    const parsedData = parseJson(
        dataText,
        'INVALID_CONTENT_DATA_JSON',
        'Invalid content data JSON',
        'Provide valid JSON for the content item "data" field.'
    );

    if (!parsedData.ok) {
        return [];
    }

    return collectContentReferences(compiled.schema as JsonObject, parsedData.parsed);
}

export function redactPremiumFields(schemaText: string, dataText: string): string {
    const compiled = compileSchema(schemaText);
    if (!compiled.ok) return dataText;

    const parsedData = parseJson(dataText, 'ERR', 'ERR', 'ERR');
    if (!parsedData.ok) return dataText;

    const schema = compiled.sourceSchema as Record<string, any>;
    if (schema?.type === 'object' && schema?.properties) {
        let redacted = false;
        const data = parsedData.parsed as Record<string, unknown>;

        for (const [key, propDef] of Object.entries(schema.properties as Record<string, any>)) {
            if (propDef?.premium === true && data[key] !== undefined) {
                data[key] = '[REDACTED: PREMIUM CONTENT]';
                redacted = true;
            }
        }

        if (redacted) return JSON.stringify(data);
    }

    return dataText;
}

function resolveLocalizedDataNode(
    schemaNode: unknown,
    dataNode: unknown,
    requestedLocale: string,
    fallbackLocale: string,
    path: string,
    resolution: {
        localizedFieldCount: number;
        resolvedFieldCount: number;
        fallbackFieldCount: number;
        unresolvedFields: string[];
    }
): unknown {
    if (!isObject(schemaNode)) {
        return dataNode;
    }

    if (schemaNode[LOCALIZED_FIELD_KEY] === true) {
        resolution.localizedFieldCount += 1;
        if (!isObject(dataNode)) {
            resolution.unresolvedFields.push(path);
            return dataNode;
        }

        const innerSchema = { ...schemaNode };
        delete innerSchema[LOCALIZED_FIELD_KEY];

        if (dataNode[requestedLocale] !== undefined) {
            resolution.resolvedFieldCount += 1;
            return resolveLocalizedDataNode(innerSchema, dataNode[requestedLocale], requestedLocale, fallbackLocale, path, resolution);
        }

        if (dataNode[fallbackLocale] !== undefined) {
            resolution.resolvedFieldCount += 1;
            resolution.fallbackFieldCount += 1;
            return resolveLocalizedDataNode(innerSchema, dataNode[fallbackLocale], requestedLocale, fallbackLocale, path, resolution);
        }

        resolution.unresolvedFields.push(path);
        return null;
    }

    if (isObject(schemaNode.properties) && isObject(dataNode)) {
        const transformedNode: JsonObject = { ...dataNode };
        for (const [key, childSchema] of Object.entries(schemaNode.properties)) {
            if (Object.prototype.hasOwnProperty.call(dataNode, key)) {
                transformedNode[key] = resolveLocalizedDataNode(
                    childSchema,
                    dataNode[key],
                    requestedLocale,
                    fallbackLocale,
                    normalizePointerPath(path, key),
                    resolution
                );
            }
        }
        return transformedNode;
    }

    if (isObject(schemaNode.items) && Array.isArray(dataNode)) {
        return dataNode.map((entry, index) => resolveLocalizedDataNode(
            schemaNode.items,
            entry,
            requestedLocale,
            fallbackLocale,
            `${path}/${index}`,
            resolution
        ));
    }

    return dataNode;
}

export function localizeContentData(
    schemaText: string,
    dataText: string,
    options: LocalizeContentDataOptions = {}
): { data: string; localeResolution: ContentLocaleResolution | null } {
    const locale = typeof options.locale === 'string' ? options.locale.trim() : '';
    if (!locale) {
        return {
            data: dataText,
            localeResolution: null
        };
    }

    const compiled = compileSchema(schemaText);
    if (!compiled.ok) {
        return {
            data: dataText,
            localeResolution: null
        };
    }

    const localizationConfig = parseLocalizationSchemaConfig(compiled.sourceSchema as JsonObject);
    if (!localizationConfig) {
        return {
            data: dataText,
            localeResolution: null
        };
    }

    const parsedData = parseJson(dataText, 'ERR', 'ERR', 'ERR');
    if (!parsedData.ok) {
        return {
            data: dataText,
            localeResolution: null
        };
    }

    const fallbackLocale = typeof options.fallbackLocale === 'string' && options.fallbackLocale.trim().length > 0
        ? options.fallbackLocale.trim()
        : localizationConfig.defaultLocale;

    const resolution = {
        localizedFieldCount: 0,
        resolvedFieldCount: 0,
        fallbackFieldCount: 0,
        unresolvedFields: [] as string[]
    };

    const localizedData = resolveLocalizedDataNode(
        compiled.sourceSchema as JsonObject,
        parsedData.parsed,
        locale,
        fallbackLocale,
        '/',
        resolution
    );

    return {
        data: JSON.stringify(localizedData),
        localeResolution: {
            requestedLocale: locale,
            fallbackLocale,
            defaultLocale: localizationConfig.defaultLocale,
            localizedFieldCount: resolution.localizedFieldCount,
            resolvedFieldCount: resolution.resolvedFieldCount,
            fallbackFieldCount: resolution.fallbackFieldCount,
            unresolvedFields: resolution.unresolvedFields
        }
    };
}

export function localizeContentItem<T extends { data: string }>(
    item: T,
    schemaText: string,
    options: LocalizeContentDataOptions = {}
): T & { localeResolution?: ContentLocaleResolution } {
    const localized = localizeContentData(schemaText, item.data, options);
    if (!localized.localeResolution) {
        return item as T & { localeResolution?: ContentLocaleResolution };
    }

    return {
        ...item,
        data: localized.data,
        localeResolution: localized.localeResolution
    };
}
