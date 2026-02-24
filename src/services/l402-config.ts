import { L402Options, PricingContext } from '../middleware/l402.js';
import { db } from '../db/index.js';
import { contentItems, contentTypes, payments } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { MockPaymentProvider } from './mock-payment-provider.js';
import { entitlements, agentProfiles } from '../db/schema.js';
import { LicensingService } from './licensing.js';

const SAFE_PAYMENT_HEADER_ALLOWLIST = new Set([
    'user-agent',
    'content-type',
    'accept',
    'accept-language',
    'x-request-id'
]);

function pickSafePaymentHeaders(rawHeaders: Record<string, unknown>): Record<string, string | string[]> {
    const safe: Record<string, string | string[]> = {};

    for (const [key, value] of Object.entries(rawHeaders)) {
        const normalizedKey = key.toLowerCase();
        if (!SAFE_PAYMENT_HEADER_ALLOWLIST.has(normalizedKey)) {
            continue;
        }

        if (typeof value === 'string') {
            safe[normalizedKey] = value;
            continue;
        }

        if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
            safe[normalizedKey] = value;
        }
    }

    return safe;
}

function reqDetailsToOperation(requestDetails: any): string {
    const method = requestDetails?.requestInfo?.method || 'GET';
    return `${method} ${requestDetails?.path || '/api'}`;
}

let mockPaymentProvider: MockPaymentProvider;
if (process.env.NODE_ENV === 'production' && process.env.PAYMENT_PROVIDER !== 'mock') {
    throw new Error("A real PaymentProvider is required in production. Set PAYMENT_PROVIDER='mock' to override.");
} else {
    mockPaymentProvider = new MockPaymentProvider();
}

let l402Secret = process.env.L402_SECRET;
if (!l402Secret) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('L402_SECRET environment variable is strictly required in production.');
    } else {
        l402Secret = crypto.randomBytes(32).toString('hex');
        console.warn(`[WARNING] L402_SECRET is not set. Generating a random secret for development: ${l402Secret}`);
    }
}

export const globalL402Options: L402Options = {
    provider: mockPaymentProvider,
    secretKey: l402Secret,

    getPrice: async (context: PricingContext): Promise<number | null> => {
        let totalBasePrice = 0;
        let cType = context.contentTypeId;

        if (!cType && context.resourceId) {
            const [existing] = await db.select().from(contentItems).where(eq(contentItems.id, context.resourceId));
            if (existing) cType = existing.contentTypeId;
        }

        if (cType) {
            const [contentType] = await db.select().from(contentTypes).where(eq(contentTypes.id, cType));
            if (contentType && contentType.basePrice) {
                totalBasePrice += contentType.basePrice * (context.batchSize || 1);
            }
        }

        if (totalBasePrice <= 0) return 0;

        const proposedPrice = context.proposedPrice || 0;
        const maxCap = totalBasePrice * 10;

        if (Number.isFinite(proposedPrice) && proposedPrice > totalBasePrice && proposedPrice <= maxCap) {
            return proposedPrice;
        } else if (Number.isFinite(proposedPrice) && proposedPrice > maxCap) {
            return maxCap;
        }

        return totalBasePrice;
    },

    onInvoiceCreated: async (invoice: any, reqDetails: any, amountSatoshis: any) => {
        const headers = (reqDetails.requestInfo?.headers || {}) as Record<string, unknown>;
        const method = reqDetails.requestInfo?.method || 'UNKNOWN';
        const safeHeaders = pickSafePaymentHeaders(headers);

        let actorId = null;
        if (typeof headers.authorization === 'string') {
            actorId = 'system';
        }

        const domainHeader = headers['x-wordclaw-domain'];
        const domainId = typeof domainHeader === 'string' ? Number(domainHeader) : 1;

        await db.insert(payments).values({
            domainId,
            paymentHash: invoice.hash,
            paymentRequest: invoice.paymentRequest,
            amountSatoshis,
            status: 'pending',
            resourcePath: reqDetails.path || '/graphql',
            actorId,
            details: {
                method,
                headers: safeHeaders
            }
        });
    },

    onPaymentVerified: async (paymentHash: string) => {
        await db.update(payments)
            .set({ status: 'paid', updatedAt: new Date() })
            .where(eq(payments.paymentHash, paymentHash));
    },

    onPaymentConsumed: async (paymentHash: string, requestDetails: any) => {
        // First try to consume as an entitlement
        const [entitlement] = await db.select().from(entitlements).where(eq(entitlements.paymentHash, paymentHash));

        if (entitlement) {
            const domainId = requestDetails?.headers?.['x-wordclaw-domain'] ? Number(requestDetails.headers['x-wordclaw-domain']) : 1;
            const res = await LicensingService.atomicallyDecrementRead(domainId, entitlement.id);

            await LicensingService.recordAccessEvent(
                domainId,
                entitlement.id,
                requestDetails?.path || '/api',
                reqDetailsToOperation(requestDetails),
                res.granted,
                res.reason
            );

            if (!res.granted) {
                // If it fails to consume (exhausted), update DB
                await db.update(payments).set({ status: 'consumed', updatedAt: new Date() }).where(eq(payments.paymentHash, paymentHash));
                throw new Error(res.reason);
            }
            return;
        }

        // Fallback to legacy single-use payment
        await db.update(payments)
            .set({ status: 'consumed', updatedAt: new Date() })
            .where(eq(payments.paymentHash, paymentHash));
    },

    getPaymentStatus: async (paymentHash: string, requestDetails: any) => {
        const [entitlement] = await db.select().from(entitlements).where(eq(entitlements.paymentHash, paymentHash));

        if (entitlement) {
            if (entitlement.status === 'revoked' || entitlement.status === 'expired') return 'consumed';
            if (entitlement.expiresAt && new Date() > entitlement.expiresAt) return 'consumed';
            if (entitlement.remainingReads !== null && entitlement.remainingReads <= 0) return 'consumed';

            // If the payment is not settled in the provider, we still return pending
            const [payment] = await db.select().from(payments).where(eq(payments.paymentHash, paymentHash));
            return (payment?.status as 'pending' | 'paid' | 'consumed') || 'pending';
        }

        const [payment] = await db.select().from(payments).where(eq(payments.paymentHash, paymentHash));
        return (payment?.status as 'pending' | 'paid' | 'consumed') || 'pending';
    }
};
