import crypto from 'crypto';
import { and, eq, isNull, or } from 'drizzle-orm';

import { db } from '../db/index.js';
import { contentItems, contentTypes, entitlements, offers, payments } from '../db/schema.js';
import { PaymentProvider, ProviderPaymentStatus } from '../interfaces/payment-provider.js';
import { L402Options, PricingContext } from '../middleware/l402.js';
import { LicensingService } from './licensing.js';
import { LnbitsPaymentProvider } from './lnbits-payment-provider.js';
import { MockPaymentProvider } from './mock-payment-provider.js';
import { paymentFlowMetrics } from './payment-metrics.js';
import { getPaymentByHash, transitionPaymentStatus } from './payment-ledger.js';

const SAFE_PAYMENT_HEADER_ALLOWLIST = new Set([
  'user-agent',
  'content-type',
  'accept',
  'accept-language',
  'x-request-id'
]);
const SENSITIVE_HEADER_KEY_PATTERN = /(authorization|cookie|token|secret|key)/i;

type PaymentState = 'pending' | 'paid' | 'consumed' | 'expired' | 'failed';

type RequestDetails = {
  path?: string;
  domainId?: number;
  requestInfo?: {
    method?: string;
    headers?: Record<string, unknown>;
  };
};

function pickSafePaymentHeaders(rawHeaders: Record<string, unknown>): Record<string, string | string[]> {
  const safe: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(rawHeaders)) {
    const normalizedKey = key.toLowerCase();
    if (SENSITIVE_HEADER_KEY_PATTERN.test(normalizedKey)) {
      continue;
    }

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

function reqDetailsToOperation(requestDetails: RequestDetails): string {
  const method = requestDetails?.requestInfo?.method || 'GET';
  return `${method} ${requestDetails?.path || '/api'}`;
}

function normalizePaymentStatus(status: string | null | undefined): PaymentState {
  if (
    status === 'pending'
    || status === 'paid'
    || status === 'consumed'
    || status === 'expired'
    || status === 'failed'
  ) {
    return status;
  }

  return 'pending';
}

function getDomainIdFromContext(context?: { domainId?: number }): number {
  if (Number.isInteger(context?.domainId)) {
    return context!.domainId as number;
  }

  return 1;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function buildPaymentProvider(): PaymentProvider {
  const providerName = (process.env.PAYMENT_PROVIDER || (process.env.NODE_ENV === 'production' ? 'lnbits' : 'mock')).toLowerCase();

  if (providerName === 'mock') {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_PROVIDER_IN_PRODUCTION !== 'true') {
      throw new Error("Mock payment provider is blocked in production. Set PAYMENT_PROVIDER=lnbits or explicitly ALLOW_MOCK_PROVIDER_IN_PRODUCTION=true for controlled testing.");
    }

    return new MockPaymentProvider();
  }

  if (providerName === 'lnbits') {
    const baseUrl = process.env.LNBITS_BASE_URL;
    const adminKey = process.env.LNBITS_ADMIN_KEY;
    if (!baseUrl || !adminKey) {
      throw new Error('LNBITS_BASE_URL and LNBITS_ADMIN_KEY are required when PAYMENT_PROVIDER=lnbits');
    }

    return new LnbitsPaymentProvider({
      baseUrl,
      adminKey,
      invoiceExpirySeconds: parsePositiveInt(process.env.L402_INVOICE_EXPIRY_SECONDS, 3600),
      timeoutMs: parsePositiveInt(process.env.PAYMENT_PROVIDER_TIMEOUT_MS, 10000)
    });
  }

  throw new Error(`Unsupported PAYMENT_PROVIDER '${providerName}'. Supported providers: mock, lnbits`);
}

const paymentProvider = buildPaymentProvider();

let l402Secret = process.env.L402_SECRET;
if (!l402Secret) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('L402_SECRET environment variable is strictly required in production.');
  }

  l402Secret = crypto.randomBytes(32).toString('hex');
  console.warn('[WARNING] L402_SECRET is not set. Generated ephemeral secret for development.');
}

