import { FastifyReply, FastifyRequest } from 'fastify';
import MacaroonsBuilder from 'macaroons.js/lib/MacaroonsBuilder';
import MacaroonsVerifier from 'macaroons.js/lib/MacaroonsVerifier';

import {
  Invoice,
  PaymentProvider,
  PaymentVerificationResult,
  ProviderPaymentStatus
} from '../interfaces/payment-provider.js';
import { paymentFlowMetrics } from '../services/payment-metrics.js';

const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours safety cap
const L402_LOCATION = 'wordclaw-l402';

type PaymentState = 'pending' | 'paid' | 'consumed' | 'expired' | 'failed';

type RequestDetails = {
  path?: string;
  domainId?: number;
  requestInfo?: {
    method?: string;
    headers?: Record<string, string | string[] | undefined>;
    ip?: string;
  };
};

export interface PricingContext {
  resourceType: string;
  operation: string;
  contentTypeId?: number;
  resourceId?: number;
  batchSize?: number;
  proposedPrice?: number;
  domainId?: number;
}

export interface L402Options {
  provider: PaymentProvider;
  getPrice: (context: PricingContext) => Promise<number | null>; // Return null or 0 to bypass L402
  secretKey: string;
  onInvoiceCreated?: (invoice: Invoice, requestDetails: RequestDetails, amountSatoshis: number) => Promise<void>;
  onPaymentVerified?: (
    paymentHash: string,
    requestDetails: RequestDetails,
    verification: PaymentVerificationResult
  ) => Promise<void>;
  onPaymentConsumed?: (paymentHash: string, requestDetails: RequestDetails) => Promise<void>;
  onPaymentStatusObserved?: (
    paymentHash: string,
    status: ProviderPaymentStatus,
    requestDetails: RequestDetails,
    verification: PaymentVerificationResult
  ) => Promise<void>;
  getPaymentStatus?: (paymentHash: string, requestDetails: RequestDetails) => Promise<PaymentState>;
}

export interface L402EnforcementResult {
  ok: boolean;
  paymentConsumed?: boolean;
  mustChallenge?: boolean;
  challengeHeaders?: Record<string, string>;
  errorPayload?: Record<string, unknown>;
  onFinish?: () => Promise<void>;
}

export interface L402Challenge {
  invoice: Invoice;
  macaroon: string;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
}

export type L402ChallengeReason = 'initial' | 'invalid' | 'pending' | 'expired' | 'failed';

type ParsedL402Credentials = {
  macaroon: string;
  preimage: string;
};

type MacaroonExpectations = {
  paymentHash: string;
  method: string;
  path: string;
  domainId: number;
  amountSatoshis: number;
};

function getRequestPath(requestDetails: RequestDetails): string {
  const rawPath = requestDetails.path ?? '/api';
  return rawPath.split('?')[0] || '/api';
}

function getRequestMethod(requestDetails: RequestDetails): string {
  return (requestDetails.requestInfo?.method ?? 'GET').toUpperCase();
}

function getDomainId(requestDetails: RequestDetails): number {
  return Number.isInteger(requestDetails.domainId) ? (requestDetails.domainId as number) : 1;
}

function normalizeRequestedPrice(requiredPrice: number): number {
  return Math.max(1, Math.ceil(requiredPrice));
}

function buildTokenExpiry(invoice: Invoice): number {
  const invoiceExpiry = invoice.expiresAt.getTime();
  const upperBound = Date.now() + DEFAULT_TOKEN_TTL_MS;
  return Math.min(invoiceExpiry, upperBound, Date.now() + MAX_TOKEN_TTL_MS);
}

