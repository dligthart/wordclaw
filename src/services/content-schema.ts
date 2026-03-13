import Ajv, { AnySchema, ErrorObject } from 'ajv';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db/index.js';
import { assets } from '../db/schema.js';

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
type AssetReference = {
    assetId: number;
    path: string;
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
        if (assetReferences.length === 0) {
            return null;
        }

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
        if (missingReferences.length === 0) {
            return null;
        }

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

    return {
        error: 'Content data does not satisfy content type schema',
        code: 'CONTENT_SCHEMA_VALIDATION_FAILED',
        remediation: 'Adjust content item data so it matches the content type JSON schema.',
        context: {
            details: formatAjvErrors(compiled.validate.errors)
        }
    };
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
