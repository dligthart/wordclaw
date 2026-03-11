import { describe, expect, it } from 'vitest';

import { formatStructuredOutput, normalizeOutputFormat } from './output.js';

describe('normalizeOutputFormat', () => {
    it('accepts yaml and json', () => {
        expect(normalizeOutputFormat('yaml')).toBe('yaml');
        expect(normalizeOutputFormat('json')).toBe('json');
    });

    it('rejects unsupported formats', () => {
        expect(() => normalizeOutputFormat('table')).toThrow('--format must be "json" or "yaml".');
    });
});

describe('formatStructuredOutput', () => {
    it('formats JSON output', () => {
        expect(formatStructuredOutput({ ok: true }, 'json')).toBe('{\n  "ok": true\n}\n');
    });

    it('formats YAML output', () => {
        expect(formatStructuredOutput({
            ok: true,
            nested: {
                value: 'hello',
            },
            items: [1, 2],
        }, 'yaml')).toBe(
            'ok: true\nnested:\n  value: hello\nitems:\n  - 1\n  - 2\n',
        );
    });

    it('formats arrays of objects without extra indentation noise', () => {
        expect(formatStructuredOutput({
            steps: [
                { name: 'first', ok: true },
            ],
        }, 'yaml')).toBe(
            'steps:\n  - name: first\n    ok: true\n',
        );
    });
});