async function applyProviderStatusObservation(
  paymentHash: string,
  status: ProviderPaymentStatus,
  details: RequestDetails,
  verification: {
    providerInvoiceId?: string | null;
    expiresAt?: Date | null;
    settledAt?: Date | null;
    failureReason?: string | null;
  }
): Promise<void> {
  if (status === 'pending') {
    return;
  }

  if (status === 'paid') {
    await transitionPaymentStatus(paymentHash, 'paid', {
      providerName: paymentProvider.providerName,
      providerInvoiceId: verification.providerInvoiceId,
      expiresAt: verification.expiresAt,
      settledAt: verification.settledAt,
      failureReason: null,
      detailsPatch: {
        providerStatus: status,
        observedAt: new Date().toISOString(),
        observedBy: paymentProvider.providerName,
        path: details.path
      }
    });
    return;
  }

  if (status === 'expired' || status === 'failed') {
    try {
      await transitionPaymentStatus(paymentHash, status, {
        providerName: paymentProvider.providerName,
        providerInvoiceId: verification.providerInvoiceId,
        expiresAt: verification.expiresAt,
        failureReason: verification.failureReason ?? (status === 'expired' ? 'invoice_expired' : 'provider_marked_failed'),
        detailsPatch: {
          providerStatus: status,
          observedAt: new Date().toISOString(),
          observedBy: paymentProvider.providerName,
          path: details.path
        }
      });
    } catch (error) {
      // When payment is already consumed, we keep terminal local state.
      console.warn(`[L402] Ignored transition to ${status} for ${paymentHash}: ${(error as Error).message}`);
    }
  }
}

