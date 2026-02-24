export type ProviderPaymentStatus = 'pending' | 'paid' | 'expired' | 'failed';

export interface Invoice {
  id: string;
  provider: string;
  providerInvoiceId: string;
  paymentRequest: string; // The Lightning invoice string (e.g., lnbc...)
  hash: string; // Payment hash (lookup key for settlement)
  amountSatoshis: number;
  expiresAt: Date;
}

export interface PaymentVerificationResult {
  status: ProviderPaymentStatus;
  providerInvoiceId?: string | null;
  expiresAt?: Date | null;
  settledAt?: Date | null;
  failureReason?: string | null;
  raw?: unknown;
}

export interface PaymentProvider {
  readonly providerName: string;

  /**
   * Generates a new Lightning invoice.
   * @param amountSatoshis The amount in satoshis
   * @param memo Optional description for the invoice
   */
  createInvoice(amountSatoshis: number, memo?: string): Promise<Invoice>;

  /**
   * Verifies payment state for a hash/preimage pair. Providers may ignore
   * `preimage` and evaluate only by invoice hash.
   */
  verifyPayment(hash: string, preimage?: string): Promise<PaymentVerificationResult>;

  /**
   * Fetches invoice settlement state without requiring client-provided preimage.
   */
  getInvoiceStatus(hash: string): Promise<PaymentVerificationResult>;
}
