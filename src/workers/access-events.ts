import { db } from '../db/index.js';
import { accessEvents } from '../db/schema.js';
import { lt } from 'drizzle-orm';

export class AccessEventsWorker {
    private interval: NodeJS.Timeout | null = null;

    start(intervalMs: number = 24 * 60 * 60 * 1000) { // Default run daily
        if (this.interval) return;
        this.interval = setInterval(() => this.runCleanup(), intervalMs);

        // Run once immediately on startup
        this.runCleanup().catch(err => console.error('[AccessEventsWorker] Error on startup run:', err));
        console.log(`[AccessEventsWorker] Started cleanup worker, running every ${intervalMs}ms`);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            console.log(`[AccessEventsWorker] Stopped cleanup worker`);
        }
    }

    async runCleanup() {
        console.log(`[AccessEventsWorker] Running retention cleanup job...`);
        try {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            // Using Drizzle to delete events older than 30 days
            const result = await db.delete(accessEvents).where(lt(accessEvents.createdAt, thirtyDaysAgo));
            console.log(`[AccessEventsWorker] Purged stale access events older than 30 days.`);
        } catch (error) {
            console.error('[AccessEventsWorker] Failed to purge old access events:', error);
        }
    }
}

export const accessEventsWorker = new AccessEventsWorker();
