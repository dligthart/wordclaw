const { execSync } = require('child_process');
try {
  execSync('npx vitest src/__tests__/api-tenant.test.ts --run', { stdio: 'inherit' });
} catch (e) {
  process.exit(e.status);
}
