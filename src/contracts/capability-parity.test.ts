import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'graphql';

import { schema } from '../graphql/schema.js';
import { capabilityMatrix, dryRunCapabilities } from './capability-matrix.js';
import type { RestMethod } from './capability-matrix.js';

type GraphqlSurface = {
    queries: Set<string>;
    queryArgs: Map<string, Set<string>>;
    mutations: Set<string>;
    mutationArgs: Map<string, Set<string>>;
};

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readSource(filePath: string): string {
    return fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');
}

function extractRestRoutes(source: string): Set<string> {
    const routes = new Set<string>();
    const regex = /server\.(get|post|put|delete)\(\s*'([^']+)'/g;

    let match: RegExpExecArray | null = regex.exec(source);
    while (match) {
        routes.add(`${match[1].toUpperCase()} ${match[2]}`);
        match = regex.exec(source);
    }

    return routes;
}

function extractMcpTools(source: string): Set<string> {
    const tools = new Set<string>();
    const regex = /server\.tool\(\s*'([^']+)'/g;

    let match: RegExpExecArray | null = regex.exec(source);
    while (match) {
        tools.add(match[1]);
        match = regex.exec(source);
    }

    return tools;
}

function extractGraphqlSurface(schemaSource: string): GraphqlSurface {
    const ast = parse(schemaSource);
    const queries = new Set<string>();
    const queryArgs = new Map<string, Set<string>>();
    const mutations = new Set<string>();
    const mutationArgs = new Map<string, Set<string>>();

    for (const definition of ast.definitions) {
        if (definition.kind !== 'ObjectTypeDefinition') {
            continue;
        }

        if (definition.name.value === 'Query') {
            for (const field of definition.fields || []) {
                const argNames = new Set((field.arguments || []).map((argument) => argument.name.value));
                queries.add(field.name.value);
                queryArgs.set(field.name.value, argNames);
            }
        }

        if (definition.name.value === 'Mutation') {
            for (const field of definition.fields || []) {
                const argNames = new Set((field.arguments || []).map((argument) => argument.name.value));
                mutations.add(field.name.value);
                mutationArgs.set(field.name.value, argNames);
            }
        }
    }

    return {
        queries,
        queryArgs,
        mutations,
        mutationArgs
    };
}

function getServerBlock(source: string, callPattern: RegExp): string | null {
    const match = callPattern.exec(source);
    if (!match || typeof match.index !== 'number') {
        return null;
    }

    const start = match.index;
    const tail = source.slice(start + 1);
    const nextServerCallOffset = tail.search(/\n\s*server\./);
    if (nextServerCallOffset === -1) {
        return source.slice(start);
    }

    return source.slice(start, start + 1 + nextServerCallOffset);
}

function getRestRouteBlock(source: string, method: RestMethod, routePath: string): string | null {
    const pattern = new RegExp(
        `server\\.${method.toLowerCase()}\\(\\s*'${escapeRegExp(routePath)}'`,
        'm'
    );

    return getServerBlock(source, pattern);
}

function getMcpToolBlock(source: string, toolName: string): string | null {
    const pattern = new RegExp(`server\\.tool\\(\\s*'${escapeRegExp(toolName)}'`, 'm');
    return getServerBlock(source, pattern);
}