async function markConsumed(paymentHash: string): Promise<void> {
  try {
    await transitionPaymentStatus(paymentHash, 'consumed', {
      detailsPatch: {
        consumedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    if ((error as Error).message.includes('pending -> consumed')) {
      await transitionPaymentStatus(paymentHash, 'paid', {
        settledAt: new Date(),
        detailsPatch: { consumedAfterImplicitSettlement: true }
      });
      await transitionPaymentStatus(paymentHash, 'consumed', {
        detailsPatch: {
          consumedAt: new Date().toISOString()
        }
      });
      return;
    }

    throw error;
  }
}

export const globalL402Options: L402Options = {
  provider: paymentProvider,
  secretKey: l402Secret,

  getPrice: async (context: PricingContext): Promise<number | null> => {
    const domainId = getDomainIdFromContext(context);
    let totalBasePrice = 0;
    let cType = context.contentTypeId;

    if (!cType && context.resourceId) {
      const [existing] = await db.select().from(contentItems).where(and(
        eq(contentItems.id, context.resourceId),
        eq(contentItems.domainId, domainId)
      ));
      if (existing) cType = existing.contentTypeId;
    }

    if (cType) {
      const [contentType] = await db.select().from(contentTypes).where(and(
        eq(contentTypes.id, cType),
        eq(contentTypes.domainId, domainId)
      ));
      if (contentType && contentType.basePrice) {
        totalBasePrice += contentType.basePrice * (context.batchSize || 1);
      }
    }

    // RFC 0015 offer-first contract: when a content item has active offers,
    // reads are entitlement-gated and legacy per-request L402 pricing is bypassed.
    if (
      context.operation === 'read'
      && context.resourceType === 'content-item'
      && Number.isInteger(context.resourceId)
      && Number.isInteger(cType)
    ) {
      const itemId = context.resourceId as number;
      const contentTypeId = cType as number;
      const [matchingOffer] = await db.select({ id: offers.id }).from(offers).where(and(
        eq(offers.domainId, domainId),
        eq(offers.active, true),
        or(
          and(eq(offers.scopeType, 'item'), eq(offers.scopeRef, itemId)),
          and(eq(offers.scopeType, 'type'), eq(offers.scopeRef, contentTypeId)),
          and(eq(offers.scopeType, 'subscription'), isNull(offers.scopeRef))
        )
      )).limit(1);

      if (matchingOffer) {
        return 0;
      }
    }

    if (totalBasePrice <= 0) return 0;

    const proposedPrice = context.proposedPrice || 0;
    const maxCap = totalBasePrice * 10;

    if (Number.isFinite(proposedPrice) && proposedPrice > totalBasePrice && proposedPrice <= maxCap) {
      return proposedPrice;
    }

    if (Number.isFinite(proposedPrice) && proposedPrice > maxCap) {
      return maxCap;
    }

    return totalBasePrice;
  },

  onInvoiceCreated: async (invoice, reqDetails, amountSatoshis) => {
    const headers = (reqDetails.requestInfo?.headers || {}) as Record<string, unknown>;
    const method = reqDetails.requestInfo?.method || 'UNKNOWN';
    const safeHeaders = pickSafePaymentHeaders(headers);

    let actorId: string | null = null;
    if (typeof headers.authorization === 'string') {
      actorId = 'system';
    }

    const domainId = getDomainIdFromContext(reqDetails);

    await db.insert(payments).values({
      domainId,
      provider: invoice.provider,
      providerInvoiceId: invoice.providerInvoiceId,
      paymentHash: invoice.hash,
      paymentRequest: invoice.paymentRequest,
      amountSatoshis,
      status: 'pending',
      expiresAt: invoice.expiresAt,
      resourcePath: reqDetails.path || '/api',
      actorId,
      details: {
        method,
        headers: safeHeaders,
        provider: invoice.provider,
        providerInvoiceId: invoice.providerInvoiceId
      }
    });

    paymentFlowMetrics.increment('invoice_create_success_total');
  },

  onPaymentStatusObserved: async (paymentHash, status, requestDetails, verification) => {
    await applyProviderStatusObservation(paymentHash, status, requestDetails, {
      providerInvoiceId: verification.providerInvoiceId ?? null,
      expiresAt: verification.expiresAt ?? null,
      settledAt: verification.settledAt ?? null,
      failureReason: verification.failureReason ?? null
    });
  },

  onPaymentVerified: async (paymentHash, requestDetails, verification) => {
    const existing = await getPaymentByHash(paymentHash);
    await transitionPaymentStatus(paymentHash, 'paid', {
      providerName: paymentProvider.providerName,
      providerInvoiceId: verification.providerInvoiceId ?? null,
      expiresAt: verification.expiresAt ?? null,
      settledAt: verification.settledAt ?? null,
      failureReason: null,
      detailsPatch: {
        providerStatus: 'paid',
        observedAt: new Date().toISOString(),
        observedBy: paymentProvider.providerName,
        path: requestDetails.path
      }
    });

    if (existing) {
      const latency = Date.now() - existing.createdAt.getTime();
      paymentFlowMetrics.increment('challenge_to_paid_latency_ms_total', Math.max(0, latency));
      paymentFlowMetrics.increment('challenge_to_paid_latency_samples_total');
    }
  },

  onPaymentConsumed: async (paymentHash, requestDetails) => {
    const domainId = getDomainIdFromContext(requestDetails);

    const [entitlement] = await db.select().from(entitlements).where(and(
      eq(entitlements.paymentHash, paymentHash),
      eq(entitlements.domainId, domainId)
    ));

    if (entitlement) {
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
        await markConsumed(paymentHash);
        throw new Error(res.reason);
      }

      await markConsumed(paymentHash);
      return;
    }

    await markConsumed(paymentHash);
  },

  getPaymentStatus: async (paymentHash, requestDetails) => {
    const domainId = getDomainIdFromContext(requestDetails);

    const [entitlement] = await db.select().from(entitlements).where(and(
      eq(entitlements.paymentHash, paymentHash),
      eq(entitlements.domainId, domainId)
    ));

    if (entitlement) {
      if (entitlement.status === 'revoked' || entitlement.status === 'expired') return 'consumed';
      if (entitlement.expiresAt && new Date() > entitlement.expiresAt) return 'consumed';
      if (entitlement.remainingReads !== null && entitlement.remainingReads <= 0) return 'consumed';
    }

    const [payment] = await db.select().from(payments).where(and(
      eq(payments.paymentHash, paymentHash),
      eq(payments.domainId, domainId)
    ));

    if (payment) {
      return normalizePaymentStatus(payment.status);
    }

    // If domain lookup misses, fallback to hash-only lookup to avoid false negatives
    // when older records were created before strict tenant binding.
    const fallback = await getPaymentByHash(paymentHash);
    return normalizePaymentStatus(fallback?.status);
  }
};
