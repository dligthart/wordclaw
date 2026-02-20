
const API_URL = 'http://localhost:4000/api';

async function verifyVersioning() {
    console.log('🚀 Starting Version History & Rollback Verification...');

    try {
        // 1. Setup: Create a Content Type
        console.log('\n--- Setup ---');
        const typeRes = await fetch(`${API_URL}/content-types`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Versioning Test Type',
                slug: `ver-test-${Date.now()}`,
                schema: JSON.stringify({ type: 'object', properties: { title: { type: 'string' } } })
            })
        });
        const typeData = await typeRes.json();
        const typeId = typeData.data.id;
        console.log(`Created Content Type ID: ${typeId}`);

        // 2. Create Content Item (v1)
        console.log('\n📝 Creating Content Item (v1)...');
        const itemRes = await fetch(`${API_URL}/content-items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contentTypeId: typeId,
                data: JSON.stringify({ title: 'Version 1' }),
                status: 'draft'
            })
        });
        const itemData = await itemRes.json();
        const itemId = itemData.data.id;
        console.log(`Created Item ID: ${itemId}, Version: ${itemData.data.version || 1}`);

        // 3. Update Content Item (v2)
        console.log('\n🔄 Updating Content Item (v2)...');
        const updateRes = await fetch(`${API_URL}/content-items/${itemId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                data: JSON.stringify({ title: 'Version 2' }),
                status: 'published'
            })
        });
        const updateData = await updateRes.json();
        console.log(`Updated Item Version: ${updateData.data.version}`);
        // Expect version 2

        // 4. Verify Version History
        console.log('\n📜 Checking Version History...');
        const versionsRes = await fetch(`${API_URL}/content-items/${itemId}/versions`);
        const versionsData = await versionsRes.json();
        console.log(`Found ${versionsData.data.length} versions.`);
        versionsData.data.forEach((v: any) => console.log(`- v${v.version}: ${v.data}`));

        // Expect to see v1 in history
        const v1 = versionsData.data.find((v: any) => v.version === 1 || v.version === itemData.data.version); // itemData.data.version might be null if strictly following schema default without returning it initially, but schema has default 1
        if (v1) {
            console.log('✅ Found v1 in history.');
        } else {
            console.error('❌ v1 NOT found in history.');
            process.exit(1);
        }

        // 5. Rollback to v1
        console.log('\n⏪ Rolling back to v1...');
        const rollbackRes = await fetch(`${API_URL}/content-items/${itemId}/rollback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version: 1 })
        });
        const rollbackData = await rollbackRes.json();
        console.log('Rollback response:', rollbackData);

        // 6. Verify Rollback
        console.log('\n🔍 Verifying Rollback State...');
        const finalItemRes = await fetch(`${API_URL}/content-items/${itemId}`);
        const finalItemData = await finalItemRes.json();
        console.log(`Current Item State: v${finalItemData.data.version}`);
        console.log(`Data: ${finalItemData.data.data}`);

        // Should contain v1 data ("Version 1") but version number should be incremented (v3)
        if (finalItemData.data.data.includes('Version 1') && finalItemData.data.version === 3) {
            console.log('✅ Rollback successful: Data matches v1, Version incremented to v3.');
            console.log('✨ Versioning Verification Passed ✨');
        } else {
            console.error('❌ Rollback verification failed.');
            console.log(`Expected data "Version 1", got "${finalItemData.data.data}"`);
            console.log(`Expected version 3, got ${finalItemData.data.version}`);
            process.exit(1);
        }

    } catch (error) {
        console.error('❌ Verification Failed:', error);
        process.exit(1);
    }
}

verifyVersioning();
