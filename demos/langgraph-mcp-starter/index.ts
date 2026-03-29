/**
 * LangGraph + WordClaw MCP starter.
 *
 * Quick examples:
 *   npx tsx demos/langgraph-mcp-starter/index.ts inspect
 *   npx tsx demos/langgraph-mcp-starter/index.ts inspect --transport http --api-key writer
 *   OPENAI_API_KEY=sk-... npx tsx demos/langgraph-mcp-starter/index.ts demo workspace --transport http --api-key writer
 *   OPENAI_API_KEY=sk-... npx tsx demos/langgraph-mcp-starter/index.ts run --task "Inspect WordClaw and list the current content schemas." --transport http --api-key writer
 */

import dotenv from "dotenv";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import {
    inspectCapabilities,
    resolveMcpHttpEndpoint,
    resolveRepoRoot,
    WordClawMcpClient,
    type McpTransportMode,
} from "../../src/cli/lib/mcp-client.js";

dotenv.config();

type Command = "inspect" | "run" | "demo";

type CliOptions = {
    command: Command;
    task?: string;
    demoName?: string;
    model: string;
    transport: McpTransportMode;
    endpoint?: string;
    apiKey?: string;
};

const HEADER = "WordClaw LangGraph MCP Starter";

const DEMO_TASKS: Record<string, string> = {
    workspace: [
        "You are exploring WordClaw as an agent.",
        "First inspect WordClaw.",
        "Then summarize the current actor, the available MCP transports, and the best workspace targets for authoring, review, and paid content if available.",
        "Do not mutate data.",
    ].join(" "),
    authoring: [
        "Inspect WordClaw first.",
        "Then resolve the current authoring workspace and identify the best content schema to write against.",
        "If no schema exists yet, call guide_task for author-content and summarize the memory, task-log, and checkpoint starter patterns.",
        "If a schema is available, explain the required fields and propose the exact next create_content_item payload for a dry-run draft item.",
        "Do not create the item unless I explicitly ask you to.",
    ].join(" "),
    memory: [
        "Inspect WordClaw first.",
        "Then determine whether the workspace already has a suitable memory or checkpoint schema.",
        "If not, call guide_task for author-content and summarize the starter schema-manifest patterns for memory, task-log, and checkpoint content.",
        "If a memory-like schema does exist, explain how to write durable facts with create_content_item dry runs, how to read them back deterministically, and when to use search_semantic_knowledge for fuzzy retrieval.",
        "Do not mutate data unless I explicitly ask you to.",
    ].join(" "),
    review: [
        "Inspect WordClaw first.",
        "Then look for pending review work and summarize the most relevant next review action for the current actor.",
        "Do not approve or reject anything.",
    ].join(" "),
};

function printUsage() {
    console.log(`${HEADER}

Usage:
  npx tsx demos/langgraph-mcp-starter/index.ts inspect [--transport stdio|http] [--mcp-url URL] [--api-key KEY]
  npx tsx demos/langgraph-mcp-starter/index.ts run --task "..." [--model gpt-4o-mini] [--transport stdio|http] [--mcp-url URL] [--api-key KEY]
  npx tsx demos/langgraph-mcp-starter/index.ts demo <workspace|authoring|memory|review> [--model gpt-4o-mini] [--transport stdio|http] [--mcp-url URL] [--api-key KEY]

Examples:
  npx tsx demos/langgraph-mcp-starter/index.ts inspect
  npx tsx demos/langgraph-mcp-starter/index.ts inspect --transport http --api-key writer
  OPENAI_API_KEY=sk-... npx tsx demos/langgraph-mcp-starter/index.ts demo workspace --transport http --api-key writer
  OPENAI_API_KEY=sk-... npx tsx demos/langgraph-mcp-starter/index.ts run --task "Inspect WordClaw and list the current content schemas." --transport http --api-key writer
`);
}

