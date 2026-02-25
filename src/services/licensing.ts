import { db } from '../db/index.js';
import { offers, entitlements, licensePolicies, accessEvents, agentProfiles } from '../db/schema.js';
import { and, eq, gt, isNull, or, desc } from 'drizzle-orm';

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
     * Returns active offers that apply to a concrete content item read.
     * Offer precedence is resolved by caller (item > type > subscription).
     */
    static async getActiveOffersForItemRead(domainId: number, itemId: number, contentTypeId: number) {
        return db.select().from(offers).where(and(
            eq(offers.domainId, domainId),
            eq(offers.active, true),
            or(
                and(eq(offers.scopeType, 'item'), eq(offers.scopeRef, itemId)),
                and(eq(offers.scopeType, 'type'), eq(offers.scopeRef, contentTypeId)),
                and(eq(offers.scopeType, 'subscription'), isNull(offers.scopeRef))
            )
        ));
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
            status: 'pending_payment',
            expiresAt: policy.expiresAt,
            remainingReads: policy.maxReads,
        }).returning();

        return entitlement;
    }

    static async activateEntitlementForPayment(domainId: number, paymentHash: string) {
        const [existing] = await db.select().from(entitlements).where(and(
            eq(entitlements.domainId, domainId),
            eq(entitlements.paymentHash, paymentHash)
        ));

        if (!existing) {
            return null;
        }

        if (existing.status === 'active') {
            return existing;
        }

        if (existing.status !== 'pending_payment') {
            return existing;
        }

        const [updated] = await db.update(entitlements).set({
            status: 'active',
            activatedAt: new Date(),
            terminatedAt: null
        }).where(and(
            eq(entitlements.id, existing.id),
            eq(entitlements.status, 'pending_payment')
        )).returning();

        return updated ?? existing;
    }

    static async getEntitlementByPaymentHash(domainId: number, paymentHash: string) {
        const [entitlement] = await db.select().from(entitlements).where(and(
            eq(entitlements.domainId, domainId),
            eq(entitlements.paymentHash, paymentHash)
        ));
        return entitlement ?? null;
    }

    static async getPendingEntitlementsForOffer(
        domainId: number,
        offerId: number,
        agentProfileId: number
    ) {
        return db.select().from(entitlements).where(and(
            eq(entitlements.domainId, domainId),
            eq(entitlements.offerId, offerId),
            eq(entitlements.agentProfileId, agentProfileId),
            eq(entitlements.status, 'pending_payment')
        )).orderBy(desc(entitlements.id));
    }

    static async getEntitlementsForAgent(domainId: number, agentProfileId: number) {
        return db.select().from(entitlements).where(and(
            eq(entitlements.domainId, domainId),
            eq(entitlements.agentProfileId, agentProfileId)
        )).orderBy(desc(entitlements.id));
    }

    static async getEntitlementForAgentById(domainId: number, agentProfileId: number, entitlementId: number) {
        const [entitlement] = await db.select().from(entitlements).where(and(
            eq(entitlements.domainId, domainId),
            eq(entitlements.agentProfileId, agentProfileId),
            eq(entitlements.id, entitlementId)
        ));
        return entitlement ?? null;
    }

    static async getEligibleEntitlementsForItemRead(
        domainId: number,
        agentProfileId: number,
        itemId: number,
        contentTypeId: number
    ) {
        const rows = await db.select({
            entitlement: entitlements
        }).from(entitlements)
            .innerJoin(offers, eq(entitlements.offerId, offers.id))
            .where(and(
                eq(entitlements.domainId, domainId),
                eq(entitlements.agentProfileId, agentProfileId),
                eq(entitlements.status, 'active'),
                eq(offers.domainId, domainId),
                or(
                    and(eq(offers.scopeType, 'item'), eq(offers.scopeRef, itemId)),
                    and(eq(offers.scopeType, 'type'), eq(offers.scopeRef, contentTypeId)),
                    and(eq(offers.scopeType, 'subscription'), isNull(offers.scopeRef))
                )
            ));

        return rows.map((row) => row.entitlement);
    }

    /**
     * Atomically tries to decrement the reading quota on an active entitlement.
     * Guaranteed safe under concurrent race conditions.
     */
    static async atomicallyDecrementRead(domainId: number, entitlementId: number) {
        const result = await db.transaction(async (tx) => {
            const [current] = await tx.select().from(entitlements).where(and(
                eq(entitlements.id, entitlementId),
                eq(entitlements.domainId, domainId)
            ));

            if (!current) {
                return { granted: false, reason: 'entitlement_not_found_or_inactive' };
            }

            if (current.status !== 'active') {
                if (current.status === 'expired') {
                    return { granted: false, reason: 'entitlement_expired' };
                }
                if (current.status === 'exhausted') {
                    return { granted: false, reason: 'remaining_reads_exhausted' };
                }
                return { granted: false, reason: 'entitlement_not_found_or_inactive' };
            }

            if (current.expiresAt && new Date() > current.expiresAt) {
                await tx.update(entitlements).set({
                    status: 'expired',
                    terminatedAt: new Date()
                }).where(and(
                    eq(entitlements.id, current.id),
                    eq(entitlements.status, 'active')
                ));
                return { granted: false, reason: 'entitlement_expired' };
            }

            if (current.remainingReads !== null) {
                if (current.remainingReads <= 0) {
                    await tx.update(entitlements).set({
                        status: 'exhausted',
                        terminatedAt: new Date()
                    }).where(and(
                        eq(entitlements.id, current.id),
                        eq(entitlements.status, 'active')
                    ));
                    return { granted: false, reason: 'remaining_reads_exhausted' };
                }

                const [updated] = await tx.update(entitlements)
                    .set({ remainingReads: current.remainingReads - 1 })
                    .where(and(eq(entitlements.id, current.id), gt(entitlements.remainingReads, 0)))
                    .returning();

                if (!updated) {
                    return { granted: false, reason: 'race_condition_exhaustion' };
                }

                if (updated.remainingReads === 0) {
                    await tx.update(entitlements).set({
                        status: 'exhausted',
                        terminatedAt: new Date()
                    }).where(and(
                        eq(entitlements.id, updated.id),
                        eq(entitlements.status, 'active')
                    ));
                    return {
                        granted: true,
                        entitlement: {
                            ...updated,
                            status: 'exhausted',
                            terminatedAt: new Date()
                        }
                    };
                }

                return { granted: true, entitlement: updated };
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
