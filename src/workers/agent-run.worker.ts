import { getAgentRunWorkerConfig } from '../config/agent-run-worker.js';
import { AgentRunService } from '../services/agent-runs.js';

export type AgentRunWorkerStatus = {
    started: boolean;
    sweepInProgress: boolean;
    intervalMs: number;
    maxRunsPerSweep: number;
    lastSweepStartedAt: string | null;
    lastSweepCompletedAt: string | null;
    lastSweepProcessedRuns: number;
    totalSweeps: number;
    totalProcessedRuns: number;
    lastError: {
        message: string;
        at: string;
    } | null;
};

export class AgentRunWorker {
    private interval: NodeJS.Timeout | null = null;
    private running = false;
    private intervalMs = getAgentRunWorkerConfig().intervalMs;
    private maxRunsPerSweep = getAgentRunWorkerConfig().maxRunsPerSweep;
    private lastSweepStartedAt: Date | null = null;
    private lastSweepCompletedAt: Date | null = null;
    private lastSweepProcessedRuns = 0;
    private totalSweeps = 0;
    private totalProcessedRuns = 0;
    private lastError: { message: string; at: Date } | null = null;

    start(intervalMs?: number, maxRunsPerSweep?: number) {
        if (this.interval) {
            return;
        }

        const config = getAgentRunWorkerConfig();
        this.intervalMs = intervalMs ?? config.intervalMs;
        this.maxRunsPerSweep = maxRunsPerSweep ?? config.maxRunsPerSweep;

        this.interval = setInterval(() => {
            this.runSweep(this.maxRunsPerSweep).catch((error) => {
                console.error('[AgentRunWorker] Sweep failed', error);
            });
        }, this.intervalMs);

        this.runSweep(this.maxRunsPerSweep).catch((error) => {
            console.error('[AgentRunWorker] Startup sweep failed', error);
        });
        console.log(`[AgentRunWorker] Started, running every ${this.intervalMs}ms`);
    }

    stop() {
        if (!this.interval) {
            return;
        }

        clearInterval(this.interval);
        this.interval = null;
        console.log('[AgentRunWorker] Stopped');
    }

    async runSweep(maxRunsPerSweep = 25): Promise<number> {
        if (this.running) {
            return 0;
        }

        this.running = true;
        this.lastSweepStartedAt = new Date();
        try {
            const processedRuns = await AgentRunService.processPendingExecutions(maxRunsPerSweep);
            this.lastSweepProcessedRuns = processedRuns;
            this.totalSweeps += 1;
            this.totalProcessedRuns += processedRuns;
            this.lastSweepCompletedAt = new Date();
            this.lastError = null;
            return processedRuns;
        } catch (error) {
            this.lastSweepCompletedAt = new Date();
            this.lastError = {
                message: (error as Error).message,
                at: this.lastSweepCompletedAt,
            };
            throw error;
        } finally {
            this.running = false;
        }
    }

    getStatus(): AgentRunWorkerStatus {
        return {
            started: this.interval !== null,
            sweepInProgress: this.running,
            intervalMs: this.intervalMs,
            maxRunsPerSweep: this.maxRunsPerSweep,
            lastSweepStartedAt: this.lastSweepStartedAt?.toISOString() ?? null,
            lastSweepCompletedAt: this.lastSweepCompletedAt?.toISOString() ?? null,
            lastSweepProcessedRuns: this.lastSweepProcessedRuns,
            totalSweeps: this.totalSweeps,
            totalProcessedRuns: this.totalProcessedRuns,
            lastError: this.lastError
                ? {
                    message: this.lastError.message,
                    at: this.lastError.at.toISOString(),
                }
                : null,
        };
    }
}

export const agentRunWorker = new AgentRunWorker();
