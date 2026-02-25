import { eq, and, lt, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { allocationStatusEvents, revenueAllocations } from '../db/schema.js';

export class AllocationStateWorker {
    private intervalId?: NodeJS.Timeout;
    private isRunning = false;

    start(intervalMs = 1000 * 60 * 60) { // Default run every hour
        if (this.intervalId) return;
        console.log(`[AllocationStateWorker] Started, running every ${intervalMs}ms`);
        this.intervalId = setInterval(() => this.sweep(), intervalMs);
        // Run first sweep immediately
        setTimeout(() => this.sweep(), 0);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
        console.log('[AllocationStateWorker] Stopped');
    }

    async sweep() {
        if (this.isRunning) return;
        this.isRunning = true;
        try {
            await this.processAutoClear();
        } catch (error) {
            console.error('[AllocationStateWorker] Sweep failed', error);
        } finally {
            this.isRunning = false;
        }
    }

    private async processAutoClear() {
        const now = Date.now();
        // 7 days for pending -> cleared
        const pendingThresholdDate = new Date(now - 7 * 24 * 60 * 60 * 1000);

        // 14 days for disputed -> cleared
        const disputedThresholdDate = new Date(now - 14 * 24 * 60 * 60 * 1000);

        // Subquery to find the LATEST status of each allocation
        // In PostgreSQL we could do DISTINCT ON, but cross-database we can use a simpler approach:
        // Or we can just join and group, but since we're using Drizzle we might just construct a raw query or fetch and filter.

        // Fetch allocations that might be eligible by looking at their most recent status event
        // Better: store current 'status' in `revenueAllocations` to avoid complex latest-event queries, but RFC specifies 
        // "allocationStatusEvents - Immutable ledger replacing mutating status."
        // We will query the latest event for each allocation.

        // Since sqlite/pg dialect differences make 'DISTINCT ON' tricky if sqlite, let's just 
        // pull all events from the past 14 days or use a subselect. 
        // As a simpler approach for the worker, we can select all allocations, check latest status, and if it qualifies, add a new event.
        // Doing this efficiently:

        const allLatestEvents = await db.execute(`
            SELECT DISTINCT ON (allocation_id) allocation_id, status, created_at, domain_id
            FROM allocation_status_events
            ORDER BY allocation_id, created_at DESC
        `).catch(() => {
            // Fallback for sqlite if needed, but wordclaw uses pg
            return { rows: [] };
        });

        const rows = 'rows' in allLatestEvents ? allLatestEvents.rows : allLatestEvents as any[];

        const toClear: { domainId: number; allocationId: number }[] = [];

        for (const row of rows) {
            const createdAt = new Date(row.created_at);
            if (row.status === 'pending' && createdAt <= pendingThresholdDate) {
                toClear.push({ domainId: row.domain_id, allocationId: row.allocation_id });
            } else if (row.status === 'disputed' && createdAt <= disputedThresholdDate) {
                toClear.push({ domainId: row.domain_id, allocationId: row.allocation_id });
            }
        }

        if (toClear.length > 0) {
            console.log(`[AllocationStateWorker] Auto-clearing ${toClear.length} allocations`);
            await db.insert(allocationStatusEvents).values(
                toClear.map(a => ({
                    domainId: a.domainId,
                    allocationId: a.allocationId,
                    status: 'cleared'
                }))
            );
        }
    }
}

export const allocationStateWorker = new AllocationStateWorker();
