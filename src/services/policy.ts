import { db } from '../db/index.js';
import { policyDecisionLogs } from '../db/schema.js';

export interface OperationContext {
    principal: {
        id?: string;
        domainId: number;
        scopes: string[];
        roles?: string[];
        source: string;
    };
    operation: string;  // e.g., 'content_item.create', 'webhook.delete'
    resource: {
        type: string;
        id?: string;
        domainId?: number;
        contentTypeId?: string;
    };
    environment: {
        protocol: 'rest' | 'graphql' | 'mcp';
        timestamp: Date;
    };
}

export interface PolicyDecision {
    outcome: 'allow' | 'deny' | 'challenge';
    code: string;
    remediation?: string;
    metadata?: Record<string, any>;
    policyVersion: string;
}

const POLICY_VERSION = '1.0.0';

export class PolicyEngine {

    static async evaluate(context: OperationContext): Promise<PolicyDecision> {
        const start = performance.now();
        let decision: PolicyDecision;

        try {
            decision = this.evaluateSync(context);
        } catch (error) {
            // Fail-closed fallback for state mutations
            const isMutation = !context.operation.endsWith('.read') && !context.operation.endsWith('.list');

            decision = {
                outcome: isMutation ? 'deny' : 'allow',
                code: isMutation ? 'POLICY_EVALUATION_FAILED_MUTATION' : 'POLICY_EVALUATION_FAILED_READ_DEGRADED',
                remediation: 'Internal policy engine error occurred. Administrators should check logs.',
                metadata: { error: error instanceof Error ? error.message : String(error) },
                policyVersion: POLICY_VERSION
            };
        }

        const durationMs = Math.round(performance.now() - start);

        // Async unblocking log insertion
        this.logDecision(context, decision, durationMs).catch(err => {
            console.error('Failed to log policy decision:', err);
        });

        return decision;
    }

    private static evaluateSync(context: OperationContext): PolicyDecision {
        const { principal, operation, resource } = context;

        // Admin scope can do everything globally across domains
        if (principal.scopes.includes('admin') || principal.scopes.includes('tenant:admin')) {
            return {
                outcome: 'allow',
                code: 'ALLOWED_ADMIN',
                policyVersion: POLICY_VERSION
            };
        }

        // Cross-Tenant Boundary Enforcement
        if (resource.domainId !== undefined && resource.domainId !== principal.domainId) {
            return {
                outcome: 'deny',
                code: 'TENANT_ISOLATION_VIOLATION',
                remediation: 'The requested resource belongs to a different domain tenant. Access is strictly forbidden.',
                policyVersion: POLICY_VERSION
            }
        }

        // Role-based fallbacks based on capability/operation mapping
        if (operation.startsWith('audit.') || operation.startsWith('payment.')) {
            if (!principal.scopes.includes('audit:read')) {
                return {
                    outcome: 'deny',
                    code: 'MISSING_AUDIT_SCOPE',
                    remediation: 'Provide an API key with the audit:read scope.',
                    policyVersion: POLICY_VERSION
                };
            }
        } else if (operation.endsWith('.read') || operation.endsWith('.list')) {
            if (!principal.scopes.includes('content:read') && !principal.scopes.includes('content:write')) {
                return {
                    outcome: 'deny',
                    code: 'MISSING_CONTENT_READ_SCOPE',
                    remediation: 'Provide an API key with the content:read scope.',
                    policyVersion: POLICY_VERSION
                };
            }
        } else {
            // It's a mutation (create, update, delete, rollback)
            if (!principal.scopes.includes('content:write')) {
                return {
                    outcome: 'deny',
                    code: 'MISSING_CONTENT_WRITE_SCOPE',
                    remediation: 'Provide an API key with the content:write scope.',
                    policyVersion: POLICY_VERSION
                };
            }
        }

        return {
            outcome: 'allow',
            code: 'ALLOWED_SCOPE_MATCH',
            policyVersion: POLICY_VERSION
        };
    }

    private static async logDecision(context: OperationContext, decision: PolicyDecision, durationMs: number) {
        if (process.env.NODE_ENV === 'test') return;

        await db.insert(policyDecisionLogs).values({
            principalId: context.principal.id,
            operation: context.operation,
            resourceType: context.resource.type,
            resourceId: context.resource.id,
            environment: context.environment.protocol,
            outcome: decision.outcome,
            remediation: decision.remediation,
            policyVersion: decision.policyVersion,
            evaluationDurationMs: durationMs
        });
    }
}