function createMacaroonToken(
  paymentHash: string,
  secret: string,
  method: string,
  path: string,
  domainId: number,
  amountSatoshis: number,
  expiresAtMs: number
): string {
  const macaroon = new MacaroonsBuilder(L402_LOCATION, secret, paymentHash)
    .add_first_party_caveat(`hash = ${paymentHash}`)
    .add_first_party_caveat(`method = ${method}`)
    .add_first_party_caveat(`path = ${path}`)
    .add_first_party_caveat(`domain = ${domainId}`)
    .add_first_party_caveat(`amount = ${amountSatoshis}`)
    .add_first_party_caveat(`expires_at <= ${expiresAtMs}`)
    .getMacaroon();

  return macaroon.serialize();
}

function verifyMacaroonToken(
  token: string,
  secret: string,
  expectations: MacaroonExpectations
): string | null {
  try {
    const macaroon = MacaroonsBuilder.deserialize(token);
    const verifier = new MacaroonsVerifier(macaroon)
      .satisfyExact(`hash = ${expectations.paymentHash}`)
      .satisfyExact(`method = ${expectations.method}`)
      .satisfyExact(`path = ${expectations.path}`)
      .satisfyExact(`domain = ${expectations.domainId}`)
      .satisfyExact(`amount = ${expectations.amountSatoshis}`)
      .satisfyGeneral((caveat: string) => {
        if (!caveat.startsWith('expires_at <= ')) {
          return false;
        }

        const raw = caveat.slice('expires_at <= '.length).trim();
        const expiry = Number(raw);
        return Number.isFinite(expiry) && Date.now() <= expiry;
      });

    if (!verifier.isValid(secret)) {
      return null;
    }

    const identifier = (macaroon as { identifier?: string }).identifier;
    return typeof identifier === 'string' && identifier.length > 0
      ? identifier
      : expectations.paymentHash;
  } catch {
    return null;
  }
}

function parseL402AuthorizationHeader(authHeader: string | undefined): ParsedL402Credentials | null {
  if (!authHeader || !authHeader.startsWith('L402 ')) {
    return null;
  }

  const credential = authHeader.slice(5).trim();
  if (!credential) {
    return null;
  }

  const separatorIndex = credential.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex === credential.length - 1) {
    return null;
  }

  if (credential.indexOf(':', separatorIndex + 1) !== -1) {
    return null;
  }

  const macaroon = credential.slice(0, separatorIndex).trim();
  const preimage = credential.slice(separatorIndex + 1).trim();
  if (!macaroon || !preimage) {
    return null;
  }

  return { macaroon, preimage };
}

function formatAuthenticateHeaderValue(macaroon: string, invoice: string): string {
  const escapedMacaroon = macaroon.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedInvoice = invoice.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `L402 macaroon="${escapedMacaroon}", invoice="${escapedInvoice}"`;
}

function challengeMessage(reason: L402ChallengeReason): string {
  switch (reason) {
    case 'expired':
      return 'Your previous invoice expired. Pay the new invoice and retry with fresh L402 credentials.';
    case 'failed':
      return 'The prior payment could not be settled. Pay the new invoice and retry with fresh L402 credentials.';
    case 'invalid':
      return 'Invalid L402 credentials. Pay the new invoice and retry using Authorization: L402 <macaroon>:<preimage>.';
    case 'pending':
      return 'Payment is still pending. Complete settlement or pay the fresh invoice and retry with new credentials.';
    case 'initial':
    default:
      return 'This operation requires a Lightning Network payment. Pay the invoice and retry with Authorization: L402 <macaroon>:<preimage>.';
  }
}

