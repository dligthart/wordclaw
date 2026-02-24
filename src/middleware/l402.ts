import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { PaymentProvider, Invoice } from '../interfaces/payment-provider.js';

// We'll use a simple token generation for the mock L402 since real Macaroons
// require a C-binding library or complex pure-JS library that might be overkill for this phase.
// A real implementation would use 'macaroons.js' or similar.
// For the purpose of the MVP/Phase 6, we implement the L402 protocol flow using signed JWTs or HMAC tokens.

export interface PricingContext {
  resourceType: string;
  operation: string;
  contentTypeId?: number;
  resourceId?: number;
  batchSize?: number;
  proposedPrice?: number;
}

export interface L402Options {
  provider: PaymentProvider;
  getPrice: (context: PricingContext) => Promise<number | null>; // Return null or 0 to bypass L402
  secretKey: string; // Used to sign the macaroon/token
  onInvoiceCreated?: (invoice: Invoice, requestDetails: any, amountSatoshis: number) => Promise<void>;
  onPaymentVerified?: (paymentHash: string, requestDetails: any) => Promise<void>;
  onPaymentConsumed?: (paymentHash: string, requestDetails: any) => Promise<void>;
  getPaymentStatus?: (paymentHash: string, requestDetails: any) => Promise<'pending' | 'paid' | 'consumed'>;
}

/**
 * Generates a simple HMAC-based token that acts as our "Macaroon" for now.
 * It embeds the payment hash and is signed by the server's secret key.
 */
function generateToken(hash: string, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ hash, exp: Date.now() + 3600000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

/**
 * Verifies the HMAC-based token and returns the embedded payment hash if valid.
 */
function verifyToken(token: string, secret: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;

  const expectedSignatureBuffer = Buffer.from(crypto.createHmac('sha256', secret).update(payload).digest('base64url'));
  const signatureBuffer = Buffer.from(signature);

  if (signatureBuffer.length === expectedSignatureBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) {
    try {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
      if (decoded.exp && decoded.exp > Date.now()) {
        return decoded.hash;
      }
    } catch (e) {
      return null;
    }
  }
  return null;
}

export interface L402EnforcementResult {
  ok: boolean;
  paymentConsumed?: boolean;
  mustChallenge?: boolean;
  challengeHeaders?: Record<string, string>;
  errorPayload?: any;
  onFinish?: () => Promise<void>;
}

export async function enforceL402Payment(
  options: L402Options,
  context: PricingContext,
  authHeader: string | undefined,
  requestDetails: any = {}
): Promise<L402EnforcementResult> {
  const requiredPrice = await options.getPrice(context);

  if (requiredPrice === null || requiredPrice <= 0) {
    return { ok: true };
  }

  if (authHeader && authHeader.startsWith('L402 ')) {
    const tokenParts = authHeader.substring(5).split(':');
    if (tokenParts.length === 2) {
      const [token, preimage] = tokenParts;
      const paymentHash = verifyToken(token, options.secretKey);

      if (paymentHash) {
        let status: string = 'pending';

        if (options.getPaymentStatus) {
          status = await options.getPaymentStatus(paymentHash, requestDetails);
        }

        if (status === 'consumed') {
          return {
            ok: false,
            paymentConsumed: true,
            errorPayload: {
              success: false,
              error: {
                code: 'PAYMENT_CONSUMED',
                message: 'This L402 token has already been consumed for a previous request. Please request a new invoice.'
              }
            }
          };
        }

        if (status !== 'consumed') {
          const isPaid = await options.provider.verifyPayment(paymentHash, preimage);

          if (isPaid) {
            if (options.onPaymentVerified) {
              await options.onPaymentVerified(paymentHash, requestDetails);
            }

            return {
              ok: true,
              onFinish: async () => {
                if (options.onPaymentConsumed) {
                  await options.onPaymentConsumed(paymentHash, requestDetails);
                }
              }
            };
          }
        }
      }
    }
  }

  const invoice = await options.provider.createInvoice(requiredPrice, `Payment for ${context.operation} ${context.resourceType}`);

  if (options.onInvoiceCreated) {
    await options.onInvoiceCreated(invoice, requestDetails, requiredPrice);
  }

  const token = generateToken(invoice.hash, options.secretKey);

  return {
    ok: false,
    mustChallenge: true,
    challengeHeaders: {
      'WWW-Authenticate': `L402 macaroon="${token}", invoice="${invoice.paymentRequest}"`
    },
    errorPayload: {
      success: false,
      error: {
        code: 'PAYMENT_REQUIRED',
        message: 'This operation requires a Lightning Network payment. Please pay the invoice and retry with the L402 Authorization header.',
        details: {
          invoice: invoice.paymentRequest,
          macaroon: token,
          amountSatoshis: requiredPrice
        }
      },
      recommendedNextAction: 'pay_invoice_and_retry'
    }
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
        if (batchSize > 0 && request.body[0].contentTypeId) {
          contentTypeId = Number(request.body[0].contentTypeId);
        }
      } else if (typeof request.body === 'object') {
        const body = request.body as any;
        if (body.contentTypeId) {
          contentTypeId = Number(body.contentTypeId);
        }
      }
    }

    if (request.params) {
      const params = request.params as any;
      if (params.contentTypeId) contentTypeId = Number(params.contentTypeId);
      if (params.id) resourceId = Number(params.id);
    }

    let operation = 'read';
    if (request.method === 'POST') operation = 'create';
    if (request.method === 'PUT' || request.method === 'PATCH') operation = 'update';
    if (request.method === 'DELETE') operation = 'delete';

    const context: PricingContext = {
      resourceType: request.url.includes('content-items') ? 'content-item' : 'unknown',
      operation,
      contentTypeId,
      resourceId,
      batchSize,
      proposedPrice
    };

    const sanitizedHeaders: Record<string, string | string[] | undefined> = { ...request.headers };
    if (sanitizedHeaders['x-api-key']) sanitizedHeaders['x-api-key'] = '[REDACTED]';
    if (sanitizedHeaders.authorization) sanitizedHeaders.authorization = '[REDACTED]';

    const enforcementParams = {
      path: request.url,
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
        reply.raw.on('finish', async () => {
          if (reply.statusCode >= 200 && reply.statusCode < 300) {
            await result.onFinish!();
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
