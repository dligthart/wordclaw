import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentRunService } from '../services/agent-runs.js';
import { AgentRunWorker } from './agent-run.worker.js';

describe('AgentRunWorker', () => {
    afterEach(() => {
        delete process.env.AGENT_RUN_WORKER_INTERVAL_MS;
        delete process.env.AGENT_RUN_WORKER_BATCH_SIZE;
        vi.restoreAllMocks();
    });

    it('tracks sweep counters and last success status', async () => {
        const worker = new AgentRunWorker();
        const processSpy = vi.spyOn(AgentRunService, 'processPendingExecutions').mockResolvedValue(3);

        await worker.runSweep(7);

        expect(processSpy).toHaveBeenCalledWith(7);
        expect(worker.getStatus()).toMatchObject({
            started: false,
            sweepInProgress: false,
            intervalMs: 1000,
            maxRunsPerSweep: 25,
            lastSweepProcessedRuns: 3,
            totalSweeps: 1,
            totalProcessedRuns: 3,
            lastError: null
        });
        expect(worker.getStatus().lastSweepStartedAt).not.toBeNull();
        expect(worker.getStatus().lastSweepCompletedAt).not.toBeNull();
    });

    it('prevents overlapping sweeps from double-running execution', async () => {
        const worker = new AgentRunWorker();
        let resolveSweep: ((value: number) => void) | null = null;
        const processSpy = vi.spyOn(AgentRunService, 'processPendingExecutions').mockImplementation(() =>
            new Promise<number>((resolve) => {
                resolveSweep = resolve;
            })
        );

        const firstSweep = worker.runSweep(9);
        await Promise.resolve();

        await expect(worker.runSweep(9)).resolves.toBe(0);
        expect(processSpy).toHaveBeenCalledTimes(1);

        if (!resolveSweep) {
            throw new Error('Expected first sweep to hold an in-flight resolver.');
        }
        const completeSweep: (value: number) => void = resolveSweep;
        completeSweep(5);
        await expect(firstSweep).resolves.toBe(5);

        expect(worker.getStatus()).toMatchObject({
            totalSweeps: 1,
            totalProcessedRuns: 5,
            lastSweepProcessedRuns: 5,
            sweepInProgress: false
        });
    });

    it('reads configured interval and batch size on start', async () => {
        process.env.AGENT_RUN_WORKER_INTERVAL_MS = '2500';
        process.env.AGENT_RUN_WORKER_BATCH_SIZE = '11';

        const worker = new AgentRunWorker();
        const processSpy = vi.spyOn(AgentRunService, 'processPendingExecutions').mockResolvedValue(2);

        worker.start();
        await Promise.resolve();
        await Promise.resolve();

        expect(processSpy).toHaveBeenCalledWith(11);
        expect(worker.getStatus()).toMatchObject({
            started: true,
            intervalMs: 2500,
            maxRunsPerSweep: 11
        });

        worker.stop();
        expect(worker.getStatus().started).toBe(false);
    });

    it('captures the last sweep error for inspection', async () => {
        const worker = new AgentRunWorker();
        vi.spyOn(AgentRunService, 'processPendingExecutions').mockRejectedValue(new Error('boom'));

        await expect(worker.runSweep(4)).rejects.toThrow('boom');
        expect(worker.getStatus()).toMatchObject({
            totalSweeps: 0,
            totalProcessedRuns: 0,
            lastSweepProcessedRuns: 0,
            lastError: {
                message: 'boom'
            }
        });
        expect(worker.getStatus().lastError?.at).toBeTruthy();
    });
});
