import { createServer } from 'node:http';

import type { AuditEventPayload } from '../src/services/event-bus.js';
import {
    shouldTriggerVercelDeploy,
    verifyWordClawWebhookSignature,
} from '../src/integrations/vercel-publish-webhook.js';

const HEADER = 'WordClaw Vercel Deploy Webhook';

function printUsage() {
    console.log(`${HEADER}

Environment:
  WORDCLAW_WEBHOOK_SECRET   Shared secret configured on the WordClaw webhook
  VERCEL_DEPLOY_HOOK_URL    Vercel deploy hook URL (optional in dry-run mode)
  PORT                      Listener port (default 4177)
  WEBHOOK_PATH              Listener path (default /wordclaw/publish)
  DRY_RUN                   If "true", log publish events without calling Vercel

Example:
  WORDCLAW_WEBHOOK_SECRET=demo-secret DRY_RUN=true npx tsx demos/vercel-deploy-webhook.ts
`);
}

async function readRequestBody(request: Parameters<typeof createServer>[0]): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
}

async function triggerDeploy(
    deployHookUrl: string,
    payload: AuditEventPayload,
    details: Record<string, unknown> | null,
) {
    const response = await fetch(deployHookUrl, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            trigger: 'wordclaw-publish-webhook',
            entityType: payload.entityType,
            entityId: payload.entityId,
            action: payload.action,
            actorId: payload.actorId,
            details,
        }),
    });

    if (!response.ok) {
        throw new Error(`Vercel deploy hook returned ${response.status}.`);
    }
}

async function main() {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        printUsage();
        return;
    }

    const secret = process.env.WORDCLAW_WEBHOOK_SECRET;
    if (!secret) {
        throw new Error('WORDCLAW_WEBHOOK_SECRET is required.');
    }

    const deployHookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
    const port = Number(process.env.PORT ?? 4177);
    const webhookPath = process.env.WEBHOOK_PATH ?? '/wordclaw/publish';
    const dryRun = process.env.DRY_RUN === 'true' || !deployHookUrl;

    const server = createServer(async (request, response) => {
        if (request.method !== 'POST' || request.url !== webhookPath) {
            response.writeHead(404, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: 'Not found' }));
            return;
        }

        const body = await readRequestBody(request);
        const signature = request.headers['x-wordclaw-signature'];
        const signatureValue = Array.isArray(signature) ? signature[0] : signature;

        if (!verifyWordClawWebhookSignature(secret, body, signatureValue)) {
            response.writeHead(401, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: 'Invalid signature' }));
            return;
        }

        const payload = JSON.parse(body) as AuditEventPayload;
        const decision = shouldTriggerVercelDeploy(payload);

        if (!decision.trigger) {
            response.writeHead(202, { 'content-type': 'application/json' });
            response.end(JSON.stringify({
                accepted: false,
                reason: decision.reason,
            }));
            return;
        }

        if (dryRun) {
            console.log('[dry-run] published content detected; skipping Vercel deploy');
            console.log(JSON.stringify({
                entityId: payload.entityId,
                actorId: payload.actorId,
                details: decision.details,
            }, null, 2));

            response.writeHead(202, { 'content-type': 'application/json' });
            response.end(JSON.stringify({
                accepted: true,
                deployed: false,
                dryRun: true,
            }));
            return;
        }

        try {
            await triggerDeploy(deployHookUrl, payload, decision.details);
            response.writeHead(202, { 'content-type': 'application/json' });
            response.end(JSON.stringify({
                accepted: true,
                deployed: true,
            }));
        } catch (error) {
            response.writeHead(502, { 'content-type': 'application/json' });
            response.end(JSON.stringify({
                accepted: false,
                error: error instanceof Error ? error.message : String(error),
            }));
        }
    });

    server.listen(port, '0.0.0.0', () => {
        console.log(`${HEADER} listening on http://127.0.0.1:${port}${webhookPath}`);
        if (dryRun) {
            console.log('Dry-run mode is active. Set VERCEL_DEPLOY_HOOK_URL and DRY_RUN=false to trigger real deployments.');
        }
    });
}

main().catch((error) => {
    console.error(`${HEADER} failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
