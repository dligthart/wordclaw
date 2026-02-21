import { L402Options, PricingContext } from '../middleware/l402.js';
import { db } from '../db/index.js';
import { contentItems, contentTypes, payments } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { MockPaymentProvider } from './mock-payment-provider.js';

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
        const headers = reqDetails.requestInfo?.headers || {};
        const method = reqDetails.requestInfo?.method || 'UNKNOWN';

        let actorId = null;
        if (headers.authorization && headers.authorization.startsWith('Bearer ')) {
            actorId = 'system';
        }

        await db.insert(payments).values({
            paymentHash: invoice.hash,
            paymentRequest: invoice.paymentRequest,
            amountSatoshis,
            status: 'pending',
            resourcePath: reqDetails.path || '/graphql',
            actorId,
            details: {
                method,
                headers: { ...headers, authorization: '[REDACTED]', cookie: '[REDACTED]' }
            }
        });
    },

    onPaymentVerified: async (paymentHash: string) => {
        await db.update(payments)
            .set({ status: 'paid', updatedAt: new Date() })
            .where(eq(payments.paymentHash, paymentHash));
    },

    onPaymentConsumed: async (paymentHash: string) => {
        await db.update(payments)
            .set({ status: 'consumed', updatedAt: new Date() })
            .where(eq(payments.paymentHash, paymentHash));
    },

    getPaymentStatus: async (paymentHash: string) => {
        const [payment] = await db.select().from(payments).where(eq(payments.paymentHash, paymentHash));
        return (payment?.status as 'pending' | 'paid' | 'consumed') || 'pending';
    }
};
