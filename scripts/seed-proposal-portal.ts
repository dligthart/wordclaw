import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { and, eq } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import {
    contentTypes,
    domains,
    supervisors,
    workflowTransitions,
    workflows,
} from '../src/db/schema.js';
import { createApiKey } from '../src/services/api-key.js';
import { upsertAiProviderConfig } from '../src/services/ai-provider-config.js';
import {
    createWorkforceAgent,
    getWorkforceAgentBySlug,
    updateWorkforceAgent,
} from '../src/services/workforce-agent.js';
import {
    createFormDefinition,
    getFormDefinitionBySlug,
    updateFormDefinition,
} from '../src/services/forms.js';
import { WorkflowService } from '../src/services/workflow.js';

const __dirname = path.resolve(process.cwd(), 'scripts');

const demoDir = path.join(__dirname, '../demos/demo-proposal-portal');
const envPath = path.join(demoDir, '.env.local');
const accountSchemaPath = path.join(demoDir, 'proposal-account.schema.json');
const briefSchemaPath = path.join(demoDir, 'proposal-brief.schema.json');
const proposalSchemaPath = path.join(demoDir, 'proposal.schema.json');

const DEMO_DOMAIN_NAME = 'Proposal Portal Demo';
const DEMO_DOMAIN_HOSTNAME = 'proposal-portal.demo.local';
const DEMO_ACCOUNT_TYPE_SLUG = 'demo-proposal-account';
const DEMO_BRIEF_TYPE_SLUG = 'demo-proposal-brief';
const DEMO_PROPOSAL_TYPE_SLUG = 'demo-proposal';
const DEMO_FORM_SLUG = 'demo-proposal-intake';
const DEMO_WORKFLOW_NAME = 'Demo Proposal Approval';
const DEMO_WORKFORCE_SLUG = 'demo-proposal-writer';
const DEMO_REVIEWER_EMAIL = 'reviewer@proposal-demo.local';
const DEMO_REVIEWER_PASSWORD = 'WordClawDemo!2026';
const DEMO_PORT = 4318;

function readJsonFile(filePath: string) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function providerConfigFromEnv() {
    const type = (process.env.DEMO_PROPOSAL_PROVIDER ?? 'deterministic').trim().toLowerCase();
    if (type === 'openai') {
        const apiKey = process.env.OPENAI_API_KEY?.trim();
        if (!apiKey) {
            throw new Error('DEMO_PROPOSAL_PROVIDER=openai requires OPENAI_API_KEY.');
        }

        return {
            type: 'openai' as const,
            apiKey,
            model: process.env.DEMO_PROPOSAL_OPENAI_MODEL?.trim() || 'gpt-4.1-mini',
        };
    }

    return {
        type: 'deterministic' as const,
        apiKey: null,
        model: null,
    };
}

async function ensureDomain() {
    let [domain] = await db.insert(domains).values({
        name: DEMO_DOMAIN_NAME,
        hostname: DEMO_DOMAIN_HOSTNAME,
    }).onConflictDoNothing().returning();

    if (!domain) {
        [domain] = await db.select()
            .from(domains)
            .where(eq(domains.hostname, DEMO_DOMAIN_HOSTNAME))
            .limit(1);
    }

    if (!domain) {
        throw new Error('Could not provision the demo domain.');
    }

    return domain;
}

async function upsertContentType(input: {
    domainId: number;
    name: string;
    slug: string;
    description: string;
    schema: Record<string, unknown>;
}) {
    const schema = JSON.stringify(input.schema);
    const [existing] = await db.select()
        .from(contentTypes)
        .where(and(
            eq(contentTypes.domainId, input.domainId),
            eq(contentTypes.slug, input.slug),
        ))
        .limit(1);

    if (existing) {
        const [updated] = await db.update(contentTypes)
            .set({
                name: input.name,
                description: input.description,
                schema,
                updatedAt: new Date(),
            })
            .where(eq(contentTypes.id, existing.id))
            .returning();
        return updated;
    }

    const [created] = await db.insert(contentTypes)
        .values({
            domainId: input.domainId,
            name: input.name,
            slug: input.slug,
            description: input.description,
            schema,
        })
        .returning();

    return created;
}

