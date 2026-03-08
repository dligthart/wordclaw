import { AgentRunService } from '../services/agent-runs.js';

export class AgentRunWorker {
    private interval: NodeJS.Timeout | null = null;
    private running = false;

    start(intervalMs = 1000, maxRunsPerSweep = 25) {
        if (this.interval) {
            return;
        }

        this.interval = setInterval(() => {
            this.runSweep(maxRunsPerSweep).catch((error) => {
                console.error('[AgentRunWorker] Sweep failed', error);
            });
        }, intervalMs);

        this.runSweep(maxRunsPerSweep).catch((error) => {
            console.error('[AgentRunWorker] Startup sweep failed', error);
        });
        console.log(`[AgentRunWorker] Started, running every ${intervalMs}ms`);
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
        try {
            return await AgentRunService.processPendingExecutions(maxRunsPerSweep);
        } finally {
            this.running = false;
        }
    }
}

export const agentRunWorker = new AgentRunWorker();
