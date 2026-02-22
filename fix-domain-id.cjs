const fs = require('fs');

function processFile(path, domainExpr) {
    let content = fs.readFileSync(path, 'utf8');

    // 1. logAudit(...) -> logAudit(domainExpr, ...)
    const logAuditRegex = /logAudit\(\s*'/g;
    content = content.replace(logAuditRegex, `logAudit(${domainExpr}, '`);

    // 2. createXXX({ ... }) -> createXXX({ domainId: domainExpr, ... })
    content = content.replace(/createContentItem\(\{\s*/g, `createContentItem({ domainId: ${domainExpr}, `);
    content = content.replace(/createContentType\(\{\s*/g, `createContentType({ domainId: ${domainExpr}, `);
    content = content.replace(/createWebhook\(\{\s*/g, `createWebhook({ domainId: ${domainExpr}, `);
    content = content.replace(/createApiKey\(\{\s*/g, `createApiKey({ domainId: ${domainExpr}, `);

    // 3. listXXX() -> listXXX(domainExpr)
    // listContentItems might have a param or be empty
    content = content.replace(/listContentItems\(\s*\)/g, `listContentItems(${domainExpr})`);
    content = content.replace(/listContentItems\((?!d)([^)]+)\)/g, `listContentItems(${domainExpr}, $1)`); // safe given our variables don't start with d

    content = content.replace(/listContentTypes\(\s*\)/g, `listContentTypes(${domainExpr})`);
    content = content.replace(/listWebhooks\(\s*\)/g, `listWebhooks(${domainExpr})`);
    content = content.replace(/listApiKeys\(\s*\)/g, `listApiKeys(${domainExpr})`);

    // listAuditLogs might have filters
    content = content.replace(/listAuditLogs\(\s*(.*?)\)/g, (match, p1) => {
        if (p1.trim().length === 0) return `listAuditLogs(${domainExpr})`;
        if (p1.includes('domainId')) return match;
        return `listAuditLogs(${domainExpr}, ${p1})`;
    });

    // 4. Update/Delete/GetById -> ID is the first arg, we add domainExpr as the second
    const funcs = ['getContentItem', 'updateContentItem', 'deleteContentItem', 'rollbackContentItem',
        'getContentType', 'getContentTypeBySlug', 'updateContentType', 'deleteContentType',
        'getWebhookById', 'updateWebhook', 'deleteWebhook',
        'revokeApiKey', 'rotateApiKey'];

    for (const func of funcs) {
        // Find func(param1, param2)
        const regex = new RegExp(`\\b${func}\\(([^,)]+)(,\\s*(.*?))?\\)`, 'g');
        content = content.replace(regex, (match, p1, p2, p3) => {
            if (p1.trim() === 'context.principal?.domainId ?? 1' || p1.trim() === '1') return match;

            // Fastify and Graphql often destructure ID into const { id }... so it matches `id`.
            if (p3) {
                return `${func}(${p1}, ${domainExpr}, ${p3})`;
            } else {
                return `${func}(${p1}, ${domainExpr})`;
            }
        });
    }

    fs.writeFileSync(path, content, 'utf8');
    console.log(`Processed ${path}`);
}

processFile('./src/api/routes.ts', '(request as any).authPrincipal?.domainId ?? 1');
processFile('./src/graphql/resolvers.ts', 'context.principal?.domainId ?? 1');
processFile('./src/mcp/server.ts', '1');
