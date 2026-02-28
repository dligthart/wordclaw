import Ajv, { AnySchema, ErrorObject } from 'ajv';

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

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
    if (!errors || errors.length === 0) {
        return 'Unknown schema validation failure';
    }

    const top = errors[0];
    const path = top.instancePath || '/';
    return `${path} ${top.message || 'is invalid'}`.trim();
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

export function validateContentDataAgainstSchema(schemaText: string, dataText: string): ValidationFailure | null {
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
