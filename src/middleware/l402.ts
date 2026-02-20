import { FastifyRequest, FastifyReply } from 'fastify';
import { PaymentProvider } from '../interfaces/payment-provider';
import * as crypto from 'crypto';

// We'll use a simple token generation for the mock L402 since real Macaroons
// require a C-binding library or complex pure-JS library that might be overkill for this phase.
// A real implementation would use 'macaroons.js' or similar.
// For the purpose of the MVP/Phase 6, we implement the L402 protocol flow using signed JWTs or HMAC tokens.

export interface L402Options {
  provider: PaymentProvider;
  getPrice: (req: FastifyRequest) => Promise<number | null>; // Return null or 0 to bypass L402
  secretKey: string; // Used to sign the macaroon/token
  onInvoiceCreated?: (invoice: any, request: FastifyRequest, requiredPrice: number) => Promise<void>;
  onPaymentVerified?: (paymentHash: string, request: FastifyRequest) => Promise<void>;
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
 * Verifies the HMRC-based token and returns the embedded payment hash if valid.
 */
function verifyToken(token: string, secret: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;

  const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
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

export function l402Middleware(options: L402Options) {
  return async (request: FastifyRequest, reply: FastifyReply) => {

    // First, determine if we even need to challenge this request.
    const requiredPrice = await options.getPrice(request);

    // If getting the price returns null or 0, it means L402 is disabled or not applicable
    // for this specific resource/user, so proceed without challenging.
    if (requiredPrice === null || requiredPrice <= 0) {
      return;
    }

    const authHeader = request.headers.authorization;

    // Check if the client provided an L402 authorization header
    if (authHeader && authHeader.startsWith('L402 ')) {
      // Format: L402 <macaroon>:<preimage>
      const tokenParts = authHeader.substring(5).split(':');
      if (tokenParts.length === 2) {
        const [token, preimage] = tokenParts;

        // Verify the token (macaroon)
        const paymentHash = verifyToken(token, options.secretKey);

        if (paymentHash) {
          // Verify the payment with the provider
          const isPaid = await options.provider.verifyPayment(paymentHash, preimage);

          if (isPaid) {
            if (options.onPaymentVerified) {
              await options.onPaymentVerified(paymentHash, request);
            }
            // Payment is valid, allow the request to proceed
            return;
          }
        }
      }
    }

    // If we reach here, payment is required or the provided token/preimage is invalid.
    // Generate a new invoice using the dynamic required price
    const invoice = await options.provider.createInvoice(requiredPrice, `Payment for ${request.url}`);

    if (options.onInvoiceCreated) {
      await options.onInvoiceCreated(invoice, request, requiredPrice);
    }

    // Generate a new token (macaroon) tied to the invoice hash
    const token = generateToken(invoice.hash, options.secretKey);

    // Send 402 Payment Required response
    reply.status(402);
    reply.header('WWW-Authenticate', `L402 macaroon="${token}", invoice="${invoice.paymentRequest}"`);

    // Return a structured error for the agent
    reply.send({
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
    });

    return reply;
  };
}
