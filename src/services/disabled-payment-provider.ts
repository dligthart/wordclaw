import {
  Invoice,
  PaymentProvider,
  PaymentProviderUnavailableError,
  PaymentVerificationResult
} from '../interfaces/payment-provider.js';

const DISABLED_PROVIDER_REMEDIATION =
  'Lightning payments are disabled in this deployment. Set PAYMENT_PROVIDER=lnbits and configure LNBits credentials, or use PAYMENT_PROVIDER=mock only for controlled testing.';

export class DisabledPaymentProvider implements PaymentProvider {
  readonly providerName = 'disabled';

  async createInvoice(_amountSatoshis: number, _memo?: string): Promise<Invoice> {
    throw new PaymentProviderUnavailableError(DISABLED_PROVIDER_REMEDIATION);
  }

  async verifyPayment(_hash: string, _preimage?: string): Promise<PaymentVerificationResult> {
    throw new PaymentProviderUnavailableError(DISABLED_PROVIDER_REMEDIATION);
  }

  async getInvoiceStatus(_hash: string): Promise<PaymentVerificationResult> {
    throw new PaymentProviderUnavailableError(DISABLED_PROVIDER_REMEDIATION);
  }
}
