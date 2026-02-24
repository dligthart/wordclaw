import { describe, expect, it } from 'vitest';

import { canTransitionPaymentStatus } from '../payment-ledger.js';

describe('Payment Ledger Transition Rules', () => {
  it('allows valid transitions', () => {
    expect(canTransitionPaymentStatus('pending', 'paid')).toBe(true);
    expect(canTransitionPaymentStatus('pending', 'expired')).toBe(true);
    expect(canTransitionPaymentStatus('pending', 'failed')).toBe(true);
    expect(canTransitionPaymentStatus('paid', 'consumed')).toBe(true);
    expect(canTransitionPaymentStatus('paid', 'paid')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransitionPaymentStatus('pending', 'consumed')).toBe(false);
    expect(canTransitionPaymentStatus('consumed', 'paid')).toBe(false);
    expect(canTransitionPaymentStatus('failed', 'paid')).toBe(false);
    expect(canTransitionPaymentStatus('expired', 'paid')).toBe(false);
  });
});