async function ensureWorkflow(domainId: number, contentTypeId: number) {
    let [workflow] = await db.select()
        .from(workflows)
        .where(and(
            eq(workflows.domainId, domainId),
            eq(workflows.contentTypeId, contentTypeId),
            eq(workflows.name, DEMO_WORKFLOW_NAME),
        ))
        .limit(1);

    if (!workflow) {
        workflow = await WorkflowService.createWorkflow(domainId, DEMO_WORKFLOW_NAME, contentTypeId, true);
    } else if (!workflow.active) {
        const [updated] = await db.update(workflows)
            .set({ active: true, updatedAt: new Date() })
            .where(eq(workflows.id, workflow.id))
            .returning();
        workflow = updated;
    }

    let [transition] = await db.select()
        .from(workflowTransitions)
        .where(and(
            eq(workflowTransitions.workflowId, workflow.id),
            eq(workflowTransitions.fromState, 'draft'),
            eq(workflowTransitions.toState, 'published'),
        ))
        .limit(1);

    if (!transition) {
        transition = await WorkflowService.createWorkflowTransition(domainId, workflow.id, 'draft', 'published', []);
    } else {
        const [updated] = await db.update(workflowTransitions)
            .set({ requiredRoles: [] })
            .where(eq(workflowTransitions.id, transition.id))
            .returning();
        transition = updated;
    }

    return { workflow, transition };
}

async function ensureReviewer(domainId: number) {
    const passwordHash = await bcrypt.hash(DEMO_REVIEWER_PASSWORD, 10);
    const [existing] = await db.select()
        .from(supervisors)
        .where(eq(supervisors.email, DEMO_REVIEWER_EMAIL))
        .limit(1);

    if (existing) {
        await db.update(supervisors)
            .set({
                domainId,
                passwordHash,
            })
            .where(eq(supervisors.id, existing.id));
        return existing.id;
    }

    const [created] = await db.insert(supervisors)
        .values({
            email: DEMO_REVIEWER_EMAIL,
            passwordHash,
            domainId,
        })
        .returning();

    return created.id;
}

async function ensureWorkforce(domainId: number, provider: ReturnType<typeof providerConfigFromEnv>) {
    if (provider.type === 'openai' && provider.apiKey) {
        await upsertAiProviderConfig({
            domainId,
            provider: 'openai',
            apiKey: provider.apiKey,
            defaultModel: provider.model,
            settings: {},
        });
    }

    const providerConfig = provider.type === 'openai'
        ? {
            type: 'openai' as const,
            model: provider.model ?? 'gpt-4.1-mini',
            instructions: 'Turn a project brief into a crisp software delivery proposal with concrete scope, approach, and next steps.',
        }
        : {
            type: 'deterministic' as const,
        };

    const existing = await getWorkforceAgentBySlug(domainId, DEMO_WORKFORCE_SLUG);
    if (existing) {
        return updateWorkforceAgent(existing.id, {
            domainId,
            name: 'Proposal Writer',
            slug: DEMO_WORKFORCE_SLUG,
            purpose: 'Draft project proposals from incoming client briefs.',
            soul: 'software-development-proposal-writer',
            provider: providerConfig,
            active: true,
        });
    }

    return createWorkforceAgent({
        domainId,
        name: 'Proposal Writer',
        slug: DEMO_WORKFORCE_SLUG,
        purpose: 'Draft project proposals from incoming client briefs.',
        soul: 'software-development-proposal-writer',
        provider: providerConfig,
        active: true,
    });
}

