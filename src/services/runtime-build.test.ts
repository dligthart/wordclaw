import { afterEach, describe, expect, it } from 'vitest';

import { getRuntimeBuildInfo } from './runtime-build.js';

const originalWordClawBuildVersion = process.env.WORDCLAW_BUILD_VERSION;
const originalWordClawBuildCommitSha = process.env.WORDCLAW_BUILD_COMMIT_SHA;
const originalWordClawBuildTime = process.env.WORDCLAW_BUILD_TIME;

function restoreBuildEnv() {
    if (originalWordClawBuildVersion === undefined) {
        delete process.env.WORDCLAW_BUILD_VERSION;
    } else {
        process.env.WORDCLAW_BUILD_VERSION = originalWordClawBuildVersion;
    }

    if (originalWordClawBuildCommitSha === undefined) {
        delete process.env.WORDCLAW_BUILD_COMMIT_SHA;
    } else {
        process.env.WORDCLAW_BUILD_COMMIT_SHA = originalWordClawBuildCommitSha;
    }

    if (originalWordClawBuildTime === undefined) {
        delete process.env.WORDCLAW_BUILD_TIME;
    } else {
        process.env.WORDCLAW_BUILD_TIME = originalWordClawBuildTime;
    }
}

describe('runtime build metadata', () => {
    afterEach(() => {
        restoreBuildEnv();
    });

    it('reads the packaged version when no explicit build overrides are set', () => {
        delete process.env.WORDCLAW_BUILD_VERSION;
        delete process.env.WORDCLAW_BUILD_COMMIT_SHA;
        delete process.env.WORDCLAW_BUILD_TIME;

        const result = getRuntimeBuildInfo();

        expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
        expect(result.commitSha).toBeNull();
        expect(result.buildTime).toBeNull();
    });

    it('prefers explicit build overrides for authenticated runtime inspection', () => {
        process.env.WORDCLAW_BUILD_VERSION = '9.9.9-preview';
        process.env.WORDCLAW_BUILD_COMMIT_SHA = 'abcdef1234567890';
        process.env.WORDCLAW_BUILD_TIME = '2026-04-01T11:22:33.000Z';

        const result = getRuntimeBuildInfo();

        expect(result).toEqual({
            version: '9.9.9-preview',
            commitSha: 'abcdef1234567890',
            buildTime: '2026-04-01T11:22:33.000Z',
        });
    });
});
