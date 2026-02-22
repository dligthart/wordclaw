const fs = require('fs');

function fixResolvers(path) {
    let content = fs.readFileSync(path, 'utf8');

    // Fix `context.principal` to `(context as any)?.principal`
    content = content.replace(/context\.principal\?\.domainId/g, '(context as any)?.principal?.domainId');

    // Fix db.insert(contentItems)
    content = content.replace(/await\s+(db|tx)\.insert\(contentItems\)\.values\(\{/g, `await $1.insert(contentItems).values({ domainId: (context as any)?.principal?.domainId ?? 1,`);

    // Fix db.insert(contentTypes)
    content = content.replace(/await\s+(db|tx)\.insert\(contentTypes\)\.values\(\{/g, `await $1.insert(contentTypes).values({ domainId: (context as any)?.principal?.domainId ?? 1,`);

    fs.writeFileSync(path, content, 'utf8');
    console.log(`Processed ${path}`);
}

function fixServers(path) {
    let content = fs.readFileSync(path, 'utf8');

    // Fix db.insert(contentItems)
    content = content.replace(/await\s+(db|tx)\.insert\(contentItems\)\.values\(\{/g, `await $1.insert(contentItems).values({ domainId: 1,`);

    // Fix db.insert(contentTypes)
    content = content.replace(/await\s+(db|tx)\.insert\(contentTypes\)\.values\(\{/g, `await $1.insert(contentTypes).values({ domainId: 1,`);

    fs.writeFileSync(path, content, 'utf8');
    console.log(`Processed ${path}`);
}

fixResolvers('./src/graphql/resolvers.ts');
fixServers('./src/mcp/server.ts');
