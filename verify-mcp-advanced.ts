import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';

type JsonRpcRequest = {
    jsonrpc: '2.0';
    id: number;
    method: string;
    params: Record<string, unknown>;
};

type JsonRpcResponse = {
    jsonrpc: '2.0';
    id?: number;
    result?: unknown;
    error?: { message?: string };
    method?: string;
    params?: Record<string, unknown>;
};

type PendingRequest = {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
};

class MCPClient {
    private process: ChildProcessWithoutNullStreams;
    private requestCounter = 0;
    private pendingRequests = new Map<number, PendingRequest>();
    private buffer = '';

    constructor(scriptPath: string) {
        this.process = spawn('npx', ['tsx', scriptPath], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        this.process.stdout.on('data', (data: Buffer) => this.handleData(data));
        this.process.stderr.on('data', (data: Buffer) => console.error(`[MCP ERR] ${data.toString()}`));
    }

    private handleData(data: Buffer) {
        this.buffer += data.toString();
        const lines = this.buffer.split('\n');

        while (lines.length > 1) {
            const line = lines.shift();
            if (!line || !line.trim()) {
                continue;
            }

            try {
                const response = JSON.parse(line) as JsonRpcResponse;
                if (response.id !== undefined) {
                    const pending = this.pendingRequests.get(response.id);
                    if (pending) {
                        this.pendingRequests.delete(response.id);
                        if (response.error) {
                            pending.reject(response.error);
                        } else {
                            pending.resolve(response.result);
                        }
                    }
                } else if (response.method === 'notifications/message') {
                    console.log(`[MCP LOG] ${response.params?.message}`);
                }
            } catch {
                // Ignore non-JSON lines from child process
            }
        }

        this.buffer = lines.join('\n');
    }

    send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        this.requestCounter += 1;
        const id = this.requestCounter;
        const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            this.process.stdin.write(JSON.stringify(request) + '\n');
        });
    }

    async stop() {
        this.process.kill();
    }
}

function expectObject(value: unknown, context: string): Record<string, unknown> {
    if (!value || typeof value !== 'object') {
        throw new Error(`${context} returned an invalid object payload`);
    }

    return value as Record<string, unknown>;
}

function extractFirstText(result: unknown, context: string): string {
    const payload = expectObject(result, context);
    const content = payload.content;
    if (!Array.isArray(content) || content.length === 0) {
        throw new Error(`${context} returned no content`);
    }

    const first = content[0] as { text?: string };
    if (!first?.text) {
        throw new Error(`${context} returned invalid text content`);
    }

    return first.text;
}