async function ensureForm(input: {
    domainId: number;
    contentTypeId: number;
    targetContentTypeId: number;
    workflowTransitionId: number;
    workforceAgentId: number;
    provider: ReturnType<typeof providerConfigFromEnv>;
}) {
    const draftGeneration = {
        targetContentTypeId: input.targetContentTypeId,
        workforceAgentId: input.workforceAgentId,
        fieldMap: {
            accountName: 'accountName',
            accountEmail: 'accountEmail',
            companyName: 'companyName',
            projectName: 'projectName',
            requestedOutcome: 'executiveSummary',
            currentSituation: 'currentSituation',
            keyRequirements: 'scopeSummary',
            constraints: 'assumptions',
            budgetRange: 'budgetRange',
            targetTimeline: 'timeline',
        },
        defaultData: {
            title: 'Custom software delivery proposal',
            recommendedApproach: 'Start with a short discovery sprint, convert the brief into a phased implementation plan, and validate scope before build execution.',
            deliveryPlan: 'Phase 1: discovery and scope validation. Phase 2: solution design and build sequencing. Phase 3: delivery, review, and launch handoff.',
            nextSteps: 'Review the proposal, confirm delivery stakeholders, and schedule the kickoff workshop.',
        },
        postGenerationWorkflowTransitionId: input.workflowTransitionId,
        provider: input.provider.type === 'openai'
            ? {
                type: 'openai',
                model: input.provider.model ?? 'gpt-4.1-mini',
            }
            : { type: 'deterministic' },
    };

    const baseInput = {
        domainId: input.domainId,
        name: 'Proposal Intake',
        slug: DEMO_FORM_SLUG,
        description: 'Client-facing brief intake form for generating draft project proposals.',
        contentTypeId: input.contentTypeId,
        fields: [
            { name: 'accountName', label: 'Full name', required: true },
            { name: 'accountEmail', label: 'Email', required: true },
            { name: 'companyName', label: 'Company', required: true },
            { name: 'projectName', label: 'Project name', required: true },
            { name: 'requestedOutcome', label: 'Requested outcome', type: 'textarea', required: true },
            { name: 'currentSituation', label: 'Current situation', type: 'textarea', required: true },
            { name: 'keyRequirements', label: 'Key requirements', type: 'textarea', required: true },
            { name: 'constraints', label: 'Constraints', type: 'textarea', required: false },
            { name: 'budgetRange', label: 'Budget range', required: true },
            { name: 'targetTimeline', label: 'Target timeline', required: true },
        ],
        active: true,
        publicRead: false,
        submissionStatus: 'draft',
        requirePayment: false,
        successMessage: 'Thanks. Your project brief is in drafting and review.',
        draftGeneration,
    };

    const existing = await getFormDefinitionBySlug(input.domainId, DEMO_FORM_SLUG);
    if (existing) {
        return updateFormDefinition(existing.id, baseInput);
    }

    return createFormDefinition(baseInput);
}

async function createDemoApiKey(domainId: number) {
    return createApiKey({
        domainId,
        name: 'Proposal Portal Demo App',
        scopes: ['admin'],
    });
}

