
import { spawn } from 'child_process';
import path from 'path';

const mcpScript = path.join(process.cwd(), 'src', 'mcp', 'index.ts');

console.log('🚀 Starting MCP Server Verification...');
console.log(`Script: ${mcpScript}`);

const serverProcess = spawn('npx', ['tsx', mcpScript], {
    stdio: ['pipe', 'pipe', 'inherit'] // pipe stdin/stdout, inherit stderr for logs
});

const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
            name: "verify-mcp",
            version: "1.0.0"
        }
    }
};

let buffer = '';

serverProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');

    // Process all complete lines
    while (lines.length > 1) {
        const line = lines.shift();
        if (line) {
            try {
                const response = JSON.parse(line);
                console.log('📥 Received:', JSON.stringify(response, null, 2));

                if (response.id === 1 && response.result) {
                    console.log('✅ Initialize successful!');

                    // List Tools
                    const listToolsReq = {
                        jsonrpc: "2.0",
                        id: 2,
                        method: "tools/list",
                        params: {}
                    };
                    console.log('📤 Sending list_tools...');
                    serverProcess.stdin.write(JSON.stringify(listToolsReq) + '\n');
                } else if (response.id === 2 && response.result) {
                    console.log('✅ List Tools successful!');
                    const tools = response.result.tools;
                    console.log('Tools found:', tools.map((t: any) => t.name).join(', '));

                    if (!tools.some((t: any) => t.name === 'create_content_type')) {
                        console.error('❌ create_content_type tool MISSING.');
                        process.exit(1);
                    }

                    // List Prompts
                    const listPromptsReq = {
                        jsonrpc: "2.0",
                        id: 3,
                        method: "prompts/list",
                        params: {}
                    };
                    console.log('📤 Sending list_prompts...');
                    serverProcess.stdin.write(JSON.stringify(listPromptsReq) + '\n');

                } else if (response.id === 3 && response.result) {
                    console.log('✅ List Prompts successful!');
                    const prompts = response.result.prompts;
                    console.log('Prompts found:', prompts.map((p: any) => p.name).join(', '));

                    if (prompts.some((p: any) => p.name === 'content-generation-template')) {
                        console.log('✅ content-generation-template prompt found.');
                    } else {
                        console.error('❌ content-generation-template prompt MISSING.');
                        process.exit(1);
                    }

                    console.log('✨ MCP Verification Passed ✨');
                    serverProcess.kill();
                    process.exit(0);
                }
            } catch (e) {
                // Ignore non-JSON lines (though stdio server should only output JSON lines)
                console.log('Log:', line);
            }
        }
    }
    buffer = lines.join('\n');
});

console.log('📤 Sending initialize...');
serverProcess.stdin.write(JSON.stringify(request) + '\n');

serverProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
        console.error(`MCP Server exited with code ${code}`);
        process.exit(code);
    }
});
