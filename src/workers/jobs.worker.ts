import { processPendingJobs } from '../services/jobs.js';

export type JobsWorkerStatus = {
    started: boolean;
    sweepInProgress: boolean;
    intervalMs: number;
    maxJobsPerSweep: number;
    lastSweepStartedAt: string | null;
    lastSweepCompletedAt: string | null;
    lastSweepProcessedJobs: number;
    totalSweeps: number;
    totalProcessedJobs: number;
    lastError: {
        message: string;
        at: string;
    } | null;
};

export class JobsWorker {
    private interval: NodeJS.Timeout | null = null;
    private running = false;
    private intervalMs = 30_000;
    private maxJobsPerSweep = 25;
    private lastSweepStartedAt: Date | null = null;
    private lastSweepCompletedAt: Date | null = null;
    private lastSweepProcessedJobs = 0;
    private totalSweeps = 0;
    private totalProcessedJobs = 0;
    private lastError: { message: string; at: Date } | null = null;

    start(intervalMs = 30_000, maxJobsPerSweep = 25) {
        if (this.interval) {
            return;
        }

        this.intervalMs = intervalMs;
        this.maxJobsPerSweep = maxJobsPerSweep;
        this.interval = setInterval(() => {
            this.runSweep(this.maxJobsPerSweep).catch((error) => {
                console.error('[JobsWorker] Sweep failed', error);
            });
        }, this.intervalMs);

        this.runSweep(this.maxJobsPerSweep).catch((error) => {
            console.error('[JobsWorker] Startup sweep failed', error);
        });
        console.log(`[JobsWorker] Started, running every ${this.intervalMs}ms`);
    }

    stop() {
        if (!this.interval) {
            return;
        }

        clearInterval(this.interval);
        this.interval = null;
        console.log('[JobsWorker] Stopped');
    }

    async runSweep(maxJobsPerSweep = 25): Promise<number> {
        if (this.running) {
            return 0;
        }

        this.running = true;
        this.lastSweepStartedAt = new Date();
        try {
            const processedJobs = await processPendingJobs(maxJobsPerSweep);
            this.lastSweepProcessedJobs = processedJobs;
            this.totalSweeps += 1;
            this.totalProcessedJobs += processedJobs;
            this.lastSweepCompletedAt = new Date();
            this.lastError = null;
            return processedJobs;
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

    getStatus(): JobsWorkerStatus {
        return {
            started: this.interval !== null,
            sweepInProgress: this.running,
            intervalMs: this.intervalMs,
            maxJobsPerSweep: this.maxJobsPerSweep,
            lastSweepStartedAt: this.lastSweepStartedAt?.toISOString() ?? null,
            lastSweepCompletedAt: this.lastSweepCompletedAt?.toISOString() ?? null,
            lastSweepProcessedJobs: this.lastSweepProcessedJobs,
            totalSweeps: this.totalSweeps,
            totalProcessedJobs: this.totalProcessedJobs,
            lastError: this.lastError
                ? {
                    message: this.lastError.message,
                    at: this.lastError.at.toISOString(),
                }
                : null,
        };
    }
}

export const jobsWorker = new JobsWorker();
