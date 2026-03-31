export type RuntimeEnvironmentIssue = {
    envVar: string;
    message: string;
};

export class RuntimeEnvironmentValidationError extends Error {
    readonly code = 'RUNTIME_ENV_VALIDATION_FAILED';
    readonly issues: RuntimeEnvironmentIssue[];

    constructor(issues: RuntimeEnvironmentIssue[]) {
        super(formatRuntimeEnvironmentIssues(issues));
        this.name = 'RuntimeEnvironmentValidationError';
        this.issues = issues;
    }
}

function isNonEmpty(value: string | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

export function isProductionEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.NODE_ENV === 'production';
}

export function resolvePaymentProviderName(env: NodeJS.ProcessEnv = process.env): string {
    const configured = env.PAYMENT_PROVIDER?.trim();
    if (configured) {
        return configured.toLowerCase();
    }

    return isProductionEnvironment(env) ? 'disabled' : 'mock';
}

export function collectRuntimeEnvironmentIssues(env: NodeJS.ProcessEnv = process.env): RuntimeEnvironmentIssue[] {
    if (!isProductionEnvironment(env)) {
        return [];
    }

    const issues: RuntimeEnvironmentIssue[] = [];

    if (!isNonEmpty(env.JWT_SECRET)) {
        issues.push({
            envVar: 'JWT_SECRET',
            message: 'Required in production for supervisor-session JWT signing.'
        });
    }

    if (!isNonEmpty(env.COOKIE_SECRET)) {
        issues.push({
            envVar: 'COOKIE_SECRET',
            message: 'Required in production for supervisor-session cookie signing.'
        });
    }

    const providerName = resolvePaymentProviderName(env);

    if ((providerName === 'lnbits' || providerName === 'mock') && !isNonEmpty(env.L402_SECRET)) {
        issues.push({
            envVar: 'L402_SECRET',
            message: 'Required in production when Lightning payment challenges are enabled.'
        });
    }
    if (providerName === 'lnbits') {
        const providerNote = env.PAYMENT_PROVIDER?.trim()
            ? 'Required when PAYMENT_PROVIDER=lnbits.'
            : 'Required because PAYMENT_PROVIDER defaults to disabled in production unless explicitly set to lnbits.';

        if (!isNonEmpty(env.LNBITS_BASE_URL)) {
            issues.push({
                envVar: 'LNBITS_BASE_URL',
                message: providerNote
            });
        }

        if (!isNonEmpty(env.LNBITS_ADMIN_KEY)) {
            issues.push({
                envVar: 'LNBITS_ADMIN_KEY',
                message: providerNote
            });
        }
    } else if (providerName === 'mock') {
        if (env.ALLOW_MOCK_PROVIDER_IN_PRODUCTION !== 'true') {
            issues.push({
                envVar: 'ALLOW_MOCK_PROVIDER_IN_PRODUCTION',
                message: 'Set to true only for controlled testing when PAYMENT_PROVIDER=mock in production.'
            });
        }
    } else if (providerName === 'disabled') {
        return issues;
    } else {
        issues.push({
            envVar: 'PAYMENT_PROVIDER',
            message: `Unsupported value '${providerName}'. Supported providers: disabled, mock, lnbits.`
        });
    }

    return issues;
}

export function formatRuntimeEnvironmentIssues(issues: RuntimeEnvironmentIssue[]): string {
    const lines = issues.map((issue) => `- ${issue.envVar}: ${issue.message}`);
    return [
        'Invalid production environment. Resolve the following before starting WordClaw:',
        ...lines
    ].join('\n');
}

export function assertValidRuntimeEnvironment(env: NodeJS.ProcessEnv = process.env): void {
    const issues = collectRuntimeEnvironmentIssues(env);
    if (issues.length > 0) {
        throw new RuntimeEnvironmentValidationError(issues);
    }
}
