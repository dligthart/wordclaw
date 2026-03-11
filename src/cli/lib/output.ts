export type OutputFormat = 'json' | 'yaml';

function quoteString(value: string) {
    return JSON.stringify(value);
}

function isPlainScalarString(value: string) {
    return /^[A-Za-z0-9_.:/@+-]+$/.test(value);
}

function formatScalar(value: unknown): string {
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (typeof value !== 'string') {
        return quoteString(JSON.stringify(value));
    }
    if (value.length === 0) {
        return '""';
    }
    if (value.includes('\n')) {
        return '|';
    }
    return isPlainScalarString(value) ? value : quoteString(value);
}

function indent(text: string, level: number) {
    return text
        .split('\n')
        .map((line) => `${'  '.repeat(level)}${line}`)
        .join('\n');
}

function toYaml(value: unknown, level = 0): string {
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return '[]';
        }

        return value.map((entry) => {
            if (
                entry !== null
                && typeof entry === 'object'
            ) {
                const rendered = toYaml(entry, level + 1);
                const lines = rendered.split('\n');
                return `${'  '.repeat(level)}- ${lines[0]}\n${lines.slice(1).map((line) => `${'  '.repeat(level)}  ${line}`).join('\n')}`;
            }

            if (typeof entry === 'string' && entry.includes('\n')) {
                return `${'  '.repeat(level)}- |\n${indent(entry, level + 1)}`;
            }

            return `${'  '.repeat(level)}- ${formatScalar(entry)}`;
        }).join('\n');
    }

    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length === 0) {
            return '{}';
        }

        return entries.map(([key, entry]) => {
            if (Array.isArray(entry) || (entry && typeof entry === 'object')) {
                return `${'  '.repeat(level)}${key}:\n${toYaml(entry, level + 1)}`;
            }

            if (typeof entry === 'string' && entry.includes('\n')) {
                return `${'  '.repeat(level)}${key}: |\n${indent(entry, level + 1)}`;
            }

            return `${'  '.repeat(level)}${key}: ${formatScalar(entry)}`;
        }).join('\n');
    }

    return formatScalar(value);
}

export function normalizeOutputFormat(
    value: string | undefined,
    context = '--format',
): OutputFormat | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (value !== 'json' && value !== 'yaml') {
        throw new Error(`${context} must be "json" or "yaml".`);
    }

    return value;
}

export function formatStructuredOutput(value: unknown, format: OutputFormat): string {
    if (format === 'yaml') {
        return `${toYaml(value)}\n`;
    }

    return `${JSON.stringify(value, null, 2)}\n`;
}
