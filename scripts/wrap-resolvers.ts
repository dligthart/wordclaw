import fs from 'fs';
import path from 'path';

const filePath = path.join(process.cwd(), 'src', 'graphql', 'resolvers.ts');
let content = fs.readFileSync(filePath, 'utf8');

const imports = `
import { PolicyEngine } from '../services/policy.js';
import { buildOperationContext } from '../services/policy-adapters.js';

function withPolicy(
    operation: string,
    extractResource: (args: any) => any,
    resolver: any
) {
    return async (parent: any, args: any, context: any, info: any) => {
        const resource = extractResource(args) || { type: 'system' };
        const operationContext = buildOperationContext('graphql', context?.authPrincipal, operation, resource);
        const decision = await PolicyEngine.evaluate(operationContext);
        
        if (decision.outcome !== 'allow') {
            throw toError(
                'Access Denied by Policy',
                decision.code,
                decision.remediation || 'Contact administrator.',
                decision.metadata
            );
        }
        
        return resolver(parent, args, context, info);
    };
}
`;

content = content.replace("export const resolvers = {", imports + "\nexport const resolvers = {");

const mappings: Record<string, [string, string]> = {
    contentTypes: ["'content.read'", "() => ({ type: 'system' })"],
    contentType: ["'content.read'", "(args) => ({ type: 'content_type', id: args.id })"],
    contentItems: ["'content.read'", "(args) => ({ type: 'system' })"],
    contentItem: ["'content.read'", "(args) => ({ type: 'content_item', id: args.id })"],
    contentItemVersions: ["'content.read'", "(args) => ({ type: 'content_item', id: args.id })"],
    auditLogs: ["'audit.read'", "() => ({ type: 'system' })"],
    payments: ["'payment.read'", "() => ({ type: 'system' })"],
    payment: ["'payment.read'", "(args) => ({ type: 'payment', id: args.id })"],
    webhooks: ["'webhook.list'", "() => ({ type: 'system' })"],
    webhook: ["'webhook.list'", "(args) => ({ type: 'webhook', id: args.id })"],

    createContentType: ["'content.write'", "() => ({ type: 'system' })"],
    updateContentType: ["'content.write'", "(args) => ({ type: 'content_type', id: args.id })"],
    deleteContentType: ["'content.write'", "(args) => ({ type: 'content_type', id: args.id })"],
    createContentItem: ["'content.write'", "() => ({ type: 'system' })"],
    createContentItemsBatch: ["'content.write'", "() => ({ type: 'batch' })"],
    updateContentItem: ["'content.write'", "(args) => ({ type: 'content_item', id: args.id })"],
    updateContentItemsBatch: ["'content.write'", "() => ({ type: 'batch' })"],
    deleteContentItem: ["'content.write'", "(args) => ({ type: 'content_item', id: args.id })"],
    deleteContentItemsBatch: ["'content.write'", "() => ({ type: 'batch' })"],
    createWebhook: ["'webhook.write'", "() => ({ type: 'system' })"],
    updateWebhook: ["'webhook.write'", "(args) => ({ type: 'webhook', id: args.id })"],
    deleteWebhook: ["'webhook.write'", "(args) => ({ type: 'webhook', id: args.id })"],
    rollbackContentItem: ["'content.write'", "(args) => ({ type: 'content_item', id: args.id })"],
};

for (const [key, [op, fn]] of Object.entries(mappings)) {
    const rx = new RegExp(`(\\s+${key}:\\s*)(async \\(_parent)`);
    content = content.replace(rx, `$1withPolicy(${op}, ${fn}, $2`);
}

// Add the closing parenthesis for the withPolicy wrapper
const closingMappings = [
    'contentTypes', 'contentType', 'contentItems', 'contentItem', 'contentItemVersions',
    'auditLogs', 'payments', 'payment', 'webhooks', 'webhook',
    'createContentType', 'updateContentType', 'deleteContentType',
    'createContentItem', 'createContentItemsBatch', 'updateContentItem', 'updateContentItemsBatch',
    'deleteContentItem', 'deleteContentItemsBatch', 'createWebhook', 'updateWebhook', 'deleteWebhook', 'rollbackContentItem'
];

let lines = content.split('\n');
let activeWrappers = 0;

for (let i = 0; i < lines.length; i++) {
    for (const key of closingMappings) {
        if (lines[i].includes(`        ${key}: withPolicy(`)) {
            // Find the matching close brace for the block
            let j = i;
            let openBraces = 0;
            let started = false;
            while (j < lines.length) {
                if (lines[j].includes('{')) { openBraces += (lines[j].match(/\{/g) || []).length; started = true; }
                if (lines[j].includes('}')) { openBraces -= (lines[j].match(/\}/g) || []).length; }

                if (started && openBraces === 0) {
                    // This is the closing line
                    lines[j] = lines[j].replace('        },', '        }),');
                    if (!lines[j].includes(',') && lines[j].trim() === '}') lines[j] = '        })';
                    break;
                }
                j++;
            }
        }
    }
}

fs.writeFileSync(filePath, lines.join('\n'));
console.log('Resolvers updated!');
