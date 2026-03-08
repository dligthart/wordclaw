import { AgentRunService, type AgentRunWithDetails } from '../services/agent-runs.js';
import { agentRunWorker } from '../workers/agent-run.worker.js';

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

export async function settleAgentRun(
    domainId: number,
    runId: number,
    maxSweeps = 6
): Promise<AgentRunWithDetails> {
    let details = await AgentRunService.getRun(domainId, runId);
    if (!details) {
        throw new Error(`Agent run ${runId} was not found in domain ${domainId}.`);
    }

    for (let attempt = 0; attempt < maxSweeps; attempt += 1) {
        if (TERMINAL_STATUSES.has(details.run.status)) {
            return details;
        }

        await agentRunWorker.runSweep();
        details = await AgentRunService.getRun(domainId, runId);
        if (!details) {
            throw new Error(`Agent run ${runId} disappeared during worker settlement.`);
        }
    }

    throw new Error(
        `Agent run ${runId} did not reach a terminal state after ${maxSweeps} worker sweeps. Last status: ${details.run.status}`
    );
}
