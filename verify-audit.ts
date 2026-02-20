
const API_URL = 'http://localhost:4000/api';

async function verifyAuditLogging() {
    console.log('🚀 Starting Audit Logging Verification...');

    try {
        // 1. Setup: Create a Content Type
        console.log('\n--- Action 1: Create Content Type ---');
        const typeRes = await fetch(`${API_URL}/content-types`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Audit Test Type',
                slug: `audit-test-${Date.now()}`,
                schema: JSON.stringify({ type: 'object' })
            })
        });
        const typeData = await typeRes.json();
        const typeId = typeData.data.id;
        console.log(`Created Content Type ID: ${typeId}`);

        // 2. Setup: Create Content Item
        console.log('\n--- Action 2: Create Content Item ---');
        const itemRes = await fetch(`${API_URL}/content-items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contentTypeId: typeId,
                data: JSON.stringify({ title: 'Audit Item' }),
                status: 'draft'
            })
        });
        const itemData = await itemRes.json();
        const itemId = itemData.data.id;
        console.log(`Created Item ID: ${itemId}`);

        // 3. Setup: Update Content Item
        console.log('\n--- Action 3: Update Content Item ---');
        await fetch(`${API_URL}/content-items/${itemId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                data: JSON.stringify({ title: 'Audit Item Updated' }),
                status: 'published'
            })
        });
        console.log('Item Updated');

        // 4. Verify Audit Logs
        console.log('\n--- Verifying Logs ---');
        // Give a little time for logs to be written if async (though we awaited them)

        const logsRes = await fetch(`${API_URL}/audit-logs?limit=10`);
        const logsData = await logsRes.json();
        const logs = logsData.data;

        console.log(`Retrieved ${logs.length} logs.`);

        const createTypeLog = logs.find((l: any) => l.entityType === 'content_type' && l.entityId === typeId && l.action === 'create');
        const createItemLog = logs.find((l: any) => l.entityType === 'content_item' && l.entityId === itemId && l.action === 'create');
        const updateItemLog = logs.find((l: any) => l.entityType === 'content_item' && l.entityId === itemId && l.action === 'update');

        if (createTypeLog) console.log('✅ Content Type Creation Logged');
        else console.error('❌ Content Type Creation NOT Logged');

        if (createItemLog) console.log('✅ Content Item Creation Logged');
        else console.error('❌ Content Item Creation NOT Logged');

        if (updateItemLog) console.log('✅ Content Item Update Logged');
        else console.error('❌ Content Item Update NOT Logged');

        if (createTypeLog && createItemLog && updateItemLog) {
            console.log('✨ Audit Logging Verification Passed ✨');
        } else {
            console.error('❌ Verification Failed');
            process.exit(1);
        }

    } catch (error) {
        console.error('❌ Verification Failed:', error);
        process.exit(1);
    }
}

verifyAuditLogging();