function writeDemoEnv(input: {
    apiKey: string;
    domainId: number;
    provider: ReturnType<typeof providerConfigFromEnv>;
}) {
    const sessionSecret = crypto.randomBytes(24).toString('hex');
    const lines = [
        `DEMO_WORDCLAW_API_URL=http://localhost:4000/api`,
        `DEMO_WORDCLAW_API_KEY=${input.apiKey}`,
        `DEMO_WORDCLAW_DOMAIN_ID=${input.domainId}`,
        `DEMO_WORDCLAW_DOMAIN_HOSTNAME=${DEMO_DOMAIN_HOSTNAME}`,
        `DEMO_PROPOSAL_FORM_SLUG=${DEMO_FORM_SLUG}`,
        `DEMO_PROPOSAL_ACCOUNT_TYPE_SLUG=${DEMO_ACCOUNT_TYPE_SLUG}`,
        `DEMO_PROPOSAL_BRIEF_TYPE_SLUG=${DEMO_BRIEF_TYPE_SLUG}`,
        `DEMO_PROPOSAL_PROPOSAL_TYPE_SLUG=${DEMO_PROPOSAL_TYPE_SLUG}`,
        `DEMO_PROPOSAL_PROVIDER_TYPE=${input.provider.type}`,
        `DEMO_PROPOSAL_PROVIDER_MODEL=${input.provider.model ?? ''}`,
        `DEMO_PROPOSAL_WORKFORCE_SLUG=${DEMO_WORKFORCE_SLUG}`,
        `DEMO_PROPOSAL_REVIEWER_EMAIL=${DEMO_REVIEWER_EMAIL}`,
        `DEMO_PROPOSAL_REVIEWER_PASSWORD=${DEMO_REVIEWER_PASSWORD}`,
        `DEMO_PROPOSAL_SESSION_SECRET=${sessionSecret}`,
        `DEMO_PROPOSAL_PORT=${DEMO_PORT}`,
    ];

    fs.writeFileSync(envPath, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
    console.log('=========================================');
    console.log(' Setting up Proposal Portal Demo         ');
    console.log('=========================================\n');

    const provider = providerConfigFromEnv();
    const domain = await ensureDomain();
    const [accountType, briefType, proposalType] = await Promise.all([
        upsertContentType({
            domainId: domain.id,
            name: 'Proposal Portal Account',
            slug: DEMO_ACCOUNT_TYPE_SLUG,
            description: 'Demo-local client account records for the proposal portal demo.',
            schema: readJsonFile(accountSchemaPath),
        }),
        upsertContentType({
            domainId: domain.id,
            name: 'Proposal Brief',
            slug: DEMO_BRIEF_TYPE_SLUG,
            description: 'Client intake briefs that feed proposal draft generation.',
            schema: readJsonFile(briefSchemaPath),
        }),
        upsertContentType({
            domainId: domain.id,
            name: 'Generated Proposal',
            slug: DEMO_PROPOSAL_TYPE_SLUG,
            description: 'Generated proposals that become visible to clients after review approval.',
            schema: readJsonFile(proposalSchemaPath),
        }),
    ]);

    const { transition } = await ensureWorkflow(domain.id, proposalType.id);
    await ensureReviewer(domain.id);
    const workforceAgent = await ensureWorkforce(domain.id, provider);
    await ensureForm({
        domainId: domain.id,
        contentTypeId: briefType.id,
        targetContentTypeId: proposalType.id,
        workflowTransitionId: transition.id,
        workforceAgentId: workforceAgent.id,
        provider,
    });

    const apiKey = await createDemoApiKey(domain.id);
    writeDemoEnv({
        apiKey: apiKey.plaintext,
        domainId: domain.id,
        provider,
    });

    console.log('✅ Proposal portal demo seeded successfully.\n');
    console.log(`Domain: ${DEMO_DOMAIN_NAME} (${DEMO_DOMAIN_HOSTNAME})`);
    console.log(`Provider: ${provider.type}${provider.model ? `:${provider.model}` : ''}`);
    console.log(`Reviewer: ${DEMO_REVIEWER_EMAIL} / ${DEMO_REVIEWER_PASSWORD}`);
    console.log(`Demo env written to: ${envPath}`);
    console.log('\nNext steps:');
    console.log('1. Start WordClaw and its jobs worker: npm run dev');
    console.log('2. Start the demo portal: npm run demo:proposal-portal');
    console.log(`3. Open http://localhost:${DEMO_PORT}`);
    console.log(`4. Review generated proposals in ${'http://localhost:4000/ui/login'}`);
}

main().catch((error) => {
    console.error('Failed to seed proposal portal demo:', error);
    const cause = error && typeof error === 'object' && 'cause' in error
        ? (error as { cause?: unknown }).cause
        : null;
    const causeCode = cause && typeof cause === 'object' && 'code' in cause
        ? (cause as { code?: unknown }).code
        : null;
    const nestedErrors = cause && typeof cause === 'object' && 'errors' in cause && Array.isArray((cause as { errors?: unknown[] }).errors)
        ? (cause as { errors: Array<{ code?: string }> }).errors
        : [];
    const connectionRefused = causeCode === 'ECONNREFUSED' || nestedErrors.some((entry) => entry.code === 'ECONNREFUSED');

    if (connectionRefused) {
        console.error('\nPostgres is not reachable.');
        console.error('Start the local database and WordClaw runtime first, then rerun `npm run demo:seed-proposal-portal`.');
    }
    process.exit(1);
});
