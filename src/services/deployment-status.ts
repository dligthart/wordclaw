import { sql } from 'drizzle-orm';

import { isExperimentalAgentRunsEnabled } from '../config/runtime-features.js';
import { getAssetSignedTtlSeconds } from '../config/assets.js';
import { db } from '../db/index.js';
import { buildCapabilityManifest } from './capability-manifest.js';
import { agentRunWorker } from '../workers/agent-run.worker.js';

export type DeploymentCheckLevel = 'ready' | 'degraded' | 'disabled';

function extractNumericCell(result: unknown, keys: string[]) {
    const firstRow = Array.isArray(result)
        ? result[0]
        : Array.isArray((result as { rows?: unknown[] } | null | undefined)?.rows)
            ? (result as { rows: unknown[] }).rows[0]
            : null;

    if (!firstRow || typeof firstRow !== 'object') {
        return 0;
    }

    for (const key of keys) {
        const candidate = (firstRow as Record<string, unknown>)[key];
        const numeric = Number(candidate);
        if (Number.isFinite(numeric)) {
            return numeric;
        }
    }

    return 0;
}

export type DeploymentStatusSnapshot = {
    generatedAt: string;
    overallStatus: 'ready' | 'degraded';
    checks: {
        database: {
            status: DeploymentCheckLevel;
            note: string;
        };
        restApi: {
            status: DeploymentCheckLevel;
            basePath: string;
            note: string;
        };
        bootstrap: {
            status: DeploymentCheckLevel;
            domainCount: number;
            contentWritesRequireDomain: boolean;
            supportsInBandDomainCreation: boolean;
            restCreateDomainPath: string | null;
            mcpCreateDomainTool: string | null;
            nextAction: string;
            note: string;
        };
        auth: {
            status: DeploymentCheckLevel;
            authRequired: boolean;
            writeRequiresCredential: boolean;
            insecureLocalAdminEnabled: boolean;
            recommendedActorProfile: string;
            recommendedScopes: string[];
            note: string;
        };
        vectorRag: {
            status: DeploymentCheckLevel;
            enabled: boolean;
            model: string | null;
            restPath: string;
            mcpTool: string;
            requiredEnvironmentVariables: string[];
            reason: string;
            note: string;
        };
        contentRuntime: {
            status: DeploymentCheckLevel;
            fieldAwareQueries: {
                supported: boolean;
                restPath: string;
                mcpTool: string;
                graphqlField: string;
                requiresContentTypeId: boolean;
            };
            projections: {
                supported: boolean;
                restPath: string;
                mcpTool: string;
                graphqlField: string;
                metrics: string[];
                requiresContentTypeId: boolean;
            };
            publicWriteLane: {
                supported: boolean;
                issueTokenPath: string;
                createPath: string;
                updatePath: string;
                tokenHeader: string;
                requiresSchemaPolicy: boolean;
            };
            lifecycle: {
                supported: boolean;
                triggerMode: string;
                schemaExtension: string;
                includeArchivedFlag: string;
                defaultArchiveStatus: string;
            };
            note: string;
        };
        mcp: {
            status: DeploymentCheckLevel;
            endpoint: string;
            transports: string[];
            attachable: boolean;
            reactive: {
                supported: boolean;
                transport: string;
                subscriptionTool: string;
                notificationMethod: string;
                supportedTopicCount: number;
                supportedRecipeCount: number;
                supportedFilterFields: string[];
            };
            note: string;
        };
        assetStorage: {
            status: DeploymentCheckLevel;
            enabled: boolean;
            configuredProvider: string;
            effectiveProvider: string;
            fallbackApplied: boolean;
            supportedProviders: string[];
            restUploadModes: string[];
            mcpUploadModes: string[];
            directProviderUpload: {
                enabled: boolean;
                issuePath: string;
                completePath: string;
                method: string;
                providers: string[];
            };
            deliveryModes: string[];
            signedAccess: {
                enabled: boolean;
                defaultTtlSeconds: number;
                issuePath: string;
                issueTool: string;
            };
            entitlementDelivery: {
                enabled: boolean;
                offersPath: string;
                contentPath: string;
            };
            derivatives: {
                supported: boolean;
                listPath: string;
                listTool: string;
                sourceField: string;
                variantKeyField: string;
                transformSpecField: string;
            };
            note: string;
        };
        agentRuns: {
            status: DeploymentCheckLevel;
            enabled: boolean;
            workerStarted: boolean;
            sweepInProgress: boolean;
            lastSweepCompletedAt: string | null;
            lastErrorMessage: string | null;
            note: string;
        };
    };
    warnings: string[];
};

