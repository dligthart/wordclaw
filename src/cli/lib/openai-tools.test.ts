import { describe, expect, it } from 'vitest';

import { buildOpenAiFunctionTools } from './openai-tools.js';

describe('buildOpenAiFunctionTools', () => {
    it('maps MCP tool definitions into OpenAI function tools', () => {
        const tools = buildOpenAiFunctionTools([
            {
                name: 'create_content_item',
                description: 'Create a new content item',
                inputSchema: {
                    type: 'object',
                    properties: {
                        contentTypeId: { type: 'number' },
                        data: { type: 'object' },
                    },
                    required: ['contentTypeId', 'data'],
                },
            },
        ]);

        expect(tools).toEqual([
            {
                type: 'function',
                name: 'create_content_item',
                description: 'Create a new content item',
                parameters: {
                    type: 'object',
                    properties: {
                        contentTypeId: { type: 'number' },
                        data: { type: 'object' },
                    },
                    required: ['contentTypeId', 'data'],
                },
                strict: false,
            },
        ]);
    });

    it('falls back to an empty object schema when an MCP tool exposes no input schema', () => {
        const tools = buildOpenAiFunctionTools([
            {
                name: 'list_content_types',
                description: 'List content types',
            },
        ]);

        expect(tools).toEqual([
            {
                type: 'function',
                name: 'list_content_types',
                description: 'List content types',
                parameters: {
                    type: 'object',
                    properties: {},
                    additionalProperties: false,
                },
                strict: false,
            },
        ]);
    });
});
