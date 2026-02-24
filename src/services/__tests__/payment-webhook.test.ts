import { describe, expect, it } from 'vitest';

import {
  computePaymentWebhookSignature,
  parsePaymentWebhookEvent,
  verifyPaymentWebhookSignature
} from '../payment-webhook.js';

describe('Payment Webhook Helpers', () => {
  it('verifies signatures against payload and secret', () => {
    const payload = {
      eventId: 'evt_1',
      paymentHash: 'hash_1',
      status: 'paid'
    };
    const secret = 'test-secret';
    const signature = computePaymentWebhookSignature(payload, secret);

    expect(verifyPaymentWebhookSignature(payload, signature, secret)).toBe(true);
    expect(verifyPaymentWebhookSignature(payload, `${signature}x`, secret)).toBe(false);
  });

  it('parses generic webhook payload shape', () => {
    const event = parsePaymentWebhookEvent('lnbits', {
      event_id: 'evt_2',
      payment_hash: 'hash_2',
      status: 'expired',
      reason: 'timeout'
    });

    expect(event).not.toBeNull();
    expect(event?.eventId).toBe('evt_2');
    expect(event?.paymentHash).toBe('hash_2');
    expect(event?.status).toBe('expired');
    expect(event?.failureReason).toBe('timeout');
  });

  it('returns null when required fields are missing', () => {
    const event = parsePaymentWebhookEvent('lnbits', {
      status: 'paid'
    });
    expect(event).toBeNull();
  });
});
