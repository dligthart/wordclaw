import {
  Invoice,
  PaymentProvider,
  PaymentVerificationResult,
  ProviderPaymentStatus
} from '../interfaces/payment-provider.js';

type JsonObject = Record<string, unknown>;

export interface LnbitsPaymentProviderOptions {
  baseUrl: string;
  adminKey: string;
  invoiceExpirySeconds?: number;
  timeoutMs?: number;
}

class PaymentProviderHttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'PaymentProviderHttpError';
    this.statusCode = statusCode;
  }
}

export class LnbitsPaymentProvider implements PaymentProvider {
  readonly providerName = 'lnbits';

  private readonly baseUrl: string;
  private readonly adminKey: string;
  private readonly invoiceExpirySeconds: number;
  private readonly timeoutMs: number;

  constructor(options: LnbitsPaymentProviderOptions) {
    const normalizedUrl = options.baseUrl.trim();
    if (!normalizedUrl) {
      throw new Error('LNbits baseUrl is required');
    }
    if (!options.adminKey.trim()) {
      throw new Error('LNbits adminKey is required');
    }

    this.baseUrl = normalizedUrl.replace(/\/+$/, '');
    this.adminKey = options.adminKey;
    this.invoiceExpirySeconds = options.invoiceExpirySeconds ?? 3600;
    this.timeoutMs = options.timeoutMs ?? 10000;
  }

  async createInvoice(amountSatoshis: number, memo?: string): Promise<Invoice> {
    const payload = {
      out: false,
      amount: amountSatoshis,
      memo: memo ?? '',
      expiry: this.invoiceExpirySeconds
    };

    const response = await this.request<JsonObject>('POST', '/api/v1/payments', payload);
    const paymentRequest = readString(response, ['payment_request', 'paymentRequest', 'bolt11']);
    const paymentHash = readString(response, ['payment_hash', 'paymentHash', 'checking_id', 'checkingId', 'hash']);
    const providerInvoiceId = readString(response, ['checking_id', 'checkingId', 'payment_hash', 'paymentHash', 'id']) ?? paymentHash;
    const expiresAt = deriveExpiryDate(response, this.invoiceExpirySeconds);

    if (!paymentRequest || !paymentHash || !providerInvoiceId) {
      throw new Error('LNbits createInvoice response missing required fields');
    }

    return {
      id: providerInvoiceId,
      provider: this.providerName,
      providerInvoiceId,
      paymentRequest,
      hash: paymentHash,
      amountSatoshis,
      expiresAt
    };
  }

  async verifyPayment(hash: string, _preimage?: string): Promise<PaymentVerificationResult> {
    return this.getInvoiceStatus(hash);
  }

  async getInvoiceStatus(hash: string): Promise<PaymentVerificationResult> {
    try {
      const response = await this.request<JsonObject>('GET', `/api/v1/payments/${encodeURIComponent(hash)}`);
      return mapLnbitsStatus(response);
    } catch (error) {
      if (error instanceof PaymentProviderHttpError && error.statusCode === 404) {
        return {
          status: 'failed',
          failureReason: 'invoice_not_found'
        };
      }

      throw error;
    }
  }

  private async request<T extends JsonObject>(
    method: 'GET' | 'POST',
    path: string,
    body?: JsonObject
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.adminKey
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal
      });

      const text = await res.text();
      const parsed = text.length > 0 ? safeJsonParse(text) : {};
      const payload = (parsed && typeof parsed === 'object')
        ? parsed as T
        : ({ raw: text } as unknown as T);

      if (!res.ok) {
        throw new PaymentProviderHttpError(res.status, `LNbits API request failed (${res.status})`);
      }

      return payload;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`LNbits request timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function mapLnbitsStatus(payload: JsonObject): PaymentVerificationResult {
  const details = readObject(payload, 'details');
  const paid = readBoolean(payload, ['paid']) ?? (readBoolean(details, ['pending']) === false);
  const expired = readBoolean(payload, ['expired']) ?? readBoolean(details, ['expired']) ?? false;
  const failed = readBoolean(payload, ['failed']) ?? false;

  let status: ProviderPaymentStatus = 'pending';
  if (paid) {
    status = 'paid';
  } else if (expired) {
    status = 'expired';
  } else if (failed) {
    status = 'failed';
  }

  return {
    status,
    providerInvoiceId: readString(payload, ['checking_id', 'checkingId', 'payment_hash', 'paymentHash', 'id']) ?? null,
    settledAt: parseDate(readUnknown(payload, ['paid_at', 'settled_at'])) ?? parseDate(readUnknown(details, ['paid_at', 'settled_at'])) ?? null,
    expiresAt: deriveExpiryDate(payload, 3600),
    failureReason: readString(payload, ['detail', 'reason', 'error']) ?? null,
    raw: payload
  };
}

function readUnknown(value: JsonObject | null, keys: string[]): unknown {
  if (!value) return undefined;
  for (const key of keys) {
    if (key in value) return value[key];
  }
  return undefined;
}

function readObject(value: JsonObject | null, key: string): JsonObject | null {
  if (!value) return null;
  const candidate = value[key];
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  return candidate as JsonObject;
}

function readString(value: JsonObject | null, keys: string[]): string | null {
  const raw = readUnknown(value, keys);
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
}

function readBoolean(value: JsonObject | null, keys: string[]): boolean | null {
  const raw = readUnknown(value, keys);
  if (typeof raw === 'boolean') {
    return raw;
  }
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
    const asMillis = value > 9999999999 ? value : value * 1000;
    const parsed = new Date(asMillis);
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

function deriveExpiryDate(payload: JsonObject, fallbackSeconds: number): Date {
  const details = readObject(payload, 'details');
  const explicit = parseDate(readUnknown(payload, ['expires_at', 'expiresAt']))
    ?? parseDate(readUnknown(details, ['expires_at', 'expiresAt', 'expiry']));
  if (explicit) {
    return explicit;
  }

  return new Date(Date.now() + (fallbackSeconds * 1000));
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
