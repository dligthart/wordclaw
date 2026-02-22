import fs from 'fs';
import path from 'path';

const filePath = path.join(process.cwd(), 'src', 'mcp', 'server.ts');
let content = fs.readFileSync(filePath, 'utf8');

const imports = `import { PolicyEngine } from '../services/policy.js';
import { buildOperationContext } from '../services/policy-adapters.js';

function withMCPPolicy(operation: string, extractResource: (args: any) => any, handler: any) {
    return async (args: any, extra: any) => {
        const principal = { keyId: 'mcp-local', scopes: new Set(['admin']), source: 'local' };
        const resource = extractResource(args) || { type: 'system' };
        const operationContext = buildOperationContext('mcp', principal, operation, resource);
        const decision = await PolicyEngine.evaluate(operationContext);
        if (decision.outcome !== 'allow') {
            return err(\`\${decision.code}: Access Denied by Policy. \${decision.remediation || ''}\`);
        }
        return handler(args, extra);
    };
}
`;

content = content.replace("const server = new McpServer({", imports + "\nconst server = new McpServer({");

const mappings: Record<string, [string, string]> = {
    list_content_types: ["'content.read'", "() => ({ type: 'system' })"],
    get_content_type: ["'content.read'", "(args) => ({ type: 'content_type', id: args.id })"],
    create_content_type: ["'content.write'", "() => ({ type: 'system' })"],
    update_content_type: ["'content.write'", "(args) => ({ type: 'content_type', id: args.id })"],
    delete_content_type: ["'content.write'", "(args) => ({ type: 'content_type', id: args.id })"],
    list_content_items: ["'content.read'", "(args) => ({ type: 'system', contentTypeId: args.contentTypeId })"],
    get_content_item: ["'content.read'", "(args) => ({ type: 'content_item', id: args.id })"],
    get_content_item_versions: ["'content.read'", "(args) => ({ type: 'content_item', id: args.id })"],
    create_content_item: ["'content.write'", "(args) => ({ type: 'content_type', id: args.contentTypeId })"],
    create_content_items_batch: ["'content.write'", "() => ({ type: 'batch' })"],
    update_content_item: ["'content.write'", "(args) => ({ type: 'content_item', id: args.id })"],
    update_content_items_batch: ["'content.write'", "() => ({ type: 'batch' })"],
    delete_content_item: ["'content.write'", "(args) => ({ type: 'content_item', id: args.id })"],
    delete_content_items_batch: ["'content.write'", "() => ({ type: 'batch' })"],
    rollback_content_item: ["'content.write'", "(args) => ({ type: 'content_item', id: args.id })"],
    list_audit_logs: ["'audit.read'", "() => ({ type: 'system' })"],
    list_api_keys: ["'apikey.list'", "() => ({ type: 'system' })"],
    create_api_key: ["'apikey.write'", "() => ({ type: 'system' })"],
    rotate_api_key: ["'apikey.write'", "(args) => ({ type: 'apikey', id: args.id })"],
    revoke_api_key: ["'apikey.write'", "(args) => ({ type: 'apikey', id: args.id })"],
    list_webhooks: ["'webhook.list'", "() => ({ type: 'system' })"],
    get_webhook: ["'webhook.list'", "(args) => ({ type: 'webhook', id: args.id })"],
    create_webhook: ["'webhook.write'", "() => ({ type: 'system' })"],
    update_webhook: ["'webhook.write'", "(args) => ({ type: 'webhook', id: args.id })"],
    delete_webhook: ["'webhook.write'", "(args) => ({ type: 'webhook', id: args.id })"],
};

for (const [key, [op, fn]] of Object.entries(mappings)) {
    // Find server.tool(\n    'key',\n ... \n    async (args) => {
    // Replace async (args) => { with withMCPPolicy('op', fn, async (args) => {
    // This is tricky with regex because of varying tool schema shapes.
    // Instead we can match `async ({` or `async (args)` which is the handler.
    // Usually it's the last argument.
}

// A more robust approach line by line
let lines = content.split('\n');
let insideTool = false;
let currentToolName = '';
let openParens = 0;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes("server.tool(")) {
        insideTool = true;
        currentToolName = lines[i + 1].trim().replace(/['",]/g, '');
    }

    if (insideTool && mappings[currentToolName] && (line.includes('async ({') || line.includes('async () =>') || line.includes('async (args)'))) {
        const [op, fn] = mappings[currentToolName];
        lines[i] = line.replace(/async\s*\(/, `withMCPPolicy(${op}, ${fn}, async (`).replace(/async\s*\{/, `withMCPPolicy(${op}, ${fn}, async ({`);
    }

    // We must find the closing parenthesis for the tool to append `)`
    if (insideTool && line.trim() === ')' || line.trim() === ');') {
        if (mappings[currentToolName]) {
            lines[i] = lines[i].replace(')', '))');
        }
        insideTool = false;
        currentToolName = '';
    }
}

fs.writeFileSync(filePath, lines.join('\n'));
console.log('MCP Tools updated!');
