import { eq } from 'drizzle-orm';
import { db } from '../db';
import {
    revenueEvents,
    revenueAllocations,
    allocationStatusEvents,
    contributionEvents
} from '../db/schema';

type SplitWeights = {
    author: number;
    editor: number;
    distributor: number;
};

// Default weights: 70% Author, 10% Editor, 20% Distributor
const DEFAULT_WEIGHTS: SplitWeights = {
    author: 70,
    editor: 10,
    distributor: 20
};

export class RevenueAllocatorService {
    /**
     * Allocate revenue for an offer purchase based on active contributions
     */
    static async allocateRevenue(
        domainId: number,
        contentItemId: number,
        sourceType: string,
        sourceRef: string,
        grossSats: number,
        feeSats: number
    ) {
        const netSats = grossSats - feeSats;

        // 1. Create the base Revenue Event
        const [revenueEvent] = await db.insert(revenueEvents)
            .values({
                domainId,
                sourceType,
                sourceRef,
                grossSats,
                feeSats,
                netSats
            })
            .returning();

        // 2. Fetch existing contributions for this content item
        const contributions = await db.select()
            .from(contributionEvents)
            .where(eq(contributionEvents.contentItemId, contentItemId));

        if (!contributions.length) {
            // If no contributions, we might log a warning or send to a "treasury" profile. 
            // For now, no allocations will be created, meaning it sits unallocated.
            return revenueEvent;
        }

        // Group by role and sum weights to find relative split among same roles if needed
        // The RFC 0006 simplest case: mapping agents to their fixed role splits.
        // We assume 1 agent per role or we divide the role percentage by active agents in that role.
        const roleGroups = contributions.reduce((acc, curr) => {
            if (!acc[curr.role as keyof typeof acc]) acc[curr.role as keyof typeof acc] = [];
            acc[curr.role as keyof typeof acc].push(curr);
            return acc;
        }, { author: [], editor: [], distributor: [] } as Record<string, typeof contributions>);

        let allocationsToInsert: { agentProfileId: number; amountSats: number }[] = [];
        let totalAllocated = 0;

        // Helper to allocate for a role
        const allocateRole = (role: string, percentage: number) => {
            const roleConts = roleGroups[role];
            if (!roleConts || roleConts.length === 0) return 0;

            // Total sats for this role
            const roleSatsFull = Math.floor(netSats * (percentage / 100));
            // Split among agents in this role based on their relative weights
            const totalRoleWeight = roleConts.reduce((sum, c) => sum + c.weight, 0);

            let roleAllocated = 0;

            for (const contribution of roleConts) {
                const agentShare = Math.floor(roleSatsFull * (contribution.weight / totalRoleWeight));
                allocationsToInsert.push({
                    agentProfileId: contribution.agentProfileId,
                    amountSats: agentShare
                });
                roleAllocated += agentShare;
            }
            return roleAllocated;
        };

        totalAllocated += allocateRole('author', DEFAULT_WEIGHTS.author);
        totalAllocated += allocateRole('editor', DEFAULT_WEIGHTS.editor);
        totalAllocated += allocateRole('distributor', DEFAULT_WEIGHTS.distributor);

        // Fractional remainders are strictly credited to the FIRST author found
        const remainder = netSats - totalAllocated;
        if (remainder > 0 && roleGroups.author.length > 0) {
            const firstAuthorIdx = allocationsToInsert.findIndex(a => a.agentProfileId === roleGroups.author[0].agentProfileId);
            if (firstAuthorIdx !== -1) {
                allocationsToInsert[firstAuthorIdx].amountSats += remainder;
            } else {
                allocationsToInsert.push({
                    agentProfileId: roleGroups.author[0].agentProfileId,
                    amountSats: remainder
                });
            }
        }

        // 3. Create Allocations
        if (allocationsToInsert.length > 0) {
            const insertedAllocations = await db.insert(revenueAllocations)
                .values(allocationsToInsert.map(a => ({
                    domainId,
                    revenueEventId: revenueEvent.id,
                    agentProfileId: a.agentProfileId,
                    amountSats: a.amountSats
                })))
                .returning();

            // 4. Create Initial Pending Status Events
            await db.insert(allocationStatusEvents)
                .values(insertedAllocations.map(a => ({
                    domainId,
                    allocationId: a.id,
                    status: 'pending'
                })));
        }

        return revenueEvent;
    }
}
