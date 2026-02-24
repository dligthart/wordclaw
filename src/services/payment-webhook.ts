import crypto from 'crypto';

import { ProviderPaymentStatus } from '../interfaces/payment-provider.js';

type JsonObject = Record<string, unknown>;

export type PaymentWebhookEvent = {
  provider: string;
  eventId: string;
  paymentHash: string;
  status: ProviderPaymentStatus;
  providerInvoiceId?: string | null;
  expiresAt?: Date | null;
  settledAt?: Date | null;
  failureReason?: string | null;
  payload: JsonObject;
};

export function computePaymentWebhookSignature(payload: unknown, secret: string): string {
  const body = JSON.stringify(payload ?? {});
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

export function verifyPaymentWebhookSignature(payload: unknown, signature: string, secret: string): boolean {
  const expected = computePaymentWebhookSignature(payload, secret);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const signatureBuffer = Buffer.from(signature.trim(), 'utf8');

  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

export function parsePaymentWebhookEvent(provider: string, payload: unknown): PaymentWebhookEvent | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const body = payload as JsonObject;
  const normalizedProvider = provider.trim().toLowerCase();
  const eventId = readString(body, ['eventId', 'event_id', 'id']);
  const paymentHash = readString(body, ['paymentHash', 'payment_hash', 'hash', 'checking_id', 'checkingId']);
  const status = mapWebhookStatus(body);

  if (!eventId || !paymentHash || !status) {
    return null;
  }

  return {
    provider: normalizedProvider,
    eventId,
    paymentHash,
    status,
    providerInvoiceId: readString(body, ['providerInvoiceId', 'provider_invoice_id', 'checking_id', 'checkingId']) ?? null,
    settledAt: parseDate(readUnknown(body, ['settledAt', 'settled_at', 'paid_at'])) ?? null,
    expiresAt: parseDate(readUnknown(body, ['expiresAt', 'expires_at'])) ?? null,
    failureReason: readString(body, ['failureReason', 'failure_reason', 'reason', 'error']) ?? null,
    payload: body
  };
}

function mapWebhookStatus(payload: JsonObject): ProviderPaymentStatus | null {
  const directStatus = readString(payload, ['status', 'state']);
  if (directStatus) {
    const normalized = directStatus.toLowerCase();
    if (normalized === 'paid' || normalized === 'pending' || normalized === 'expired' || normalized === 'failed') {
      return normalized;
    }
    if (normalized === 'settled' || normalized === 'complete' || normalized === 'completed') {
      return 'paid';
    }
    if (normalized === 'error') {
      return 'failed';
    }
  }

  const paid = readBoolean(payload, ['paid']);
  const pending = readBoolean(payload, ['pending']);
  const expired = readBoolean(payload, ['expired']);
  const failed = readBoolean(payload, ['failed']);

  if (paid === true) return 'paid';
  if (expired === true) return 'expired';
  if (failed === true) return 'failed';
  if (pending === true) return 'pending';

  return null;
}

function readUnknown(value: JsonObject | null, keys: string[]): unknown {
  if (!value) return undefined;
  for (const key of keys) {
    if (key in value) return value[key];
  }
  return undefined;
}

function readString(value: JsonObject | null, keys: string[]): string | null {
  const raw = readUnknown(value, keys);
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
}

function readBoolean(value: JsonObject | null, keys: string[]): boolean | null {
  const raw = readUnknown(value, keys);
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    if (raw.toLowerCase() === 'true') return true;
    if (raw.toLowerCase() === 'false') return false;
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 9999999999 ? value : value * 1000;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      return parseDate(numeric);
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}
