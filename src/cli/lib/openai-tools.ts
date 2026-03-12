import type { ToolDefinition } from './mcp-client.js';

export type OpenAiFunctionTool = {
    type: 'function';
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict: boolean;
};

function cloneSchema(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {
            type: 'object',
            properties: {},
            additionalProperties: false,
        };
    }

    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export function buildOpenAiFunctionTools(
    tools: ToolDefinition[],
): OpenAiFunctionTool[] {
    return tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description ?? '',
        parameters: cloneSchema(tool.inputSchema),
        strict: false,
    }));
}
