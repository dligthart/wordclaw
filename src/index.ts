import dotenv from 'dotenv';
import { db, pool } from './db/index.js';
import { isExperimentalAgentRunsEnabled, isExperimentalRevenueEnabled } from './config/runtime-features.js';
import { accessEventsWorker } from './workers/access-events.js';
import { agentRunWorker } from './workers/agent-run.worker.js';
import { jobsWorker } from './workers/jobs.worker.js';
import { paymentReconciliationWorker } from './workers/payment-reconciliation.js';
import { buildServer } from './server.js';

dotenv.config();

const start = async () => {
    try {
        const server = await buildServer();
        const port = parseInt(process.env.PORT || '4000', 10);
        const host = '0.0.0.0';
        await server.listen({ port, host });
        console.log(`Server listening at http://${host}:${port}`);

        if (process.env.OPENAI_API_KEY) {
            console.log('🧠 Vector RAG enabled (OPENAI_API_KEY detected)');
        } else {
            console.log('💡 Tip: Add OPENAI_API_KEY to enable native Vector RAG and semantic search');
        }

        accessEventsWorker.start(); // Start the background worker
        paymentReconciliationWorker.start();
        jobsWorker.start();
        if (isExperimentalAgentRunsEnabled()) {
            agentRunWorker.start();
        }

        if (isExperimentalRevenueEnabled()) {
            const { allocationStateWorker } = await import('./workers/allocation-state.worker.js');
            allocationStateWorker.start();

            const { payoutWorker } = await import('./workers/payout.worker.js');
            payoutWorker.start();
        }

        const shutdown = async (signal: string) => {
            server.log.info(`Received ${signal}, shutting down gracefully...`);
            try {
                if (isExperimentalRevenueEnabled()) {
                    const { allocationStateWorker } = await import('./workers/allocation-state.worker.js');
                    allocationStateWorker.stop();

                    const { payoutWorker } = await import('./workers/payout.worker.js');
                    payoutWorker.stop();
                }

                accessEventsWorker.stop();
                paymentReconciliationWorker.stop();
                jobsWorker.stop();
                if (isExperimentalAgentRunsEnabled()) {
                    agentRunWorker.stop();
                }
                await server.close();
                await pool.end();
                process.exit(0);
            } catch (err) {
                server.log.error(err, 'Error during shutdown');
                process.exit(1);
            }
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));

    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

start();
