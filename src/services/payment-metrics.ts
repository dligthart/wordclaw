type MetricName =
  | 'invoice_create_success_total'
  | 'invoice_create_failure_total'
  | 'challenge_to_paid_latency_ms_total'
  | 'challenge_to_paid_latency_samples_total'
  | 'webhook_verify_fail_total'
  | 'reconciliation_corrections_total'
  | 'reconciliation_fail_total'
  | 'pending_over_15m_count';

class PaymentMetricsStore {
  private counters = new Map<MetricName, number>();
  private gauges = new Map<MetricName, number>();

  increment(name: MetricName, delta = 1): void {
    const current = this.counters.get(name) ?? 0;
    this.counters.set(name, current + delta);
  }

  setGauge(name: MetricName, value: number): void {
    this.gauges.set(name, value);
  }

  snapshot(): {
    counters: Record<string, number>;
    gauges: Record<string, number>;
  } {
    return {
      counters: Object.fromEntries(this.counters.entries()),
      gauges: Object.fromEntries(this.gauges.entries())
    };
  }
}

export const paymentFlowMetrics = new PaymentMetricsStore();
