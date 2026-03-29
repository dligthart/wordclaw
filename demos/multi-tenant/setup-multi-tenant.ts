import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scriptPath = path.resolve(__dirname, '../../scripts/setup-multi-tenant.ts');

const child = spawn('npx', ['tsx', scriptPath], {
    stdio: 'inherit',
});

child.on('exit', (code) => {
    process.exit(code ?? 1);
});
