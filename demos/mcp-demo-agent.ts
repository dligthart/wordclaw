/**
 * MCP demo agent for WordClaw.
 *
 * Run from the repo root:
 *   npx tsx demos/mcp-demo-agent.ts inspect
 *   npx tsx demos/mcp-demo-agent.ts smoke
 *   npx tsx demos/mcp-demo-agent.ts call list_content_types '{}'
 *   npx tsx demos/mcp-demo-agent.ts prompt workflow-guidance
 *   npx tsx demos/mcp-demo-agent.ts resource content://types
 *
 * Note: WordClaw's MCP transport is stdio. This demo agent starts its own local
 * MCP server child process instead of attaching to a separately running one.
 */

import { parseJsonValue } from '../src/cli/lib/args.js';
import {
    inspectCapabilities,
    resolveRepoRoot,
    runSmoke,
    WordClawMcpClient,
} from '../src/cli/lib/mcp-client.js';

const HEADER = 'WordClaw MCP Demo Agent';

function printUsage() {
    console.log(`${HEADER}

Usage:
  npx tsx demos/mcp-demo-agent.ts inspect
  npx tsx demos/mcp-demo-agent.ts smoke
  npx tsx demos/mcp-demo-agent.ts call <toolName> [jsonArgs]
  npx tsx demos/mcp-demo-agent.ts prompt <promptName> [jsonArgs]
  npx tsx demos/mcp-demo-agent.ts resource <uri>

Examples:
  npx tsx demos/mcp-demo-agent.ts inspect
  npx tsx demos/mcp-demo-agent.ts call list_content_types
  npx tsx demos/mcp-demo-agent.ts call get_content_items '{"status":"draft","limit":5}'
  npx tsx demos/mcp-demo-agent.ts prompt content-generation-template '{"contentTypeId":"12","topic":"AI governance"}'
  npx tsx demos/mcp-demo-agent.ts resource content://types
`);
}

function parseJsonArg(raw: string | undefined): Record<string, unknown> {
    if (!raw) {
        return {};
    }

    const parsed = parseJsonValue(raw, 'JSON arguments');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Expected JSON object arguments.');
    }

    return parsed as Record<string, unknown>;
}

async function main() {
    const repoRoot = resolveRepoRoot();
    const command = process.argv[2];

    if (!command || ['-h', '--help', 'help'].includes(command)) {
        printUsage();
        return;
    }

    const client = new WordClawMcpClient(repoRoot);

    try {
        await client.initialize();

        if (command === 'inspect') {
            const discovery = await inspectCapabilities(client);
            console.log('\n=== Discovery ===');
            console.log(`Tools (${discovery.tools.length})`);
            for (const tool of discovery.tools) {
                console.log(`- ${tool.name}${tool.description ? `: ${tool.description}` : ''}`);
            }

            console.log(`\nResources (${discovery.resources.length})`);
            for (const resource of discovery.resources) {
                const label = resource.uri ?? resource.name ?? 'unknown';
                console.log(`- ${label}${resource.description ? `: ${resource.description}` : ''}`);
            }

            console.log(`\nPrompts (${discovery.prompts.length})`);
            for (const prompt of discovery.prompts) {
                console.log(`- ${prompt.name}${prompt.description ? `: ${prompt.description}` : ''}`);
            }
            return;
        }

        if (command === 'call') {
            const toolName = process.argv[3];
            if (!toolName) {
                throw new Error('Missing tool name for call command.');
            }

            const result = await client.callTool(toolName, parseJsonArg(process.argv[4]));
            console.log(`\n=== Tool: ${toolName} ===`);
            console.log(result.rawText);
            if (result.isError) {
                process.exitCode = 1;
            }
            return;
        }

        if (command === 'prompt') {
            const promptName = process.argv[3];
            if (!promptName) {
                throw new Error('Missing prompt name for prompt command.');
            }

            const result = await client.getPrompt(promptName, parseJsonArg(process.argv[4]));
            console.log(`\n=== Prompt: ${promptName} ===`);
            console.log(result);
            return;
        }

        if (command === 'resource') {
            const uri = process.argv[3];
            if (!uri) {
                throw new Error('Missing resource URI for resource command.');
            }

            const result = await client.readResource(uri);
            console.log(`\n=== Resource: ${uri} ===`);
            console.log(result);
            return;
        }

        if (command === 'smoke') {
            const summary = await runSmoke(client);
            console.log('\n=== Smoke Summary ===');
            for (const result of summary.results) {
                const label =
                    result.status === 'passed'
                        ? 'PASS'
                        : result.status === 'warned'
                            ? 'WARN'
                            : 'FAIL';
                console.log(`[${label}] ${result.name}: ${result.detail}`);
            }

            if (summary.failedCount > 0) {
                throw new Error(
                    `${summary.failedCount} smoke suite(s) failed: ${summary.results
                        .filter((result) => result.status === 'failed')
                        .map((result) => result.name)
                        .join(', ')}`,
                );
            }
            return;
        }

        throw new Error(`Unknown command: ${command}`);
    } finally {
        await client.stop();
    }
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n${HEADER} failed: ${message}`);
    process.exit(1);
});
