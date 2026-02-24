import { and, eq, lt } from 'drizzle-orm';

import { db } from '../db/index.js';
import { payments } from '../db/schema.js';
import { paymentFlowMetrics } from '../services/payment-metrics.js';
import { transitionPaymentStatus } from '../services/payment-ledger.js';
import { globalL402Options } from '../services/l402-config.js';

export class PaymentReconciliationWorker {
  private interval: NodeJS.Timeout | null = null;

  start(intervalMs = 15 * 60 * 1000) {
    if (this.interval) return;

    this.interval = setInterval(() => {
      this.runSweep().catch((error) => {
        paymentFlowMetrics.increment('reconciliation_fail_total');
        console.error('[PaymentReconciliationWorker] Sweep failed', error);
      });
    }, intervalMs);

    this.runSweep().catch((error) => {
      paymentFlowMetrics.increment('reconciliation_fail_total');
      console.error('[PaymentReconciliationWorker] Startup sweep failed', error);
    });
    console.log(`[PaymentReconciliationWorker] Started, running every ${intervalMs}ms`);
  }

  stop() {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = null;
    console.log('[PaymentReconciliationWorker] Stopped');
  }

  async runSweep(staleMinutes = 5, maxRows = 200): Promise<void> {
    const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000);
    const providerName = globalL402Options.provider.providerName;

    const stalePending = await db
      .select()
      .from(payments)
      .where(and(
        eq(payments.status, 'pending'),
        eq(payments.provider, providerName),
        lt(payments.createdAt, staleBefore)
      ))
      .limit(maxRows);

    const over15mCutoff = new Date(Date.now() - 15 * 60 * 1000);
    const pendingOver15m = await db
      .select()
      .from(payments)
      .where(and(
        eq(payments.status, 'pending'),
        eq(payments.provider, providerName),
        lt(payments.createdAt, over15mCutoff)
      ));
    paymentFlowMetrics.setGauge('pending_over_15m_count', pendingOver15m.length);

    for (const row of stalePending) {
      try {
        const status = await globalL402Options.provider.getInvoiceStatus(row.paymentHash);
        if (status.status === 'pending') {
          continue;
        }

        await transitionPaymentStatus(row.paymentHash, status.status, {
          providerName,
          providerInvoiceId: status.providerInvoiceId ?? null,
          expiresAt: status.expiresAt ?? null,
          settledAt: status.settledAt ?? null,
          failureReason: status.failureReason ?? null,
          detailsPatch: {
            reconciledAt: new Date().toISOString(),
            reconciledBy: providerName,
            providerStatus: status.status
          }
        });

        paymentFlowMetrics.increment('reconciliation_corrections_total');
      } catch (error) {
        paymentFlowMetrics.increment('reconciliation_fail_total');
        console.error(`[PaymentReconciliationWorker] Failed reconciling payment ${row.paymentHash}`, error);
      }
    }
  }
}

export const paymentReconciliationWorker = new PaymentReconciliationWorker();
