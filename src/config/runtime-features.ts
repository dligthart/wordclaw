const TRUE_VALUE = 'true';

export const ENABLE_EXPERIMENTAL_REVENUE_ENV = 'ENABLE_EXPERIMENTAL_REVENUE';
export const ENABLE_EXPERIMENTAL_DELEGATION_ENV = 'ENABLE_EXPERIMENTAL_DELEGATION';
export const ENABLE_EXPERIMENTAL_AGENT_RUNS_ENV = 'ENABLE_EXPERIMENTAL_AGENT_RUNS';

function readExplicitFlag(name: string): boolean | null {
    const raw = process.env[name];
    if (raw === undefined) {
        return null;
    }

    return raw.toLowerCase() === TRUE_VALUE;
}

export function isExperimentalRevenueEnabled(): boolean {
    return (process.env[ENABLE_EXPERIMENTAL_REVENUE_ENV] || 'false').toLowerCase() === TRUE_VALUE;
}

export function isExperimentalDelegationEnabled(): boolean {
    return (process.env[ENABLE_EXPERIMENTAL_DELEGATION_ENV] || 'false').toLowerCase() === TRUE_VALUE;
}

export function isExperimentalAgentRunsEnabled(): boolean {
    const explicit = readExplicitFlag(ENABLE_EXPERIMENTAL_AGENT_RUNS_ENV);
    if (explicit !== null) {
        return explicit;
    }

    return process.env.NODE_ENV === 'test';
}
