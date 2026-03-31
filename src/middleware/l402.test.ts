import { describe, expect, it } from 'vitest';

import { enforceL402Payment } from './l402.js';
import { DisabledPaymentProvider } from '../services/disabled-payment-provider.js';

describe('enforceL402Payment', () => {
  it('returns a deterministic provider-unavailable error when payments are disabled', async () => {
    const result = await enforceL402Payment(
      {
        provider: new DisabledPaymentProvider(),
        secretKey: 'disabled-secret',
        getPrice: async () => 250
      },
      {
        resourceType: 'content-item',
        operation: 'read'
      },
      undefined,
      {
        path: '/api/content-items/1',
        requestInfo: {
          method: 'GET',
          headers: {}
        }
      }
    );

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      statusCode: 503,
      errorPayload: expect.objectContaining({
        code: 'PAYMENT_PROVIDER_UNAVAILABLE'
      })
    }));
  });
});
