export interface Invoice {
  id: string;
  paymentRequest: string; // The Lightning invoice string (e.g., lnbc...)
  hash: string;           // The payment hash (for verifying preimage)
  amountSatoshis: number;
}

export interface PaymentProvider {
  /**
   * Generates a new Lightning invoice.
   * @param amountSatoshis The amount in satoshis
   * @param memo Optional description for the invoice
   */
  createInvoice(amountSatoshis: number, memo?: string): Promise<Invoice>;

  /**
   * Verifies if a payment has been settled.
   * @param hash The payment hash of the invoice
   * @param preimage The preimage provided by the client (optional, provider might just check status by hash)
   */
  verifyPayment(hash: string, preimage?: string): Promise<boolean>;
}