describe('Capability Parity Matrix', () => {
    const routesSource = readSource('src/api/routes.ts');
    const mcpSource = readSource('src/mcp/server.ts');
    const restRoutes = extractRestRoutes(routesSource);
    const mcpTools = extractMcpTools(mcpSource);
    const graphqlSurface = extractGraphqlSurface(schema);

    it('contains unique capability IDs', () => {
        const ids = capabilityMatrix.map((capability) => capability.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('keeps REST, GraphQL, and MCP operations in sync', () => {
        for (const capability of capabilityMatrix) {
            expect(
                restRoutes.has(`${capability.rest.method} ${capability.rest.path}`),
                `Missing REST route for ${capability.id}`
            ).toBe(true);

            if (capability.graphql.operation === 'Query') {
                expect(
                    graphqlSurface.queries.has(capability.graphql.field),
                    `Missing GraphQL query for ${capability.id}`
                ).toBe(true);
            } else {
                expect(
                    graphqlSurface.mutations.has(capability.graphql.field),
                    `Missing GraphQL mutation for ${capability.id}`
                ).toBe(true);
            }

            expect(
                mcpTools.has(capability.mcp.tool),
                `Missing MCP tool for ${capability.id}`
            ).toBe(true);
        }
    });

    it('enforces dry-run support parity for write capabilities', () => {
        for (const capability of capabilityMatrix) {
            if (!dryRunCapabilities.has(capability.id)) {
                continue;
            }

            const routeBlock = getRestRouteBlock(routesSource, capability.rest.method, capability.rest.path);
            expect(routeBlock, `Missing route block for ${capability.id}`).not.toBeNull();
            expect(
                routeBlock?.includes('querystring: DryRunQuery')
                || routeBlock?.includes(`mode: Type.Optional(Type.Literal('dry_run'))`),
                `REST dry-run missing for ${capability.id}`
            ).toBe(true);

            const toolBlock = getMcpToolBlock(mcpSource, capability.mcp.tool);
            expect(toolBlock, `Missing MCP tool block for ${capability.id}`).not.toBeNull();
            expect(
                toolBlock?.includes('dryRun:'),
                `MCP dry-run missing for ${capability.id}`
            ).toBe(true);

            expect(
                capability.graphql.operation,
                `GraphQL dry-run capabilities must map to mutations (${capability.id})`
            ).toBe('Mutation');

            const args = graphqlSurface.mutationArgs.get(capability.graphql.field);
            expect(args, `Missing GraphQL mutation args for ${capability.id}`).toBeDefined();
            expect(
                args?.has('dryRun'),
                `GraphQL dry-run missing for ${capability.id}`
            ).toBe(true);
        }
    });

    it('keeps content item filtering contract aligned', () => {
        const contentItemsRouteBlock = getRestRouteBlock(routesSource, 'GET', '/content-items');
        expect(contentItemsRouteBlock?.includes('contentTypeId: Type.Optional(Type.Number())')).toBe(true);
        expect(contentItemsRouteBlock?.includes('status: Type.Optional(Type.String())')).toBe(true);
        expect(contentItemsRouteBlock?.includes('createdAfter: Type.Optional(Type.String())')).toBe(true);
        expect(contentItemsRouteBlock?.includes('createdBefore: Type.Optional(Type.String())')).toBe(true);
        expect(contentItemsRouteBlock?.includes('limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500 }))')).toBe(true);
        expect(contentItemsRouteBlock?.includes('offset: Type.Optional(Type.Number({ minimum: 0 }))')).toBe(true);

        const contentItemsToolBlock = getMcpToolBlock(mcpSource, 'get_content_items');
        expect(contentItemsToolBlock?.includes('contentTypeId: z.number().optional()')).toBe(true);
        expect(contentItemsToolBlock?.includes('status: z.string().optional()')).toBe(true);
        expect(contentItemsToolBlock?.includes('createdAfter: z.string().optional()')).toBe(true);
        expect(contentItemsToolBlock?.includes('createdBefore: z.string().optional()')).toBe(true);
        expect(contentItemsToolBlock?.includes('limit: z.number().optional()')).toBe(true);
        expect(contentItemsToolBlock?.includes('offset: z.number().optional()')).toBe(true);

        const queryArgNames = graphqlSurface.queryArgs.get('contentItems');
        expect(queryArgNames?.has('contentTypeId')).toBe(true);
        expect(queryArgNames?.has('status')).toBe(true);
        expect(queryArgNames?.has('createdAfter')).toBe(true);
        expect(queryArgNames?.has('createdBefore')).toBe(true);
        expect(queryArgNames?.has('limit')).toBe(true);
        expect(queryArgNames?.has('offset')).toBe(true);
    });

    it('keeps audit cursor pagination contract aligned', () => {
        const auditRouteBlock = getRestRouteBlock(routesSource, 'GET', '/audit-logs');
        expect(auditRouteBlock?.includes('cursor: Type.Optional(Type.String())')).toBe(true);

        const auditToolBlock = getMcpToolBlock(mcpSource, 'get_audit_logs');
        expect(auditToolBlock?.includes('cursor: z.string().optional()')).toBe(true);

        const queryArgNames = graphqlSurface.queryArgs.get('auditLogs');
        expect(queryArgNames?.has('cursor')).toBe(true);
    });
});
