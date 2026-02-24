import {
  Invoice,
  PaymentProvider,
  PaymentVerificationResult,
  ProviderPaymentStatus
} from '../interfaces/payment-provider';

/**
 * A mock payment provider for testing and development.
 * It generates fake invoices and automatically considers them paid if a specific preimage is provided.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly providerName = 'mock';

  private invoices: Map<string, Invoice> = new Map();
  private statuses: Map<string, ProviderPaymentStatus> = new Map();
  private settledAt: Map<string, Date> = new Map();

  // In a real system, preimage hashes to the payment hash.
  // For mock, we'll just use a static mock preimage.
  public static readonly MOCK_PREIMAGE = 'mock_preimage_12345';

  async createInvoice(amountSatoshis: number, memo?: string): Promise<Invoice> {
    const id = `mock_inv_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const hash = `mock_hash_${cryptoRandomSuffix()}`;
    const expiresAt = new Date(Date.now() + (60 * 60 * 1000));

    const invoice: Invoice = {
      id,
      provider: this.providerName,
      providerInvoiceId: id,
      paymentRequest: `lnbc_mock_${amountSatoshis}_${id}`,
      hash,
      amountSatoshis,
      expiresAt
    };

    this.invoices.set(hash, invoice);
    this.statuses.set(hash, 'pending');
    return invoice;
  }

  async verifyPayment(hash: string, preimage?: string): Promise<PaymentVerificationResult> {
    const invoice = this.invoices.get(hash);
    if (!invoice) {
      return { status: 'failed', failureReason: 'invoice_not_found' };
    }

    if (this.isExpired(hash, invoice)) {
      return {
        status: 'expired',
        providerInvoiceId: invoice.providerInvoiceId,
        expiresAt: invoice.expiresAt
      };
    }

    const currentStatus = this.statuses.get(hash) ?? 'pending';
    if (currentStatus === 'paid') {
      return {
        status: 'paid',
        providerInvoiceId: invoice.providerInvoiceId,
        expiresAt: invoice.expiresAt,
        settledAt: this.settledAt.get(hash) ?? null
      };
    }

    // For mock, settle invoice only when the magic preimage is supplied.
    if (preimage === MockPaymentProvider.MOCK_PREIMAGE) {
      const settledAt = new Date();
      this.statuses.set(hash, 'paid');
      this.settledAt.set(hash, settledAt);
      return {
        status: 'paid',
        providerInvoiceId: invoice.providerInvoiceId,
        expiresAt: invoice.expiresAt,
        settledAt
      };
    }

    return {
      status: 'pending',
      providerInvoiceId: invoice.providerInvoiceId,
      expiresAt: invoice.expiresAt
    };
  }

  async getInvoiceStatus(hash: string): Promise<PaymentVerificationResult> {
    const invoice = this.invoices.get(hash);
    if (!invoice) {
      return { status: 'failed', failureReason: 'invoice_not_found' };
    }

    if (this.isExpired(hash, invoice)) {
      return {
        status: 'expired',
        providerInvoiceId: invoice.providerInvoiceId,
        expiresAt: invoice.expiresAt
      };
    }

    const currentStatus = this.statuses.get(hash) ?? 'pending';
    if (currentStatus === 'paid') {
      return {
        status: 'paid',
        providerInvoiceId: invoice.providerInvoiceId,
        expiresAt: invoice.expiresAt,
        settledAt: this.settledAt.get(hash) ?? null
      };
    }

    return {
      status: currentStatus,
      providerInvoiceId: invoice.providerInvoiceId,
      expiresAt: invoice.expiresAt
    };
  }

  private isExpired(hash: string, invoice: Invoice): boolean {
    if (this.statuses.get(hash) === 'paid') {
      return false;
    }

    if (invoice.expiresAt.getTime() <= Date.now()) {
      this.statuses.set(hash, 'expired');
      return true;
    }

    return false;
  }
}

function cryptoRandomSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}