export async function getDeploymentStatusSnapshot(): Promise<DeploymentStatusSnapshot> {
    const manifest = buildCapabilityManifest();
    const warnings: string[] = [];
    let overallStatus: 'ready' | 'degraded' = 'ready';

    let databaseStatus: DeploymentStatusSnapshot['checks']['database'] = {
        status: 'ready',
        note: 'Database connectivity check succeeded.',
    };

    try {
        await db.execute(sql`SELECT 1`);
    } catch (error) {
        overallStatus = 'degraded';
        databaseStatus = {
            status: 'degraded',
            note: `Database connectivity check failed: ${(error as Error).message}`,
        };
        warnings.push('Database connectivity failed, so write and read operations may not be reliable.');
    }

    let domainCount = 0;
    if (databaseStatus.status !== 'degraded') {
        try {
            const domainCountResult = await db.execute(sql`SELECT COUNT(*)::int AS total FROM domains`);
            domainCount = extractNumericCell(domainCountResult, ['total', 'count', '?column?']);
        } catch (error) {
            overallStatus = 'degraded';
            warnings.push(`Domain bootstrap check failed: ${(error as Error).message}`);
        }
    }

    const bootstrapBlocked = databaseStatus.status !== 'degraded' && domainCount === 0;
    if (bootstrapBlocked) {
        overallStatus = 'degraded';
        warnings.push('No domains are provisioned yet, so content-type and content-item writes are blocked until bootstrap completes.');
    }

    const agentRunsEnabled = isExperimentalAgentRunsEnabled();
    const workerStatus = agentRunWorker.getStatus();
    let agentRunsStatus: DeploymentStatusSnapshot['checks']['agentRuns'] = {
        status: 'disabled',
        enabled: false,
        workerStarted: false,
        sweepInProgress: false,
        lastSweepCompletedAt: null,
        lastErrorMessage: null,
        note: 'Autonomous run orchestration is disabled in this deployment.',
    };

    if (agentRunsEnabled) {
        const degraded = !workerStatus.started || workerStatus.lastError !== null;
        if (degraded) {
            warnings.push(
                workerStatus.lastError
                    ? 'Agent-run worker reported an error; incubator autonomous execution may be unreliable.'
                    : 'Agent-run worker is enabled but not started.',
            );
        }

        agentRunsStatus = {
            status: degraded ? 'degraded' : 'ready',
            enabled: true,
            workerStarted: workerStatus.started,
            sweepInProgress: workerStatus.sweepInProgress,
            lastSweepCompletedAt: workerStatus.lastSweepCompletedAt,
            lastErrorMessage: workerStatus.lastError?.message ?? null,
            note: degraded
                ? 'Autonomous run orchestration is enabled but not fully healthy.'
                : 'Autonomous run orchestration is enabled and the worker is healthy.',
        };
    }

    const assetStorageStatus: DeploymentStatusSnapshot['checks']['assetStorage'] = {
        status: manifest.assetStorage.fallbackApplied ? 'degraded' : 'ready',
        enabled: manifest.assetStorage.enabled,
        configuredProvider: manifest.assetStorage.configuredProvider,
        effectiveProvider: manifest.assetStorage.effectiveProvider,
        fallbackApplied: manifest.assetStorage.fallbackApplied,
        supportedProviders: [...manifest.assetStorage.supportedProviders],
        restUploadModes: [...manifest.assetStorage.upload.rest.modes],
        mcpUploadModes: [...manifest.assetStorage.upload.mcp.modes],
        directProviderUpload: {
            enabled: manifest.assetStorage.upload.rest.directProviderUpload.enabled,
            issuePath: manifest.assetStorage.upload.rest.directProviderUpload.issuePath,
            completePath: manifest.assetStorage.upload.rest.directProviderUpload.completePath,
            method: manifest.assetStorage.upload.rest.directProviderUpload.method,
            providers: [...manifest.assetStorage.upload.rest.directProviderUpload.providers],
        },
        deliveryModes: [...manifest.assetStorage.delivery.supportedModes],
        signedAccess: {
            enabled: true,
            defaultTtlSeconds: getAssetSignedTtlSeconds(),
            issuePath: manifest.assetStorage.delivery.signed.issuePath,
            issueTool: manifest.assetStorage.delivery.signed.issueTool,
        },
        entitlementDelivery: {
            enabled: true,
            offersPath: manifest.assetStorage.delivery.entitled.offersPath,
            contentPath: manifest.assetStorage.delivery.entitled.contentPath,
        },
        derivatives: {
            supported: manifest.assetStorage.derivatives.supported,
            listPath: manifest.assetStorage.derivatives.listPath,
            listTool: manifest.assetStorage.derivatives.listTool,
            sourceField: manifest.assetStorage.derivatives.sourceField,
            variantKeyField: manifest.assetStorage.derivatives.variantKeyField,
            transformSpecField: manifest.assetStorage.derivatives.transformSpecField,
        },
        note: manifest.assetStorage.fallbackApplied
            ? `Configured asset provider "${manifest.assetStorage.configuredProvider}" is unavailable; the runtime is using "${manifest.assetStorage.effectiveProvider}" instead.`
            : `Asset storage is enabled with the "${manifest.assetStorage.effectiveProvider}" provider.`,
    };

    if (manifest.assetStorage.fallbackApplied) {
        overallStatus = 'degraded';
            warnings.push(
                `Configured asset provider "${manifest.assetStorage.configuredProvider}" is unavailable; the runtime fell back to "${manifest.assetStorage.effectiveProvider}".`
        );
    }

    const vectorRagStatus: DeploymentStatusSnapshot['checks']['vectorRag'] = {
        status: manifest.vectorRag.enabled ? 'ready' : 'disabled',
        enabled: manifest.vectorRag.enabled,
        model: manifest.vectorRag.model,
        restPath: manifest.vectorRag.restPath,
        mcpTool: manifest.vectorRag.mcpTool,
        requiredEnvironmentVariables: [...manifest.vectorRag.requiredEnvironmentVariables],
        reason: manifest.vectorRag.enabled ? 'configured' : 'OPENAI_API_KEY not set',
        note: manifest.vectorRag.note,
    };

    return {
        generatedAt: new Date().toISOString(),
        overallStatus,
        checks: {
            database: databaseStatus,
            restApi: {
                status: 'ready',
                basePath: manifest.protocolSurfaces.rest.basePath,
                note: 'REST API is reachable on the main HTTP server.',
            },
            bootstrap: {
                status: bootstrapBlocked ? 'degraded' : 'ready',
                domainCount,
                contentWritesRequireDomain: manifest.bootstrap.contentWritesRequireDomain,
                supportsInBandDomainCreation: manifest.bootstrap.supportsInBandDomainCreation,
                restCreateDomainPath: manifest.bootstrap.restCreateDomainPath,
                mcpCreateDomainTool: manifest.bootstrap.mcpCreateDomainTool,
                nextAction: bootstrapBlocked
                    ? 'Create the first domain before attempting content-type or content-item writes.'
                    : 'Bootstrap prerequisites are satisfied for content writes.',
                note: bootstrapBlocked
                    ? 'The runtime has no provisioned domains yet, so the first write must bootstrap the workspace.'
                    : 'At least one domain is provisioned for content writes.',
            },
            auth: {
                status: 'ready',
                authRequired: manifest.auth.effective.authRequired,
                writeRequiresCredential: manifest.auth.effective.writeRequiresCredential,
                insecureLocalAdminEnabled: manifest.auth.effective.insecureLocalAdminEnabled,
                recommendedActorProfile: manifest.auth.effective.recommendedActorProfile,
                recommendedScopes: [...manifest.auth.effective.recommendedScopes],
                note: manifest.auth.effective.note,
            },
            vectorRag: vectorRagStatus,
            contentRuntime: {
                status: 'ready',
                fieldAwareQueries: {
                    supported: manifest.contentRuntime.fieldAwareQueries.supported,
                    restPath: manifest.contentRuntime.fieldAwareQueries.restPath,
                    mcpTool: manifest.contentRuntime.fieldAwareQueries.mcpTool,
                    graphqlField: manifest.contentRuntime.fieldAwareQueries.graphqlField,
                    requiresContentTypeId: manifest.contentRuntime.fieldAwareQueries.requiresContentTypeId,
                },
                projections: {
                    supported: manifest.contentRuntime.projections.supported,
                    restPath: manifest.contentRuntime.projections.restPath,
                    mcpTool: manifest.contentRuntime.projections.mcpTool,
                    graphqlField: manifest.contentRuntime.projections.graphqlField,
                    metrics: [...manifest.contentRuntime.projections.metrics],
                    requiresContentTypeId: manifest.contentRuntime.projections.requiresContentTypeId,
                },
                publicWriteLane: {
                    supported: manifest.contentRuntime.publicWriteLane.supported,
                    issueTokenPath: manifest.contentRuntime.publicWriteLane.issueTokenPath,
                    createPath: manifest.contentRuntime.publicWriteLane.createPath,
                    updatePath: manifest.contentRuntime.publicWriteLane.updatePath,
                    tokenHeader: manifest.contentRuntime.publicWriteLane.tokenHeader,
                    requiresSchemaPolicy: manifest.contentRuntime.publicWriteLane.requiresSchemaPolicy,
                },
                lifecycle: {
                    supported: manifest.contentRuntime.lifecycle.supported,
                    triggerMode: manifest.contentRuntime.lifecycle.triggerMode,
                    schemaExtension: manifest.contentRuntime.lifecycle.schemaExtension,
                    includeArchivedFlag: manifest.contentRuntime.lifecycle.includeArchivedFlag,
                    defaultArchiveStatus: manifest.contentRuntime.lifecycle.defaultArchiveStatus,
                },
                note: 'Content runtime supports schema-aware field queries, grouped projections, bounded public write lanes, and lazy archival for TTL-managed session content.',
            },
            mcp: {
                status: 'ready',
                endpoint: manifest.protocolSurfaces.mcp.endpoint,
                transports: [...manifest.protocolSurfaces.mcp.transports],
                attachable: manifest.protocolSurfaces.mcp.attachable,
                reactive: {
                    supported: manifest.protocolSurfaces.mcp.reactive.supported,
                    transport: manifest.protocolSurfaces.mcp.reactive.transport,
                    subscriptionTool: manifest.protocolSurfaces.mcp.reactive.subscriptionTool,
                    notificationMethod: manifest.protocolSurfaces.mcp.reactive.notificationMethod,
                    supportedTopicCount: manifest.protocolSurfaces.mcp.reactive.supportedTopics.length,
                    supportedRecipeCount: manifest.protocolSurfaces.mcp.reactive.subscriptionRecipes.length,
                    supportedFilterFields: [...manifest.protocolSurfaces.mcp.reactive.supportedFilterFields],
                },
                note: manifest.protocolSurfaces.mcp.attachable
                    ? 'MCP supports both local stdio and remote streamable HTTP, including session-backed reactive subscriptions.'
                    : 'MCP is only available through local process attachment.',
            },
            assetStorage: assetStorageStatus,
            agentRuns: agentRunsStatus,
        },
        warnings,
    };
}