async function main() {
    const mcpScript = path.join(process.cwd(), 'src', 'mcp', 'index.ts');
    console.log('🚀 Starting Advanced MCP Verification...');

    const client = new MCPClient(mcpScript);
    let exitCode = 0;

    try {
        console.log('\n--- 1. Initializing ---');
        await client.send('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'verify-mcp-advanced', version: '1.0.0' }
        });
        console.log('✅ Initialized');

        console.log('\n--- 2. Checking Tools ---');
        const listToolsResult = expectObject(await client.send('tools/list'), 'tools/list');
        const tools = Array.isArray(listToolsResult.tools) ? listToolsResult.tools : [];
        const toolNames = tools
            .map((tool) => (tool as { name?: string }).name)
            .filter((name): name is string => typeof name === 'string');

        const expectedTools = [
            'create_content_type', 'list_content_types', 'get_content_type', 'update_content_type', 'delete_content_type',
            'create_content_item', 'create_content_items_batch', 'get_content_items', 'get_content_item',
            'update_content_item', 'update_content_items_batch', 'delete_content_item', 'delete_content_items_batch',
            'get_content_item_versions', 'rollback_content_item', 'get_audit_logs'
        ];

        const missing = expectedTools.filter((tool) => !toolNames.includes(tool));
        if (missing.length > 0) {
            throw new Error(`Missing tools: ${missing.join(', ')}`);
        }
        console.log('✅ All expected tools present');

        console.log('\n--- 3. Dry-Run Create Content Type ---');
        const dryRunTypeText = extractFirstText(await client.send('tools/call', {
            name: 'create_content_type',
            arguments: {
                name: 'MCP Verified Type',
                slug: 'mcp-verified',
                schema: JSON.stringify({ type: 'object' }),
                dryRun: true
            }
        }), 'dry-run create_content_type');

        if (!dryRunTypeText.includes('[Dry Run]')) {
            throw new Error('Dry run failed');
        }
        console.log('✅ Dry run confirmed:', dryRunTypeText);

        console.log('\n--- 4. Create Content Type ---');
        const createTypeText = extractFirstText(await client.send('tools/call', {
            name: 'create_content_type',
            arguments: {
                name: 'MCP Verified Type',
                slug: `mcp-verified-${Date.now()}`,
                schema: JSON.stringify({ type: 'object' })
            }
        }), 'create_content_type');

        console.log('Response:', createTypeText);

        const typeIdMatch = createTypeText.match(/ID: (\d+)/);
        if (!typeIdMatch) {
            throw new Error('Could not parse Type ID');
        }
        const typeId = Number.parseInt(typeIdMatch[1], 10);
        console.log(`✅ Created Type ID: ${typeId}`);

        console.log('\n--- 5. Create Content Item ---');
        const createItemText = extractFirstText(await client.send('tools/call', {
            name: 'create_content_item',
            arguments: {
                contentTypeId: typeId,
                data: JSON.stringify({ title: 'Hello MCP' }),
                status: 'draft'
            }
        }), 'create_content_item');

        const itemIdMatch = createItemText.match(/ID: (\d+)/);
        if (!itemIdMatch) {
            throw new Error('Could not parse Item ID');
        }

        const itemId = Number.parseInt(itemIdMatch[1], 10);
        console.log(`✅ Created Item ID: ${itemId}`);

        console.log('\n--- 6. Update Item to v2 ---');
        const updateItemText = extractFirstText(await client.send('tools/call', {
            name: 'update_content_item',
            arguments: {
                id: itemId,
                data: JSON.stringify({ title: 'Hello MCP v2' }),
                status: 'published'
            }
        }), 'update_content_item');

        console.log('Response:', updateItemText);
        if (!updateItemText.includes('version 2')) {
            throw new Error('Versioning failed');
        }
        console.log('✅ Updated to v2');

        console.log('\n--- 7. Get Versions ---');
        const versionsText = extractFirstText(await client.send('tools/call', {
            name: 'get_content_item_versions',
            arguments: { id: itemId }
        }), 'get_content_item_versions');

        const versions = JSON.parse(versionsText) as unknown[];
        console.log('Versions:', versions.length);
        if (versions.length < 1) {
            throw new Error('No versions found');
        }
        console.log('✅ Versions retrieved');

        console.log('\n--- 8. Get Audit Logs ---');
        const logsText = extractFirstText(await client.send('tools/call', {
            name: 'get_audit_logs',
            arguments: { limit: 5 }
        }), 'get_audit_logs');

        const logsPayload = JSON.parse(logsText) as { items?: unknown[] };
        const logs = Array.isArray(logsPayload.items) ? logsPayload.items : [];
        if (logs.length < 3) {
            throw new Error('Not enough logs found');
        }
        console.log('✅ Audit logs retrieved');

        console.log('\n--- 9. Dry-Run Delete Item ---');
        const dryDeleteText = extractFirstText(await client.send('tools/call', {
            name: 'delete_content_item',
            arguments: { id: itemId, dryRun: true }
        }), 'delete_content_item');

        if (!dryDeleteText.includes('[Dry Run]')) {
            throw new Error('Dry delete failed');
        }
        console.log('✅ Dry delete confirmed');

        console.log('\n✨ MCP Advanced Verification Passed ✨');
    } catch (error) {
        exitCode = 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error('\n❌ Verification Failed:', message);
    } finally {
        await client.stop();
        process.exit(exitCode);
    }
}

main();