export async function createL402Challenge(
  options: L402Options,
  context: PricingContext,
  requestDetails: RequestDetails,
  amountSatoshis: number,
  reason: L402ChallengeReason = 'initial'
): Promise<L402Challenge> {
  let invoice: Invoice;
  try {
    invoice = await options.provider.createInvoice(
      amountSatoshis,
      `Payment for ${context.operation} ${context.resourceType}`
    );
  } catch (error) {
    paymentFlowMetrics.increment('invoice_create_failure_total');
    throw error;
  }

  if (options.onInvoiceCreated) {
    await options.onInvoiceCreated(invoice, requestDetails, amountSatoshis);
  }

  const method = getRequestMethod(requestDetails);
  const path = getRequestPath(requestDetails);
  const domainId = getDomainId(requestDetails);
  const tokenExpiry = buildTokenExpiry(invoice);
  const macaroon = createMacaroonToken(
    invoice.hash,
    options.secretKey,
    method,
    path,
    domainId,
    amountSatoshis,
    tokenExpiry
  );

  return {
    invoice,
    macaroon,
    headers: {
      'WWW-Authenticate': formatAuthenticateHeaderValue(macaroon, invoice.paymentRequest)
    },
    payload: {
      error: challengeMessage(reason),
      code: 'PAYMENT_REQUIRED',
      remediation: 'Complete the L402 payment challenge to proceed. Use the invoice and macaroon in the context.',
      context: {
        invoice: invoice.paymentRequest,
        macaroon,
        amountSatoshis,
        reason,
        recommendedNextAction: 'pay_invoice_and_retry'
      }
    }
  };
}

export async function enforceL402Payment(
  options: L402Options,
  context: PricingContext,
  authHeader: string | undefined,
  requestDetails: RequestDetails = {}
): Promise<L402EnforcementResult> {
  const requiredPriceRaw = await options.getPrice(context);

  if (requiredPriceRaw === null || requiredPriceRaw <= 0) {
    return { ok: true };
  }

  const requiredPrice = normalizeRequestedPrice(requiredPriceRaw);
  const parsedCredentials = parseL402AuthorizationHeader(authHeader);
  const method = getRequestMethod(requestDetails);
  const path = getRequestPath(requestDetails);
  const domainId = getDomainId(requestDetails);

  if (parsedCredentials) {
    let paymentHash: string | null = null;
    let initialState: PaymentState = 'pending';

    try {
      const tokenMacaroon = MacaroonsBuilder.deserialize(parsedCredentials.macaroon);
      const tokenHash = (tokenMacaroon as { identifier?: string }).identifier;
      if (typeof tokenHash === 'string' && tokenHash.length > 0) {
        paymentHash = verifyMacaroonToken(parsedCredentials.macaroon, options.secretKey, {
          paymentHash: tokenHash,
          method,
          path,
          domainId,
          amountSatoshis: requiredPrice
        });
      }
    } catch {
      paymentHash = null;
    }

    if (paymentHash) {
      if (options.getPaymentStatus) {
        initialState = await options.getPaymentStatus(paymentHash, requestDetails);
      }

      if (initialState === 'consumed') {
        return {
          ok: false,
          paymentConsumed: true,
          errorPayload: {
            error: 'This L402 token has already been consumed for a previous request. Please request a new invoice.',
            code: 'PAYMENT_CONSUMED',
            remediation: 'Initiate a new purchase challenge to acquire a fresh token.'
          }
        };
      }

      if (initialState === 'expired' || initialState === 'failed') {
        const challenge = await createL402Challenge(options, context, requestDetails, requiredPrice, initialState);
        return {
          ok: false,
          mustChallenge: true,
          challengeHeaders: challenge.headers,
          errorPayload: challenge.payload
        };
      }

      const verification = await options.provider.verifyPayment(paymentHash, parsedCredentials.preimage);

      if (options.onPaymentStatusObserved) {
        await options.onPaymentStatusObserved(paymentHash, verification.status, requestDetails, verification);
      }

      if (verification.status === 'paid') {
        if (options.onPaymentVerified) {
          await options.onPaymentVerified(paymentHash, requestDetails, verification);
        }

        return {
          ok: true,
          onFinish: async () => {
            if (options.onPaymentConsumed) {
              await options.onPaymentConsumed(paymentHash!, requestDetails);
            }
          }
        };
      }

      if (verification.status === 'expired' || verification.status === 'failed') {
        const challenge = await createL402Challenge(options, context, requestDetails, requiredPrice, verification.status);
        return {
          ok: false,
          mustChallenge: true,
          challengeHeaders: challenge.headers,
          errorPayload: challenge.payload
        };
      }

      const pendingChallenge = await createL402Challenge(options, context, requestDetails, requiredPrice, 'pending');
      return {
        ok: false,
        mustChallenge: true,
        challengeHeaders: pendingChallenge.headers,
        errorPayload: pendingChallenge.payload
      };
    }

    const invalidChallenge = await createL402Challenge(options, context, requestDetails, requiredPrice, 'invalid');
    return {
      ok: false,
      mustChallenge: true,
      challengeHeaders: invalidChallenge.headers,
      errorPayload: invalidChallenge.payload
    };
  }

  const challenge = await createL402Challenge(options, context, requestDetails, requiredPrice, 'initial');
  return {
    ok: false,
    mustChallenge: true,
    challengeHeaders: challenge.headers,
    errorPayload: challenge.payload
  };
}

