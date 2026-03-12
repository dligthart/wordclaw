import { sql } from 'drizzle-orm';

import { isExperimentalAgentRunsEnabled } from '../config/runtime-features.js';
import { db } from '../db/index.js';
import { buildCapabilityManifest } from './capability-manifest.js';
import { agentRunWorker } from '../workers/agent-run.worker.js';

export type DeploymentCheckLevel = 'ready' | 'degraded' | 'disabled';

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
            agentRuns: agentRunsStatus,
        },
        warnings,
    };
}
