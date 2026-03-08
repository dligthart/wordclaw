export const AGENT_RUN_WORKER_INTERVAL_MS_ENV = 'AGENT_RUN_WORKER_INTERVAL_MS';
export const AGENT_RUN_WORKER_BATCH_SIZE_ENV = 'AGENT_RUN_WORKER_BATCH_SIZE';

function parseBoundedInt(
    value: string | undefined,
    fallback: number,
    minimum: number,
    maximum: number
): number {
    if (value === undefined) {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(minimum, Math.min(parsed, maximum));
}

export function getAgentRunWorkerConfig() {
    return {
        intervalMs: parseBoundedInt(process.env[AGENT_RUN_WORKER_INTERVAL_MS_ENV], 1000, 100, 60_000),
        maxRunsPerSweep: parseBoundedInt(process.env[AGENT_RUN_WORKER_BATCH_SIZE_ENV], 25, 1, 250),
    };
}
