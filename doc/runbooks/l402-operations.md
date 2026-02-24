# L402 Operations Runbook

## Scope
This runbook covers operational handling for production L402 payment flows:
- Invoice creation
- Settlement webhooks
- Reconciliation worker
- Payment state transitions

## Key Metrics
- `invoice_create_success_total`
- `invoice_create_failure_total`
- `challenge_to_paid_latency_ms_total`
- `challenge_to_paid_latency_samples_total`
- `webhook_verify_fail_total`
- `reconciliation_corrections_total`
- `reconciliation_fail_total`
- `pending_over_15m_count`

## Alert Suggestions
- Invoice creation failures: alert when `invoice_create_failure_total` increments continuously for 5 minutes.
- Webhook signature failures: alert when `webhook_verify_fail_total` > 0 in a 5 minute window.
- Pending backlog: alert when `pending_over_15m_count` exceeds agreed threshold.
- Reconciliation errors: alert when `reconciliation_fail_total` increments in consecutive runs.

## Provider Outage Fallback
1. Detect elevated invoice creation failures or provider timeout errors.
2. Pause high-volume write operations requiring L402 (feature flag or temporary maintenance mode).
3. Keep reconciliation worker running to recover delayed settlements.
4. Resume normal traffic only after stable invoice creation and webhook processing.

## Secret Rotation (L402 + Webhook)
1. Generate new `L402_SECRET` and `PAYMENT_WEBHOOK_SECRET` in secret manager.
2. Deploy with dual verification window (old + new) at webhook edge if available.
3. Rotate producer-side webhook signing secret.
4. Remove old secrets after verification confirms no old-signature traffic.

## Replay Event Flood Handling
1. Monitor duplicate webhook responses (`202 duplicate=true`) and signature failure rate.
2. Validate replay protection index health (`payment_provider_events_provider_event_idx`).
3. If flood continues, rate-limit webhook source at edge and keep idempotent handler enabled.

## Stuck Pending Cleanup
1. Check `pending_over_15m_count` and inspect recent pending rows.
2. Trigger reconciliation sweep manually if needed.
3. Validate provider status endpoint access and credentials.
4. Confirm terminal transitions (`pending -> paid|expired|failed`) are being applied.
