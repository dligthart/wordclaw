import { describe, it, expect, vi } from 'vitest';
import { l402Middleware } from '../l402';
import { MockPaymentProvider } from '../../services/mock-payment-provider';
import { FastifyRequest, FastifyReply } from 'fastify';

describe('L402 Middleware', () => {
  const provider = new MockPaymentProvider();
  const options = {
    provider,
    getPrice: async () => 100,
    secretKey: 'test-secret'
  };

  const middleware = l402Middleware(options);

  it('should return 402 Payment Required for unauthenticated requests', async () => {
    const request = {
      headers: {},
      url: '/premium/endpoint'
    } as FastifyRequest;

    const reply = {
      status: vi.fn().mockReturnThis(),
      header: vi.fn(),
      send: vi.fn()
    } as unknown as FastifyReply;

    await middleware(request, reply);

    expect(reply.status).toHaveBeenCalledWith(402);
    expect(reply.header).toHaveBeenCalledWith('WWW-Authenticate', expect.stringContaining('L402 macaroon='));
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code: 'PAYMENT_REQUIRED'
      })
    }));
  });

  it('should allow request if valid L402 token and preimage are provided', async () => {
    // 1. Get an invoice and macaroon
    const request1 = {
      headers: {},
      url: '/premium/endpoint'
    } as FastifyRequest;

    let macaroon = '';
    let invoice = '';
    const reply1 = {
      status: vi.fn().mockReturnThis(),
      header: vi.fn((key, value) => {
        if (key === 'WWW-Authenticate') {
          const macaroonMatch = value.match(/macaroon="([^"]+)"/);
          const invoiceMatch = value.match(/invoice="([^"]+)"/);
          if (macaroonMatch) macaroon = macaroonMatch[1];
          if (invoiceMatch) invoice = invoiceMatch[1];
        }
      }),
      send: vi.fn()
    } as unknown as FastifyReply;

    await middleware(request1, reply1);

    expect(macaroon).toBeTruthy();
    expect(invoice).toBeTruthy();

    // 2. Play back the token and preimage
    const request2 = {
      headers: {
        authorization: `L402 ${macaroon}:${MockPaymentProvider.MOCK_PREIMAGE}`
      },
      url: '/premium/endpoint'
    } as FastifyRequest;

    const reply2 = {
      status: vi.fn().mockReturnThis(),
      header: vi.fn(),
      send: vi.fn()
    } as unknown as FastifyReply;

    const result = await middleware(request2, reply2);

    // If it allows the request, it should return undefined (not a reply object)
    expect(result).toBeUndefined();
    expect(reply2.status).not.toHaveBeenCalled();
    expect(reply2.send).not.toHaveBeenCalled();
  });
});
