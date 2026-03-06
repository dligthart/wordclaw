const TRUE_VALUE = 'true';

export const ENABLE_EXPERIMENTAL_REVENUE_ENV = 'ENABLE_EXPERIMENTAL_REVENUE';
export const ENABLE_EXPERIMENTAL_DELEGATION_ENV = 'ENABLE_EXPERIMENTAL_DELEGATION';

export function isExperimentalRevenueEnabled(): boolean {
    return (process.env[ENABLE_EXPERIMENTAL_REVENUE_ENV] || 'false').toLowerCase() === TRUE_VALUE;
}

export function isExperimentalDelegationEnabled(): boolean {
    return (process.env[ENABLE_EXPERIMENTAL_DELEGATION_ENV] || 'false').toLowerCase() === TRUE_VALUE;
}
