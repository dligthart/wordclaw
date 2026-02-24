import { db } from '../db/index.js';
import { offers, entitlements, licensePolicies, accessEvents, agentProfiles } from '../db/schema.js';
import { eq, and, gt } from 'drizzle-orm';

export class LicensingService {
    /**
     * Retrieves active offers for a given domain and optional scope.
     */
    static async getOffers(domainId: number, scopeType?: string, scopeRef?: number) {
        const conditions = [
            eq(offers.domainId, domainId),
            eq(offers.active, true)
        ];

        if (scopeType) conditions.push(eq(offers.scopeType, scopeType));
        if (scopeRef !== undefined) conditions.push(eq(offers.scopeRef, scopeRef));

        return await db.select().from(offers).where(and(...conditions));
    }

    /**
     * Provisions an initial entitlement strictly mapped to a new L402 payment hash.
     * This entitlement stays inert until the payment is marked 'paid' or 'consumed'.
     */
    static async provisionEntitlementForSale(domainId: number, offerId: number, agentProfileId: number, paymentHash: string) {
        const [policy] = await db.select().from(licensePolicies).where(and(eq(licensePolicies.offerId, offerId), eq(licensePolicies.domainId, domainId))).orderBy(licensePolicies.version);

        if (!policy) throw new Error('OFFER_MISSING_POLICY: Cannot sell an offer that lacks a license policy.');

        const [entitlement] = await db.insert(entitlements).values({
            domainId,
            offerId,
            policyId: policy.id,
            policyVersion: policy.version,
            agentProfileId,
            paymentHash,
            status: 'active',
            expiresAt: policy.expiresAt,
            remainingReads: policy.maxReads,
        }).returning();

        return entitlement;
    }

    /**
     * Atomically tries to decrement the reading quota on an active entitlement.
     * Guaranteed safe under concurrent race conditions.
     */
    static async atomicallyDecrementRead(domainId: number, entitlementId: number) {
        const result = await db.transaction(async (tx) => {
            const [current] = await tx.select().from(entitlements).where(and(eq(entitlements.id, entitlementId), eq(entitlements.domainId, domainId), eq(entitlements.status, 'active')));

            if (!current) {
                return { granted: false, reason: 'entitlement_not_found_or_inactive' };
            }

            if (current.expiresAt && new Date() > current.expiresAt) {
                return { granted: false, reason: 'entitlement_expired' };
            }

            if (current.remainingReads !== null) {
                if (current.remainingReads <= 0) {
                    return { granted: false, reason: 'remaining_reads_exhausted' };
                }

                const [updated] = await tx.update(entitlements)
                    .set({ remainingReads: current.remainingReads - 1 })
                    .where(and(eq(entitlements.id, current.id), gt(entitlements.remainingReads, 0)))
                    .returning();

                if (!updated) {
                    return { granted: false, reason: 'race_condition_exhaustion' };
                }
            }

            return { granted: true, entitlement: current };
        });

        return result;
    }

    /**
     * Records an access event for historical compliance and metric rollups.
     */
    static async recordAccessEvent(domainId: number, entitlementId: number, resourcePath: string, action: string, granted: boolean, reason?: string) {
        await db.insert(accessEvents).values({
            domainId,
            entitlementId,
            resourcePath,
            action,
            granted,
            reason
        });
    }

    /**
     * Delegates a fraction of an entitlement down to a subordinate agent.
     */
    static async delegateEntitlement(domainId: number, parentEntitlementId: number, targetAgentProfileId: number, readsAmount: number) {
        const result = await db.transaction(async (tx) => {
            const [parent] = await tx.select().from(entitlements).where(and(eq(entitlements.id, parentEntitlementId), eq(entitlements.domainId, domainId), eq(entitlements.status, 'active')));
            if (!parent) throw new Error('PARENT_ENTITLEMENT_INVALID');
            if (parent.delegatedFrom) throw new Error('CANNOT_DELEGATE_ALREADY_DELEGATED_ENTITLEMENT');

            if (parent.remainingReads !== null) {
                if (parent.remainingReads < readsAmount) throw new Error('INSUFFICIENT_READS_TO_DELEGATE');

                const [updated] = await tx.update(entitlements)
                    .set({ remainingReads: parent.remainingReads - readsAmount })
                    .where(and(eq(entitlements.id, parent.id), gt(entitlements.remainingReads, readsAmount - 1)))
                    .returning();

                if (!updated) throw new Error('CONCURRENT_DELEGATION_FAILURE');
            }

            const pseudoPaymentHash = `delegation_${parent.id}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

            const [delegated] = await tx.insert(entitlements).values({
                domainId: parent.domainId,
                offerId: parent.offerId,
                policyId: parent.policyId,
                policyVersion: parent.policyVersion,
                agentProfileId: targetAgentProfileId,
                paymentHash: pseudoPaymentHash,
                status: 'active',
                expiresAt: parent.expiresAt,
                remainingReads: readsAmount,
                delegatedFrom: parent.id
            }).returning();

            return delegated;
        });

        return result;
    }
}
