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

function normalizePointerPath(path: string, segment: string): string {
    if (!path || path === '/') {
        return `/${segment}`;
    }

    return `${path}/${segment}`;
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

function validateSchemaExtensions(schemaNode: unknown, path = '/'): ValidationFailure | null {
    if (!isObject(schemaNode)) {
        return null;
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
            const failure = validateSchemaExtensions(childSchema, normalizePointerPath(path, key));
            if (failure) {
                return failure;
            }
        }
    }

    if (isObject(schemaNode.items)) {
        const failure = validateSchemaExtensions(schemaNode.items, `${path}/items`);
        if (failure) {
            return failure;
        }
    }

    return null;
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

function compileSchema(schemaText: string): { ok: true; schema: AnySchema; validate: ReturnType<Ajv['compile']> } | { ok: false; failure: ValidationFailure } {
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

    const schemaExtensionFailure = validateSchemaExtensions(parsedSchema.parsed);
    if (schemaExtensionFailure) {
        return {
            ok: false,
            failure: schemaExtensionFailure
        };
    }

    const cached = validatorCache.get(schemaText);
    if (cached) {
        return {
            ok: true,
            schema: parsedSchema.parsed as AnySchema,
            validate: cached
        };
    }

    try {
        const validate = ajv.compile(parsedSchema.parsed as AnySchema);
        validatorCache.set(schemaText, validate);
        return {
            ok: true,
            schema: parsedSchema.parsed as AnySchema,
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

export function redactPremiumFields(schemaText: string, dataText: string): string {
    const compiled = compileSchema(schemaText);
    if (!compiled.ok) return dataText;

    const parsedData = parseJson(dataText, 'ERR', 'ERR', 'ERR');
    if (!parsedData.ok) return dataText;

    const schema = compiled.schema as Record<string, any>;
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
