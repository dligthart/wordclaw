import { eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { payments } from '../db/schema.js';
import { ProviderPaymentStatus } from '../interfaces/payment-provider.js';

export type PersistedPaymentStatus = ProviderPaymentStatus | 'consumed';

const ALLOWED_TRANSITIONS: Record<PersistedPaymentStatus, ReadonlySet<PersistedPaymentStatus>> = {
  pending: new Set(['paid', 'expired', 'failed']),
  paid: new Set(['consumed']),
  consumed: new Set(),
  expired: new Set(),
  failed: new Set()
};

export type PaymentTransitionOptions = {
  providerName?: string;
  providerInvoiceId?: string | null;
  providerEventId?: string | null;
  expiresAt?: Date | null;
  settledAt?: Date | null;
  failureReason?: string | null;
  detailsPatch?: Record<string, unknown>;
};

export function canTransitionPaymentStatus(
  from: PersistedPaymentStatus,
  to: PersistedPaymentStatus
): boolean {
  if (from === to) {
    return true;
  }

  return ALLOWED_TRANSITIONS[from].has(to);
}

export async function getPaymentByHash(paymentHash: string) {
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.paymentHash, paymentHash));
  return payment ?? null;
}

export async function transitionPaymentStatus(
  paymentHash: string,
  nextStatus: PersistedPaymentStatus,
  options: PaymentTransitionOptions = {}
) {
  const current = await getPaymentByHash(paymentHash);
  if (!current) {
    return null;
  }

  const currentStatus = normalizeStatus(current.status);
  if (!currentStatus) {
    throw new Error(`Unknown payment status '${current.status}' for payment ${paymentHash}`);
  }

  if (!canTransitionPaymentStatus(currentStatus, nextStatus)) {
    throw new Error(`Invalid payment transition ${currentStatus} -> ${nextStatus} for payment ${paymentHash}`);
  }

  const mergedDetails = mergeDetails(current.details, options.detailsPatch);
  const updates: Partial<typeof payments.$inferInsert> = {
    status: nextStatus,
    updatedAt: new Date(),
    ...(options.providerName !== undefined ? { provider: options.providerName } : {}),
    ...(options.providerInvoiceId !== undefined ? { providerInvoiceId: options.providerInvoiceId } : {}),
    ...(options.providerEventId !== undefined ? { lastEventId: options.providerEventId } : {}),
    ...(options.expiresAt !== undefined ? { expiresAt: options.expiresAt } : {}),
    ...(options.failureReason !== undefined ? { failureReason: options.failureReason } : {}),
    ...(options.settledAt !== undefined ? { settledAt: options.settledAt } : {}),
    ...(nextStatus === 'paid' && options.settledAt === undefined ? { settledAt: new Date() } : {}),
    ...(mergedDetails !== undefined ? { details: mergedDetails } : {})
  };

  const [updated] = await db
    .update(payments)
    .set(updates)
    .where(eq(payments.paymentHash, paymentHash))
    .returning();

  return updated ?? null;
}

export function mapProviderStatusToPersisted(status: ProviderPaymentStatus): PersistedPaymentStatus {
  return status;
}

function normalizeStatus(value: string): PersistedPaymentStatus | null {
  if (
    value === 'pending'
    || value === 'paid'
    || value === 'consumed'
    || value === 'expired'
    || value === 'failed'
  ) {
    return value;
  }

  return null;
}

function mergeDetails(
  existing: unknown,
  patch?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!patch) {
    return undefined;
  }

  const base = (existing && typeof existing === 'object' && !Array.isArray(existing))
    ? existing as Record<string, unknown>
    : {};
  return {
    ...base,
    ...patch
  };
}
