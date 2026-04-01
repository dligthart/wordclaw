import fs from 'node:fs';
import path from 'node:path';

export type RuntimeBuildInfo = {
    version: string;
    commitSha: string | null;
    buildTime: string | null;
};

let cachedPackageVersion: string | null | undefined;

function normalizeOptionalString(value: string | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}

function readPackageVersion() {
    if (cachedPackageVersion !== undefined) {
        return cachedPackageVersion;
    }

    const candidatePaths = [
        path.resolve(__dirname, '../../package.json'),
        path.resolve(process.cwd(), 'package.json'),
    ];

    for (const candidatePath of candidatePaths) {
        try {
            const parsed = JSON.parse(fs.readFileSync(candidatePath, 'utf8')) as { version?: unknown };
            if (typeof parsed.version === 'string' && parsed.version.trim()) {
                cachedPackageVersion = parsed.version.trim();
                return cachedPackageVersion;
            }
        } catch {
            continue;
        }
    }

    cachedPackageVersion = null;
    return cachedPackageVersion;
}

export function getRuntimeBuildInfo(env: NodeJS.ProcessEnv = process.env): RuntimeBuildInfo {
    return {
        version: normalizeOptionalString(env.WORDCLAW_BUILD_VERSION)
            ?? normalizeOptionalString(env.npm_package_version)
            ?? readPackageVersion()
            ?? 'unknown',
        commitSha: normalizeOptionalString(env.WORDCLAW_BUILD_COMMIT_SHA),
        buildTime: normalizeOptionalString(env.WORDCLAW_BUILD_TIME),
    };
}