function takeValue(args: string[], index: number, flag: string): string {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${flag}.`);
    }
    return value;
}

function parseArgs(argv: string[]): CliOptions {
    const command = argv[0];
    if (!command || command === "-h" || command === "--help" || command === "help") {
        printUsage();
        process.exit(0);
    }

    if (!["inspect", "run", "demo"].includes(command)) {
        throw new Error(`Unknown command: ${command}`);
    }

    let task: string | undefined;
    let demoName: string | undefined;
    let model = "gpt-4o-mini";
    let transport: McpTransportMode = "stdio";
    let endpoint: string | undefined;
    let apiKey: string | undefined;

    const commandArgs = argv.slice(1);
    if (command === "demo") {
        demoName = commandArgs[0];
        if (!demoName || demoName.startsWith("--")) {
            throw new Error("Missing demo name. Use one of: workspace, authoring, memory, review.");
        }
    }

    for (let index = 0; index < commandArgs.length; index += 1) {
        const arg = commandArgs[index];
        if (!arg.startsWith("--")) {
            continue;
        }

        if (arg === "--task") {
            task = takeValue(commandArgs, index, arg);
            index += 1;
            continue;
        }

        if (arg === "--model") {
            model = takeValue(commandArgs, index, arg);
            index += 1;
            continue;
        }

        if (arg === "--transport") {
            const value = takeValue(commandArgs, index, arg);
            if (value !== "stdio" && value !== "http") {
                throw new Error(`Unsupported transport: ${value}`);
            }
            transport = value;
            index += 1;
            continue;
        }

        if (arg === "--mcp-url") {
            endpoint = takeValue(commandArgs, index, arg);
            index += 1;
            continue;
        }

        if (arg === "--api-key") {
            apiKey = takeValue(commandArgs, index, arg);
            index += 1;
            continue;
        }
    }

    return {
        command: command as Command,
        task,
        demoName,
        model,
        transport,
        endpoint,
        apiKey,
    };
}

function summarizeDiscovery(discovery: Awaited<ReturnType<typeof inspectCapabilities>>) {
    return {
        currentActor: discovery.currentActor,
        deploymentStatus: discovery.deploymentStatus,
        workspaceContext: discovery.workspaceContext,
        tools: discovery.tools.map((tool) => ({
            name: tool.name,
            description: tool.description ?? "",
        })),
        resources: discovery.resources.map((resource) => ({
            uri: resource.uri ?? resource.name ?? "unknown",
            description: resource.description ?? "",
        })),
        prompts: discovery.prompts.map((prompt) => ({
            name: prompt.name,
            description: prompt.description ?? "",
        })),
    };
}

function requireOpenAiKey() {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is required for run/demo commands.");
    }
}

function createWordClawTools(client: WordClawMcpClient) {
    return [
        {
            name: "inspect_wordclaw",
            description:
                "Discover the current WordClaw MCP capabilities, active actor, workspace context, tools, resources, and prompts. Always call this first before mutating content.",
            schema: z.object({}),
            invoke: async () =>
                JSON.stringify(summarizeDiscovery(await inspectCapabilities(client)), null, 2),
        },
        {
            name: "call_wordclaw_tool",
            description:
                "Call a discovered WordClaw MCP tool by name with JSON arguments. Use inspect_wordclaw first so you know which tool name to call.",
            schema: z.object({
                toolName: z.string().describe("Exact MCP tool name exposed by WordClaw."),
                arguments: z
                    .record(z.string(), z.unknown())
                    .optional()
                    .describe("JSON object of arguments for the target tool."),
            }),
            invoke: async ({
                toolName,
                arguments: toolArgs,
            }: {
                toolName: string;
                arguments?: Record<string, unknown>;
            }) => {
                const result = await client.callTool(toolName, toolArgs ?? {});
                return result.rawText;
            },
        },
        {
            name: "read_wordclaw_resource",
            description:
                "Read a WordClaw MCP resource such as system://capabilities, system://current-actor, or system://workspace-context.",
            schema: z.object({
                uri: z.string().describe("Exact MCP resource URI."),
            }),
            invoke: async ({ uri }: { uri: string }) => client.readResource(uri),
        },
        {
            name: "get_wordclaw_prompt",
            description:
                "Fetch a reusable WordClaw MCP prompt template by name. Useful when the server exposes task-specific instructions.",
            schema: z.object({
                promptName: z.string().describe("Exact MCP prompt name."),
                arguments: z
                    .record(z.string(), z.unknown())
                    .optional()
                    .describe("Optional prompt arguments as a JSON object."),
            }),
            invoke: async ({
                promptName,
                arguments: promptArgs,
            }: {
                promptName: string;
                arguments?: Record<string, unknown>;
            }) => client.getPrompt(promptName, promptArgs ?? {}),
        },
    ];
}

async function runAgent(task: string, client: WordClawMcpClient, model: string) {
    const agent = createReactAgent({
        llm: new ChatOpenAI({
            model,
            temperature: 0,
        }),
        tools: createWordClawTools(client),
        checkpointSaver: new MemorySaver(),
    });

    console.log(`\n=== ${HEADER} ===`);
    console.log(`Model: ${model}`);
    console.log(`Task: ${task}\n`);

    const stream = await agent.stream(
        { messages: [new HumanMessage(task)] },
        { configurable: { thread_id: `wordclaw-langgraph-${Date.now()}` } },
    );

    for await (const chunk of stream) {
        if ("agent" in chunk && chunk.agent?.messages?.[0]?.content) {
            console.log(`[agent] ${chunk.agent.messages[0].content}`);
        }

        if ("tools" in chunk && chunk.tools?.messages?.[0]?.content) {
            console.log(`[tool] ${chunk.tools.messages[0].content}`);
        }
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const repoRoot = resolveRepoRoot();
    const client = new WordClawMcpClient(repoRoot, {
        transport: options.transport,
        endpoint:
            options.transport === "http"
                ? resolveMcpHttpEndpoint(options.endpoint)
                : undefined,
        apiKey: options.apiKey,
    });

    try {
        await client.initialize();

        if (options.command === "inspect") {
            console.log(
                JSON.stringify(
                    summarizeDiscovery(await inspectCapabilities(client)),
                    null,
                    2,
                ),
            );
            return;
        }

        requireOpenAiKey();

        if (options.command === "demo") {
            const task = options.demoName ? DEMO_TASKS[options.demoName] : undefined;
            if (!task) {
                throw new Error(
                    `Unknown demo "${options.demoName}". Use one of: ${Object.keys(
                        DEMO_TASKS,
                    ).join(", ")}`,
                );
            }

            await runAgent(task, client, options.model);
            return;
        }

        if (!options.task) {
            throw new Error("Missing --task for run command.");
        }

        await runAgent(options.task, client, options.model);
    } finally {
        await client.stop();
    }
}

main().catch((error) => {
    console.error(`\n${HEADER} failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
