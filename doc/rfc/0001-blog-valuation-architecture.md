# RFC 0001: Blog Valuation & Third-Party Metrics Integration

**Author:** AI Assistant  
**Status:** Proposed  
**Date:** 2026-02-21  

## 1. Summary
This RFC proposes a modular architecture to automatically estimate the monetary value of a blog or digital content asset within WordClaw. It outlines a strategy to combine SEO metrics (from providers like Ahrefs) and financial metrics (from providers like Stripe) using a standardized Provider Pattern.

## 2. Dependencies & Graph
*   **Depends on:** Phase 7.0 (API Keys) — Valuation data may be restricted to specific agent API keys.
*   **Depended on by:** RFC 0004 (Offers) — Valuations can automatically inform dynamic `offers.priceSats` adjustments.

## 3. Motivation
Estimating the value of a blog is essential for acquisitions, investments, and understanding the ROI of content strategies. While traffic metrics offer a baseline, a robust valuation requires combining multiple data sources. 

A media holding company managing independent blogs, for instance, needs an automated dashboard to estimate the current market value of their assets to make hold/invest/sell decisions. WordClaw currently lacks automated valuation metrics.

## 4. Proposal
We propose implementing the standard industry valuation formula:
`Valuation = Monthly Net Profit (SDE) × Earnings Multiple`

The "Earnings Multiple" typically ranges from 24x to 45x. This multiple will be dynamically calculated by a `ValuationEngine` which ingests qualitative metrics (like Domain Authority and Traffic Value) and quantitative metrics (like SDE) from third-party APIs. The calculation logic will be entirely driven by a configurable `ValuationPolicy` to avoid hardcoded step functions.

## 5. Technical Design (Architecture)
To build this feature, the system needs to fetch data from diverse providers in a standardized way. A **Provider Pattern** (or Strategy Pattern) is the ideal modular architecture.

### Architecture Components

1.  **Valuation Engine (Core)**: 
    *   Responsible for orchestrating the valuation process.
    *   Calculates the final estimated value by combining standardized data from various providers.
2.  **Provider Interfaces**:
    *   Define strict contracts (TypeScript interfaces) that any specific implementation must adhere to.
    *   Example: `ITrafficMetricProvider`, `IFinancialMetricProvider`.
3.  **Concrete Providers**:
    *   Specific implementations for third-party APIs.
    *   Examples: `AhrefsProvider`, `GoogleAnalyticsProvider`, `StripeProvider`.
4.  **Provider Registry / Factory**:
    *   Manages the available providers and instantiates the correct ones based on user configuration or available API keys.

### Example Code Structure (TypeScript)

```typescript
// --- 1. Interfaces ---
interface ITrafficMetricProvider {
    getName(): string;
    getMetrics(domain: string): Promise<TrafficMetrics>;
}

interface IFinancialMetricProvider {
    getName(): string;
    getSDE(domain: string): Promise<number>; // Seller's Discretionary Earnings
}

type TrafficMetrics = {
    monthlyOrganicTraffic: number;
    trafficValueUsd: number;
    domainAuthority: number;
}

// --- 2. Concrete Implementations ---
class AhrefsProvider implements ITrafficMetricProvider {
    constructor(private apiKey: string) {}

    getName() { return 'Ahrefs'; }

    async getMetrics(domain: string): Promise<TrafficMetrics> {
        // ... API call to Ahrefs ...
        return {
            monthlyOrganicTraffic: 50000,
            trafficValueUsd: 12000,
            domainAuthority: 55
        };
    }
}

class StripeProvider implements IFinancialMetricProvider {
    constructor(private apiKey: string) {}
    
    getName() { return 'Stripe'; }

    async getSDE(domain: string): Promise<number> {
        // ... API call to calculate net profit ...
        return 2500; // $2,500 monthly profit
    }
}

// --- 3. Valuation Engine ---
class ValuationEngine {
    constructor(
        private trafficProvider: ITrafficMetricProvider,
        private financialProvider: IFinancialMetricProvider,
        private policy: ValuationPolicy
    ) {}

    async estimateValue(domain: string): Promise<ValuationResult> {
        // Implement TTL caching here to respect provider rate limits
        try {
            const trafficData = await this.trafficProvider.getMetrics(domain);
            const monthlySDE = await this.financialProvider.getSDE(domain);
            
            let multiple = this.policy.baseMultiple;
            // Apply policy weights based on trafficData...
            
            return {
                estimatedValue: monthlySDE * multiple,
                multiple,
                confidenceScore: 1.0,
                metricsResponded: 2
            };
        } catch (e) {
            // Graceful degradation logic
        }
    }
}
```

### 5.1 Protocol Parity & Caching
Valuation will be strictly exposed across all 3 protocols:
*   **REST**: `GET /api/valuations/:domain`
*   **GraphQL**: `query { domainValuation(domain: "...") }`
*   **MCP**: `estimate_domain_value` tool
*   **Caching**: To prevent API quota exhaustion (e.g., Ahrefs), all valuations are TTL-cached for 24 hours.

## 6. Alternatives Considered
*   **Monolithic Direct Integration:** Hardcoding Ahrefs and Stripe API calls directly into the WordClaw backend. Discarded because it creates tight coupling, makes testing difficult without active subscriptions, and prevents easily swapping out providers (e.g., using Semrush instead of Ahrefs).

## 7. Security & Privacy Implications
The valuation engine requires read-only access to highly sensitive financial data (Stripe/PayPal SDE equivalents) and traffic data. 
*   Provider API keys must be securely encrypted or managed via a robust Secret Manager.
*   The valuation endpoints must be strictly authorized (`admin` or `supervisor` roles only). 
*   All accesses to valuation data trigger structured audit events to ensure governance traceablity.

## 8. Rollout Plan / Milestones
1.  **Phase 1**: Define the TypeScript interfaces and the core mathematical `ValuationEngine`. Include a `MockValuationProvider` for rapid testing parity.
2.  **Phase 2**: Implement configurable `ValuationPolicy` JSON models instead of hardcoded multiple modifiers.
3.  **Phase 3**: Expose REST/GraphQL/MCP parity endpoints with 24-hour TTL caching.
4.  **Phase 4**: Build the `AhrefsProvider` utilizing their Traffic Value and DR metrics.
5.  **Phase 5**: Build the `StripeProvider` to extract net profit figures.
