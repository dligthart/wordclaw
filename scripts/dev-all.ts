import { spawn, type ChildProcess } from 'node:child_process';

function resolveNpmInvocation() {
    const npmExecPath = process.env.npm_execpath;
    if (!npmExecPath) {
        throw new Error('npm_execpath is not set. Run this script through npm.');
    }

    return {
        command: process.execPath,
        baseArgs: [npmExecPath],
    };
}

function startChild(label: string, args: string[]) {
    const npm = resolveNpmInvocation();
    const child = spawn(npm.command, [...npm.baseArgs, ...args], {
        cwd: process.cwd(),
        stdio: 'inherit',
        env: process.env,
    });

    child.on('exit', (code, signal) => {
        if (signal) {
            console.error(`[dev:all] ${label} exited via signal ${signal}`);
            return;
        }

        if (code && code !== 0) {
            console.error(`[dev:all] ${label} exited with code ${code}`);
            shutdown(code);
        }
    });

    return child;
}

const children = new Set<ChildProcess>();
let shuttingDown = false;

function shutdown(exitCode = 0) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    for (const child of children) {
        if (!child.killed) {
            child.kill('SIGTERM');
        }
    }

    setTimeout(() => {
        for (const child of children) {
            if (!child.killed) {
                child.kill('SIGKILL');
            }
        }
        process.exit(exitCode);
    }, 1500).unref();
}

function registerChild(child: ChildProcess) {
    children.add(child);
    child.on('close', () => {
        children.delete(child);
        if (!shuttingDown && children.size === 0) {
            process.exit(0);
        }
    });
}

console.log('[dev:all] Starting API and supervisor UI development servers...');

registerChild(startChild('api', ['run', 'dev']));
registerChild(startChild('ui', ['--prefix', 'ui', 'run', 'dev']));

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
