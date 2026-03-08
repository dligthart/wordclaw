import { describe, expect, it } from 'vitest';

import {
    buildUnknownCommandError,
    resolveAlias,
    suggestClosest,
} from './command-resolution.js';

describe('resolveAlias', () => {
    it('maps known aliases to canonical commands', () => {
        expect(resolveAlias('ct', { ct: 'content-types' })).toBe('content-types');
    });

    it('leaves unknown values unchanged', () => {
        expect(resolveAlias('content', { ct: 'content-types' })).toBe('content');
    });
});

describe('suggestClosest', () => {
    it('suggests the nearest supported command', () => {
        expect(suggestClosest('inspec', ['inspect', 'call', 'prompt'])).toBe('inspect');
    });

    it('returns undefined when nothing is close enough', () => {
        expect(suggestClosest('zzz', ['inspect', 'call', 'prompt'])).toBeUndefined();
    });
});

describe('buildUnknownCommandError', () => {
    it('includes a suggestion when one exists', () => {
        expect(
            buildUnknownCommandError('mcp subcommand', 'inspec', ['inspect', 'call']).message,
        ).toBe('Unknown mcp subcommand: inspec. Did you mean `inspect`?');
    });
});
