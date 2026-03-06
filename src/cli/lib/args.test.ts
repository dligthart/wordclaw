import { describe, expect, it } from 'vitest';

import { parseArgs, parseJsonValue } from './args.js';

describe('parseArgs', () => {
    it('parses positionals and long flags', () => {
        const parsed = parseArgs([
            'content',
            'create',
            '--content-type-id',
            '12',
            '--status=published',
            '--dry-run',
        ]);

        expect(parsed.positionals).toEqual(['content', 'create']);
        expect(parsed.flags['content-type-id']).toBe('12');
        expect(parsed.flags.status).toBe('published');
        expect(parsed.flags['dry-run']).toBe(true);
    });

    it('parses short flags as booleans', () => {
        const parsed = parseArgs(['-h']);
        expect(parsed.flags.h).toBe(true);
    });
});

describe('parseJsonValue', () => {
    it('parses valid json', () => {
        expect(parseJsonValue('{"ok":true}', '--json')).toEqual({ ok: true });
    });

    it('throws for invalid json', () => {
        expect(() => parseJsonValue('{oops}', '--json')).toThrow(
            '--json must be valid JSON:',
        );
    });
});