export function l402Middleware(options: L402Options) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    let contentTypeId: number | undefined;
    let resourceId: number | undefined;
    let batchSize = 1;
    let proposedPrice: number | undefined;

    const proposedPriceHeader = request.headers['x-proposed-price'];
    if (typeof proposedPriceHeader === 'string') {
      proposedPrice = parseInt(proposedPriceHeader, 10);
    }

    if (request.body) {
      if (Array.isArray(request.body)) {
        batchSize = request.body.length;
        if (batchSize > 0 && (request.body[0] as { contentTypeId?: number }).contentTypeId) {
          contentTypeId = Number((request.body[0] as { contentTypeId?: number }).contentTypeId);
        }
      } else if (typeof request.body === 'object') {
        const body = request.body as { contentTypeId?: number };
        if (body.contentTypeId) {
          contentTypeId = Number(body.contentTypeId);
        }
      }
    }

    if (request.params) {
      const params = request.params as { contentTypeId?: number; id?: number };
      if (params.contentTypeId) contentTypeId = Number(params.contentTypeId);
      if (params.id) resourceId = Number(params.id);
    }

    let operation = 'read';
    if (request.method === 'POST') operation = 'create';
    if (request.method === 'PUT' || request.method === 'PATCH') operation = 'update';
    if (request.method === 'DELETE') operation = 'delete';

    const path = request.url.split('?')[0];
    const context: PricingContext = {
      resourceType: path.includes('content-items') ? 'content-item' : 'unknown',
      operation,
      contentTypeId,
      resourceId,
      batchSize,
      proposedPrice,
      domainId: request.authPrincipal?.domainId
    };

    const sanitizedHeaders: Record<string, string | string[] | undefined> = { ...request.headers };
    if (sanitizedHeaders['x-api-key']) sanitizedHeaders['x-api-key'] = '[REDACTED]';
    if (sanitizedHeaders.authorization) sanitizedHeaders.authorization = '[REDACTED]';

    const enforcementParams: RequestDetails = {
      path,
      domainId: request.authPrincipal?.domainId,
      requestInfo: {
        method: request.method,
        headers: sanitizedHeaders,
        ip: request.ip
      }
    };

    const result = await enforceL402Payment(
      options,
      context,
      request.headers.authorization,
      enforcementParams
    );

    if (result.ok) {
      if (result.onFinish) {
        reply.raw.on('finish', () => {
          if (reply.statusCode >= 200 && reply.statusCode < 300) {
            result.onFinish!().catch((error) => {
              request.log.error({ err: error }, 'L402 post-consume hook failed');
            });
          }
        });
      }
      return;
    }

    if (result.paymentConsumed) {
      reply.status(403);
      reply.send(result.errorPayload);
      return reply;
    }

    if (result.mustChallenge) {
      reply.status(402);
      if (result.challengeHeaders) {
        for (const [key, value] of Object.entries(result.challengeHeaders)) {
          reply.header(key, value);
        }
      }
      reply.send(result.errorPayload);
      return reply;
    }
  };
}
