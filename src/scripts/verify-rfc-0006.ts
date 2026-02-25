import { db } from '../db/index.js';
import { agentProfiles, contributionEvents, revenueEvents, revenueAllocations, allocationStatusEvents, payoutBatches, payoutTransfers } from '../db/schema.js';
import { RevenueAllocatorService } from '../services/revenue-allocator.service.js';
import { allocationStateWorker } from '../workers/allocation-state.worker.js';
import { payoutWorker } from '../workers/payout.worker.js';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

async function runVerification() {
    console.log('--- Starting RFC 0006 Verification ---');
    const domainId = 1;

    // 1. Fetch some test profiles or create them for simulation if they exist
    console.log('Fetching existing profiles for simulation...');
    let profiles = await db.select().from(agentProfiles).limit(3);

    if (profiles.length < 3) {
        console.log('Creating dummy agent profiles...');
        const needed = 3 - profiles.length;
        const { createApiKey } = await import('../services/api-key.js');
        const newProfilesToInsert = [];
        for (let i = 0; i < needed; i++) {
            const keyData = await createApiKey({
                domainId,
                name: `Test Agent Key ${i}`,
                scopes: ['content:read']
            });

            newProfilesToInsert.push({
                domainId,
                apiKeyId: keyData.key.id,
                displayName: `Test Agent ${i}`,
                payoutAddress: `test${i}@getalby.com`
            });
        }
        await db.insert(agentProfiles).values(newProfilesToInsert);
        profiles = await db.select().from(agentProfiles).limit(3);
    }

    const [author, editor, distributor] = profiles;

    const { contentItems, contentTypes } = await import('../db/schema.js');
    let [item] = await db.select().from(contentItems).limit(1);
    if (!item) {
        const [ctype] = await db.insert(contentTypes).values({ domainId, name: 'Test', slug: 'test', schema: '{}' }).returning();
        [item] = await db.insert(contentItems).values({ domainId, contentTypeId: ctype.id, data: '{}', status: 'published' }).returning();
    }
    const contentItemId = item.id;
    console.log('Creating mock contribution events for content item', contentItemId);
    await db.insert(contributionEvents).values([
        { domainId, contentItemId, agentProfileId: author.id, role: 'author', weight: 1 },
        { domainId, contentItemId, agentProfileId: editor.id, role: 'editor', weight: 1 },
        { domainId, contentItemId, agentProfileId: distributor.id, role: 'distributor', weight: 1 },
    ]);

    // 3. Trigger Revenue Allocation
    const grossSats = 1000;
    const feeSats = 50; // Net 950 sats
    console.log(`Triggering revenue allocation: Gross ${grossSats}, Fee ${feeSats}, Net ${grossSats - feeSats}`);
    await RevenueAllocatorService.allocateRevenue(
        domainId,
        contentItemId,
        'test_purchase',
        'test_ref_123',
        grossSats,
        feeSats
    );

    // 4. Verify allocations 
    const allocations = await db.select().from(revenueAllocations).orderBy(revenueAllocations.id);
    const recentAllocations = allocations.slice(-3); // Get the 3 we just made

    console.log('Allocations created:');
    for (const alloc of recentAllocations) {
        const statuses = await db.select().from(allocationStatusEvents).where(eq(allocationStatusEvents.allocationId, alloc.id));
        console.log(`- Profile ${alloc.agentProfileId}: ${alloc.amountSats} sats, Current Status: ${statuses.map(s => s.status).join(', ')}`);
    }

    // 5. Simulate 8 days passing to trigger auto-clear
    console.log('Simulating auto-clear worker (mocking 8 days passed)...');
    await db.execute(sql`
        UPDATE allocation_status_events 
        SET created_at = NOW() - INTERVAL '8 days' 
        WHERE allocation_id IN (${sql.join(recentAllocations.map(a => a.id), sql`, `)})
    `);

    // Run sweep
    await allocationStateWorker.sweep();

    console.log('Checking status after sweep:');
    for (const alloc of recentAllocations) {
        const statuses = await db.select().from(allocationStatusEvents).where(eq(allocationStatusEvents.allocationId, alloc.id)).orderBy(allocationStatusEvents.createdAt);
        console.log(`- Profile ${alloc.agentProfileId}: ${statuses.map(s => s.status).join(' -> ')}`);
    }

    // 6. Test Payout Worker
    // Set mock lightning addresses
    await db.update(agentProfiles).set({ payoutAddress: 'test@getalby.com' }).where(eq(agentProfiles.id, author.id));

    console.log('Running payout worker sweep...');
    await payoutWorker.sweep();

    // Verify payouts
    const transfers = await db.select().from(payoutTransfers).orderBy(payoutTransfers.createdAt);
    console.log('Payout Transfers:');
    if (transfers.length === 0) {
        console.log('- No transfers created (perhaps threshold strictly not met or handled before)');
    } else {
        for (const t of transfers.slice(-3)) {
            console.log(`- Batch ${t.batchId}, Profile ${t.agentProfileId}: ${t.amountSats} sats, Status: ${t.status}`);
        }
    }

    console.log('--- RFC 0006 Verification Complete ---');
    process.exit(0);
}

runVerification().catch(console.error);
