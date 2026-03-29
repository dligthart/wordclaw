
const API_URL = 'http://localhost:4000/api';

async function verify() {
    console.log('🚀 Starting API Verification...');

    try {
        // Check health
        const healthRes = await fetch(`${API_URL.replace('/api', '')}/health`);
        if (!healthRes.ok) throw new Error('Health check failed');
        console.log('✅ Health check passed');

        // 1. Create Content Type
        console.log('\n📝 Testing Content Types...');
        const createTypeRes = await fetch(`${API_URL}/content-types`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Verification Type',
                slug: 'verification-type-' + Date.now(),
                schema: JSON.stringify({ field: 'string' })
            })
        });
        const createTypeData = await createTypeRes.json();
        if (!createTypeRes.ok) throw new Error(`Create type failed: ${JSON.stringify(createTypeData)}`);
        const typeId = createTypeData.data.id;
        console.log(`✅ Created Content Type (ID: ${typeId})`);

        // 2. Get Content Type
        const getTypeRes = await fetch(`${API_URL}/content-types/${typeId}`);
        const getTypeData = await getTypeRes.json();
        if (!getTypeRes.ok) throw new Error(`Get type failed: ${JSON.stringify(getTypeData)}`);
        console.log(`✅ Fetched Content Type: ${getTypeData.data.name}`);

        // 3. Update Content Type
        const updateTypeRes = await fetch(`${API_URL}/content-types/${typeId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: 'Updated via verification script' })
        });
        const updateTypeData = await updateTypeRes.json();
        if (!updateTypeRes.ok) throw new Error(`Update type failed: ${JSON.stringify(updateTypeData)}`);
        console.log(`✅ Updated Content Type: ${updateTypeData.data.description}`);

        // 4. Create Content Item
        console.log('\n📦 Testing Content Items...');
        const createItemRes = await fetch(`${API_URL}/content-items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contentTypeId: typeId,
                data: JSON.stringify({ field: 'test value' })
            })
        });
        const createItemData = await createItemRes.json();
        if (!createItemRes.ok) throw new Error(`Create item failed: ${JSON.stringify(createItemData)}`);
        const itemId = createItemData.data.id;
        console.log(`✅ Created Content Item (ID: ${itemId})`);

        // 5. Update Content Item
        const updateItemRes = await fetch(`${API_URL}/content-items/${itemId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'published' })
        });
        const updateItemData = await updateItemRes.json();
        if (!updateItemRes.ok) throw new Error(`Update item failed: ${JSON.stringify(updateItemData)}`);
        console.log(`✅ Updated Content Item Status: ${updateItemData.data.status}`);

        // 6. Delete Content Item
        const deleteItemRes = await fetch(`${API_URL}/content-items/${itemId}`, {
            method: 'DELETE'
        });
        const deleteItemData = await deleteItemRes.json();
        if (!deleteItemRes.ok) throw new Error(`Delete item failed: ${JSON.stringify(deleteItemData)}`);
        console.log(`✅ Deleted Content Item`);

        // 7. Delete Content Type
        const deleteTypeRes = await fetch(`${API_URL}/content-types/${typeId}`, {
            method: 'DELETE'
        });
        const deleteTypeData = await deleteTypeRes.json();
        if (!deleteTypeRes.ok) throw new Error(`Delete type failed: ${JSON.stringify(deleteTypeData)}`);
        console.log(`✅ Deleted Content Type`);

        console.log('\n🎉 Verification Successful!');
    } catch (error) {
        console.error('\n❌ Verification Failed:', error);
        process.exit(1);
    }
}

verify();
