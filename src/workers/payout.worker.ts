import { eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { payoutBatches, payoutTransfers, agentProfiles } from '../db/schema.js';

export class PayoutWorker {
    private intervalId?: NodeJS.Timeout;
    private isRunning = false;

    // e.g., run every 24 hours in production
    start(intervalMs = 1000 * 60 * 60 * 24) {
        if (this.intervalId) return;
        console.log(`[PayoutWorker] Started, running every ${intervalMs}ms`);
        this.intervalId = setInterval(() => this.sweep(), intervalMs);
        setTimeout(() => this.sweep(), 0);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
        console.log('[PayoutWorker] Stopped');
    }

    async sweep() {
        if (this.isRunning) return;
        this.isRunning = true;
        try {
            await this.processPayouts();
        } catch (error) {
            console.error('[PayoutWorker] Sweep failed', error);
        } finally {
            this.isRunning = false;
        }
    }

    private async processPayouts() {
        // Find agents who need paying out by calculating (Cleared Allocations - Past Payouts)
        const balancesResult = await db.execute(sql`
            WITH LatestStatus AS (
                SELECT DISTINCT ON (allocation_id) allocation_id, status 
                FROM allocation_status_events 
                ORDER BY allocation_id, created_at DESC
            ),
            ClearedAllocations AS (
                SELECT ra.agent_profile_id, ra.domain_id, SUM(ra.amount_sats) as cleared_total
                FROM revenue_allocations ra
                JOIN LatestStatus ls ON ls.allocation_id = ra.id
                WHERE ls.status = 'cleared'
                GROUP BY ra.agent_profile_id, ra.domain_id
            ),
            PastPayouts AS (
                SELECT agent_profile_id, SUM(amount_sats) as payout_total
                FROM payout_transfers
                WHERE status IN ('pending', 'completed')
                GROUP BY agent_profile_id
            )
            SELECT 
                c.domain_id,
                c.agent_profile_id, 
                c.cleared_total - COALESCE(p.payout_total, 0) as available_sats
            FROM ClearedAllocations c
            LEFT JOIN PastPayouts p ON c.agent_profile_id = p.agent_profile_id
            WHERE (c.cleared_total - COALESCE(p.payout_total, 0)) >= 500
        `);

        // pg driver compatibility
        const balances: any[] = (balancesResult as any).rows || balancesResult;

        if (balances.length === 0) {
            return;
        }

        console.log(`[PayoutWorker] Found ${balances.length} agents eligible for payout.`);

        // Aggregate by domain to create batches per domain. 
        const byDomain = balances.reduce((acc, row) => {
            const domainId = row.domain_id;
            if (!acc[domainId]) acc[domainId] = [];
            acc[domainId].push(row);
            return acc;
        }, {} as Record<number, any[]>);

        for (const [domainIdStr, agents] of Object.entries(byDomain)) {
            const domainId = parseInt(domainIdStr, 10);

            // Create a batch
            const [batch] = await db.insert(payoutBatches).values({
                domainId: domainId,
                periodStart: new Date(),
                periodEnd: new Date(), // Simpler version, could track actual period boundaries
                status: 'processing'
            }).returning();

            // Insert pending transfers map
            const transfersToInsert = (agents as any[]).map((a: any) => ({
                domainId,
                batchId: batch.id,
                agentProfileId: a.agent_profile_id as number,
                amountSats: parseInt(a.available_sats, 10),
                status: 'pending'
            }));

            const insertedTransfers = await db.insert(payoutTransfers).values(transfersToInsert).returning();

            // Execute the transfers via Mock/Lightning
            const agentProfileIds = insertedTransfers.map(t => t.agentProfileId);
            const profiles = await db.select().from(agentProfiles).where(inArray(agentProfiles.id, agentProfileIds));
            const profileMap = profiles.reduce((m, p) => { m[p.id] = p; return m; }, {} as Record<number, typeof agentProfiles.$inferSelect>);

            for (const transfer of insertedTransfers) {
                const profile = profileMap[transfer.agentProfileId];
                if (!profile?.payoutAddress) {
                    await db.update(payoutTransfers).set({ status: 'failed_permanent' }).where(eq(payoutTransfers.id, transfer.id));
                    continue;
                }

                const idempotencyKey = `payout_transfer_${transfer.id}`;
                let attempts = 0;
                let success = false;

                while (attempts < 3 && !success) {
                    attempts++;
                    try {
                        // In a real system, we'd hit LNBits or another LN provider 
                        // e.g. await LightningProvider.payToAddress(profile.payoutAddress, transfer.amountSats, idempotencyKey);
                        // Using Mock execution
                        if (profile.payoutAddress.includes('fail')) {
                            throw new Error('Simulated failure');
                        }

                        success = true;
                    } catch (err: any) {
                        console.error(`[PayoutWorker] Attempt ${attempts} failed for transfer ${transfer.id}: ${err.message}`);
                        if (attempts === 3) break;
                        // wait a moment before retry
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }

                if (success) {
                    await db.update(payoutTransfers).set({ status: 'completed' }).where(eq(payoutTransfers.id, transfer.id));
                } else {
                    await db.update(payoutTransfers).set({ status: 'failed_permanent' }).where(eq(payoutTransfers.id, transfer.id));
                }
            }

            // Mark batch completed
            await db.update(payoutBatches).set({ status: 'completed' }).where(eq(payoutBatches.id, batch.id));
        }
    }
}

export const payoutWorker = new PayoutWorker();
