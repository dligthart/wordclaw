import { PaymentProvider, Invoice } from '../interfaces/payment-provider';

/**
 * A mock payment provider for testing and development.
 * It generates fake invoices and automatically considers them paid if a specific preimage is provided.
 */
export class MockPaymentProvider implements PaymentProvider {
  private invoices: Map<string, Invoice> = new Map();
  // In a real system, preimage hashes to the payment hash. 
  // For mock, we'll just use a static mock preimage.
  public static readonly MOCK_PREIMAGE = 'mock_preimage_12345';
  
  async createInvoice(amountSatoshis: number, memo?: string): Promise<Invoice> {
    const id = `mock_inv_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const hash = `mock_hash_${id}`;
    
    const invoice: Invoice = {
      id,
      paymentRequest: `lnbc_mock_${amountSatoshis}_${id}`,
      hash,
      amountSatoshis
    };
    
    this.invoices.set(hash, invoice);
    return invoice;
  }

  async verifyPayment(hash: string, preimage?: string): Promise<boolean> {
    // Check if the invoice exists
    if (!this.invoices.has(hash)) {
      return false;
    }
    
    // For the mock, we consider it paid if the magic preimage is provided,
    // or if we just want to simulate a paid state.
    if (preimage === MockPaymentProvider.MOCK_PREIMAGE) {
      return true;
    }
    
    return false;
  }
}
