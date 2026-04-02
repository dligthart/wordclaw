import cookie from '@fastify/cookie';
import Fastify, { type FastifyReply } from 'fastify';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { db } from '../../src/db/index.js';
import { jobs, reviewTasks } from '../../src/db/schema.js';

const demoDir = path.resolve(process.cwd(), 'demos/demo-proposal-portal');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.join(demoDir, '.env.local') });

const DEMO_PORT = Number(process.env.DEMO_PROPOSAL_PORT ?? 4318);
const WORDCLAW_API_URL = (process.env.DEMO_WORDCLAW_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');
const WORDCLAW_API_KEY = process.env.DEMO_WORDCLAW_API_KEY ?? '';
const DEMO_DOMAIN_ID = Number(process.env.DEMO_WORDCLAW_DOMAIN_ID ?? 0);
const FORM_SLUG = process.env.DEMO_PROPOSAL_FORM_SLUG ?? 'demo-proposal-intake';
const ACCOUNT_TYPE_SLUG = process.env.DEMO_PROPOSAL_ACCOUNT_TYPE_SLUG ?? 'demo-proposal-account';
const BRIEF_TYPE_SLUG = process.env.DEMO_PROPOSAL_BRIEF_TYPE_SLUG ?? 'demo-proposal-brief';
const PROPOSAL_TYPE_SLUG = process.env.DEMO_PROPOSAL_PROPOSAL_TYPE_SLUG ?? 'demo-proposal';
const SESSION_SECRET = process.env.DEMO_PROPOSAL_SESSION_SECRET ?? '';
const REVIEWER_EMAIL = process.env.DEMO_PROPOSAL_REVIEWER_EMAIL ?? 'reviewer@proposal-demo.local';
const REVIEWER_PASSWORD = process.env.DEMO_PROPOSAL_REVIEWER_PASSWORD ?? 'WordClawDemo!2026';
const PROVIDER_TYPE = process.env.DEMO_PROPOSAL_PROVIDER_TYPE ?? 'deterministic';
const PROVIDER_MODEL = process.env.DEMO_PROPOSAL_PROVIDER_MODEL ?? '';

if (!WORDCLAW_API_KEY || !DEMO_DOMAIN_ID || !SESSION_SECRET) {
    console.error('Missing demo configuration. Run `npm run demo:seed-proposal-portal` first.');
    process.exit(1);
}

type ContentTypeRecord = {
    id: number;
    slug: string;
    name: string;
};

type ContentItemRecord = {
    id: number;
    status: string;
    createdAt: string;
    updatedAt: string;
    data: string | Record<string, unknown>;
};

type JobRecord = typeof jobs.$inferSelect;
type ReviewTaskRecord = typeof reviewTasks.$inferSelect;

type SessionPayload = {
    accountItemId: number;
    email: string;
    fullName: string;
    companyName: string;
    issuedAt: string;
};

type DashboardRequestRow = {
    id: number;
    projectName: string;
    requestedOutcome: string;
    createdAt: string;
    portalStatus: string;
    portalStatusLabel: string;
    jobId: number | null;
    proposalId: number | null;
};

const publicDir = path.join(demoDir, 'public');
const wordclawOrigin = WORDCLAW_API_URL.replace(/\/api$/, '');
let contentTypeCache: Promise<Map<string, ContentTypeRecord>> | null = null;

function jsonObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function readDemoCookie(rawCookie?: string): SessionPayload | null {
    if (!rawCookie) {
        return null;
    }

    const [payloadB64, signature] = rawCookie.split('.');
    if (!payloadB64 || !signature) {
        return null;
    }

    const expectedSignature = crypto
        .createHmac('sha256', SESSION_SECRET)
        .update(payloadB64)
        .digest('base64url');

    if (signature !== expectedSignature) {
        return null;
    }

    try {
        const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as SessionPayload;
        if (!parsed || !nonEmptyString(parsed.email) || !nonEmptyString(parsed.fullName) || !nonEmptyString(parsed.companyName)) {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

function signDemoCookie(payload: SessionPayload) {
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = crypto
        .createHmac('sha256', SESSION_SECRET)
        .update(encodedPayload)
        .digest('base64url');

    return `${encodedPayload}.${signature}`;
}

function setSessionCookie(reply: FastifyReply, payload: SessionPayload) {
    reply.setCookie('proposal_demo_session', signDemoCookie(payload), {
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: false,
        maxAge: 60 * 60 * 24 * 7,
    });
}

function clearSessionCookie(reply: FastifyReply) {
    reply.clearCookie('proposal_demo_session', {
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        secure: false,
    });
}

function normalizeContentData<T extends Record<string, unknown>>(item: ContentItemRecord): T {
    return typeof item.data === 'string'
        ? JSON.parse(item.data) as T
        : item.data as T;
}

async function readStaticFile(name: string) {
    return fs.readFile(path.join(publicDir, name), 'utf8');
}

async function wordclawFetch<T>(pathName: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${WORDCLAW_API_URL}${pathName}`, {
        ...init,
        headers: {
            'x-api-key': WORDCLAW_API_KEY,
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...(init.headers ?? {}),
        },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const errorMessage = [
            typeof payload?.error === 'string' ? payload.error : `Request failed with ${response.status}`,
            typeof payload?.remediation === 'string' ? payload.remediation : null,
        ].filter(Boolean).join(' ');

        throw new Error(errorMessage);
    }

    return payload as T;
}

async function getContentTypesBySlug() {
    if (!contentTypeCache) {
        contentTypeCache = (async () => {
            const payload = await wordclawFetch<{ data: ContentTypeRecord[] }>('/content-types?limit=500');
            return new Map(payload.data.map((entry) => [entry.slug, entry]));
        })();
    }

    return contentTypeCache;
}

async function getRequiredContentTypes() {
    const types = await getContentTypesBySlug();
    const accountType = types.get(ACCOUNT_TYPE_SLUG);
    const briefType = types.get(BRIEF_TYPE_SLUG);
    const proposalType = types.get(PROPOSAL_TYPE_SLUG);
    if (!accountType || !briefType || !proposalType) {
        throw new Error('The proposal portal demo tenant is not fully provisioned. Re-run `npm run demo:seed-proposal-portal`.');
    }

    return { accountType, briefType, proposalType };
}

async function listContentItemsForField(contentTypeId: number, fieldName: string, fieldValue: string, extraParams: Record<string, string> = {}) {
    const query = new URLSearchParams({
        contentTypeId: String(contentTypeId),
        fieldName,
        fieldOp: 'eq',
        fieldValue,
        limit: '100',
        ...extraParams,
    });

    const payload = await wordclawFetch<{ data: ContentItemRecord[] }>(`/content-items?${query.toString()}`);
    return payload.data;
}

async function findAccountByEmail(email: string) {
    const { accountType } = await getRequiredContentTypes();
    const entries = await listContentItemsForField(accountType.id, 'email', email.toLowerCase());
    return entries[0] ?? null;
}

async function createAccount(input: {
    fullName: string;
    email: string;
    companyName: string;
    passwordHash: string;
}) {
    const { accountType } = await getRequiredContentTypes();
    const payload = await wordclawFetch<{ data: ContentItemRecord }>('/content-items', {
        method: 'POST',
        body: JSON.stringify({
            contentTypeId: accountType.id,
            status: 'draft',
            data: {
                fullName: input.fullName,
                email: input.email.toLowerCase(),
                companyName: input.companyName,
                passwordHash: input.passwordHash,
                createdAt: new Date().toISOString(),
            },
        }),
    });

    return payload.data;
}

async function loadLatestDraftJobsByIntakeId(domainId: number) {
    const rows = await db.select()
        .from(jobs)
        .where(and(
            eq(jobs.domainId, domainId),
            eq(jobs.kind, 'draft_generation'),
        ))
        .orderBy(desc(jobs.id));

    const byIntakeId = new Map<number, JobRecord>();
    for (const row of rows) {
        const intakeId = jsonObject(row.payload) && typeof row.payload.intakeContentItemId === 'number'
            ? row.payload.intakeContentItemId
            : null;

        if (intakeId && !byIntakeId.has(intakeId)) {
            byIntakeId.set(intakeId, row);
        }
    }

    return byIntakeId;
}

async function loadLatestReviewTasksByContentItemId(domainId: number, contentItemIds: number[]) {
    if (contentItemIds.length === 0) {
        return new Map<number, ReviewTaskRecord>();
    }

    const rows = await db.select()
        .from(reviewTasks)
        .where(and(
            eq(reviewTasks.domainId, domainId),
            inArray(reviewTasks.contentItemId, contentItemIds),
        ))
        .orderBy(desc(reviewTasks.updatedAt), desc(reviewTasks.id));

    const latest = new Map<number, ReviewTaskRecord>();
    for (const row of rows) {
        if (!latest.has(row.contentItemId)) {
            latest.set(row.contentItemId, row);
        }
    }

    return latest;
}

function derivePortalStatus(input: {
    job: JobRecord | null;
    latestReviewTask: ReviewTaskRecord | null;
    proposalVisible: boolean;
}) {
    if (!input.job) {
        return {
            status: 'submitted',
            label: 'Submitted',
        };
    }

    if (input.job.status === 'queued' || input.job.status === 'running') {
        return {
            status: 'generating',
            label: 'Generating draft',
        };
    }

    if (input.job.status === 'failed') {
        return {
            status: 'failed',
            label: 'Generation failed',
        };
    }

    if (input.latestReviewTask?.status === 'pending') {
        return {
            status: 'awaiting_review',
            label: 'Awaiting human approval',
        };
    }

    if (input.latestReviewTask?.status === 'rejected') {
        return {
            status: 'rejected',
            label: 'Rejected',
        };
    }

    if (input.latestReviewTask?.status === 'approved' || input.proposalVisible) {
        return {
            status: 'published',
            label: 'Published',
        };
    }

    return {
        status: 'generating',
        label: 'Draft ready in WordClaw',
    };
}

async function buildDashboard(email: string) {
    const { briefType, proposalType } = await getRequiredContentTypes();
    const [briefItems, proposalItems, jobsByIntakeId] = await Promise.all([
        listContentItemsForField(briefType.id, 'accountEmail', email, { sortBy: 'createdAt', sortDir: 'desc' }),
        listContentItemsForField(proposalType.id, 'accountEmail', email, { status: 'published', sortBy: 'updatedAt', sortDir: 'desc' }),
        loadLatestDraftJobsByIntakeId(DEMO_DOMAIN_ID),
    ]);

    const generatedProposalIds = Array.from(new Set(
        Array.from(jobsByIntakeId.values()).flatMap((job) => {
            if (!jsonObject(job.result) || typeof job.result.generatedContentItemId !== 'number') {
                return [];
            }

            return [job.result.generatedContentItemId];
        }),
    ));

    const latestReviewTasks = await loadLatestReviewTasksByContentItemId(DEMO_DOMAIN_ID, generatedProposalIds);
    const visibleProposals = proposalItems
        .map((item) => ({
            ...item,
            data: normalizeContentData<Record<string, unknown>>(item),
            latestReviewTask: latestReviewTasks.get(item.id) ?? null,
        }))
        .filter((item) => item.latestReviewTask?.status !== 'pending' && item.latestReviewTask?.status !== 'rejected');

    const visibleProposalIds = new Set(visibleProposals.map((item) => item.id));

    const requests: DashboardRequestRow[] = briefItems.map((brief) => {
        const briefData = normalizeContentData<Record<string, unknown>>(brief);
        const job = jobsByIntakeId.get(brief.id) ?? null;
        const generatedContentItemId = job && jsonObject(job.result) && typeof job.result.generatedContentItemId === 'number'
            ? job.result.generatedContentItemId
            : null;
        const latestReviewTask = generatedContentItemId
            ? latestReviewTasks.get(generatedContentItemId) ?? null
            : null;
        const portalStatus = derivePortalStatus({
            job,
            latestReviewTask,
            proposalVisible: generatedContentItemId ? visibleProposalIds.has(generatedContentItemId) : false,
        });

        return {
            id: brief.id,
            projectName: nonEmptyString(briefData.projectName) ? briefData.projectName : `Brief #${brief.id}`,
            requestedOutcome: nonEmptyString(briefData.requestedOutcome) ? briefData.requestedOutcome : 'Proposal request submitted.',
            createdAt: brief.createdAt,
            portalStatus: portalStatus.status,
            portalStatusLabel: portalStatus.label,
            jobId: job?.id ?? null,
            proposalId: generatedContentItemId,
        };
    });

    return {
        requests,
        proposals: visibleProposals.map((proposal) => ({
            id: proposal.id,
            status: proposal.status,
            createdAt: proposal.createdAt,
            updatedAt: proposal.updatedAt,
            data: proposal.data,
        })),
    };
}

async function main() {
    const app = Fastify({ logger: true });
    await app.register(cookie);

    app.decorateRequest('proposalSession', null);

    app.addHook('preHandler', async (request) => {
        const session = readDemoCookie(request.cookies.proposal_demo_session);
        (request as typeof request & { proposalSession: SessionPayload | null }).proposalSession = session;
    });

    app.get('/', async (_, reply) => {
        reply.type('text/html').send(await readStaticFile('index.html'));
    });

    app.get('/styles.css', async (_, reply) => {
        reply.type('text/css').send(await readStaticFile('styles.css'));
    });

    app.get('/app.js', async (_, reply) => {
        reply.type('application/javascript').send(await readStaticFile('app.js'));
    });

    app.get('/favicon.ico', async (_, reply) => {
        reply.status(204).send();
    });

    app.get('/demo-api/bootstrap', async () => ({
        appName: 'Proposal Portal Demo',
        domainId: DEMO_DOMAIN_ID,
        formSlug: FORM_SLUG,
        providerLabel: PROVIDER_MODEL ? `${PROVIDER_TYPE}:${PROVIDER_MODEL}` : PROVIDER_TYPE,
        reviewer: {
            email: REVIEWER_EMAIL,
            password: REVIEWER_PASSWORD,
            loginUrl: `${wordclawOrigin}/ui/login`,
            approvalsUrl: `${wordclawOrigin}/ui/approvals`,
        },
    }));

    app.get('/demo-api/session', async (request) => {
        const session = (request as typeof request & { proposalSession: SessionPayload | null }).proposalSession;
        return {
            session: session ? {
                user: {
                    accountItemId: session.accountItemId,
                    email: session.email,
                    fullName: session.fullName,
                    companyName: session.companyName,
                },
            } : null,
        };
    });

    app.post('/demo-api/register', async (request, reply) => {
        const body = request.body as Record<string, unknown>;
        const fullName = nonEmptyString(body.fullName) ? body.fullName.trim() : '';
        const companyName = nonEmptyString(body.companyName) ? body.companyName.trim() : '';
        const email = nonEmptyString(body.email) ? body.email.trim().toLowerCase() : '';
        const password = nonEmptyString(body.password) ? body.password : '';

        if (!fullName || !companyName || !email || password.length < 8) {
            return reply.status(400).send({
                error: 'Missing registration fields',
                remediation: 'Provide full name, company, email, and a password with at least 8 characters.',
            });
        }

        const existing = await findAccountByEmail(email);
        if (existing) {
            return reply.status(409).send({
                error: 'Account already exists',
                remediation: 'Sign in with the existing email or choose a different address.',
            });
        }

        const bcrypt = await import('bcryptjs');
        const passwordHash = await bcrypt.hash(password, 10);
        const created = await createAccount({
            fullName,
            companyName,
            email,
            passwordHash,
        });

        setSessionCookie(reply, {
            accountItemId: created.id,
            email,
            fullName,
            companyName,
            issuedAt: new Date().toISOString(),
        });

        return { ok: true };
    });

    app.post('/demo-api/login', async (request, reply) => {
        const body = request.body as Record<string, unknown>;
        const email = nonEmptyString(body.email) ? body.email.trim().toLowerCase() : '';
        const password = nonEmptyString(body.password) ? body.password : '';

        if (!email || !password) {
            return reply.status(400).send({
                error: 'Missing login fields',
                remediation: 'Provide both email and password to sign in.',
            });
        }

        const account = await findAccountByEmail(email);
        if (!account) {
            return reply.status(404).send({
                error: 'Account not found',
                remediation: 'Register a new client account before requesting a proposal.',
            });
        }

        const data = normalizeContentData<Record<string, unknown>>(account);
        if (!nonEmptyString(data.passwordHash)) {
            return reply.status(409).send({
                error: 'Account is incomplete',
                remediation: 'Delete and recreate the demo account, or reseed the proposal portal demo.',
            });
        }

        const bcrypt = await import('bcryptjs');
        const valid = await bcrypt.compare(password, data.passwordHash);
        if (!valid) {
            return reply.status(401).send({
                error: 'Invalid password',
                remediation: 'Retry with the correct password.',
            });
        }

        setSessionCookie(reply, {
            accountItemId: account.id,
            email,
            fullName: nonEmptyString(data.fullName) ? data.fullName : 'Proposal Client',
            companyName: nonEmptyString(data.companyName) ? data.companyName : 'Client Company',
            issuedAt: new Date().toISOString(),
        });

        return { ok: true };
    });

    app.post('/demo-api/logout', async (_, reply) => {
        clearSessionCookie(reply);
        return { ok: true };
    });

    app.get('/demo-api/dashboard', async (request, reply) => {
        const session = (request as typeof request & { proposalSession: SessionPayload | null }).proposalSession;
        if (!session) {
            return reply.status(401).send({
                error: 'Authentication required',
                remediation: 'Sign in to view your proposal requests and published proposals.',
            });
        }

        return buildDashboard(session.email);
    });

    app.post('/demo-api/request-proposal', async (request, reply) => {
        const session = (request as typeof request & { proposalSession: SessionPayload | null }).proposalSession;
        if (!session) {
            return reply.status(401).send({
                error: 'Authentication required',
                remediation: 'Sign in before submitting a project brief.',
            });
        }

        const body = request.body as Record<string, unknown>;
        const projectName = nonEmptyString(body.projectName) ? body.projectName.trim() : '';
        const requestedOutcome = nonEmptyString(body.requestedOutcome) ? body.requestedOutcome.trim() : '';
        const currentSituation = nonEmptyString(body.currentSituation) ? body.currentSituation.trim() : '';
        const keyRequirements = nonEmptyString(body.keyRequirements) ? body.keyRequirements.trim() : '';
        const budgetRange = nonEmptyString(body.budgetRange) ? body.budgetRange.trim() : '';
        const targetTimeline = nonEmptyString(body.targetTimeline) ? body.targetTimeline.trim() : '';
        const companyName = nonEmptyString(body.companyName) ? body.companyName.trim() : session.companyName;
        const constraints = nonEmptyString(body.constraints) ? body.constraints.trim() : '';

        if (!projectName || !requestedOutcome || !currentSituation || !keyRequirements || !budgetRange || !targetTimeline) {
            return reply.status(400).send({
                error: 'Missing brief fields',
                remediation: 'Provide project name, requested outcome, current situation, key requirements, budget range, and target timeline.',
            });
        }

        const payload = await fetch(`${WORDCLAW_API_URL}/public/forms/${FORM_SLUG}/submissions?domainId=${DEMO_DOMAIN_ID}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                data: {
                    accountName: session.fullName,
                    accountEmail: session.email,
                    companyName,
                    projectName,
                    requestedOutcome,
                    currentSituation,
                    keyRequirements,
                    constraints,
                    budgetRange,
                    targetTimeline,
                },
            }),
        });

        const json = await payload.json().catch(() => ({}));
        if (!payload.ok) {
            return reply.status(payload.status).send({
                error: json?.error ?? 'WordClaw rejected the proposal request',
                remediation: json?.remediation ?? 'Inspect the form definition and local WordClaw worker status, then retry.',
            });
        }

        return {
            contentItemId: json?.contentItemId ?? json?.data?.submission?.contentItemId ?? json?.data?.contentItemId ?? null,
            draftGenerationJobId: json?.draftGenerationJobId ?? json?.data?.submission?.draftGenerationJobId ?? json?.data?.draftGenerationJobId ?? null,
        };
    });

    await app.listen({ port: DEMO_PORT, host: '0.0.0.0' });
    app.log.info(`Proposal portal demo listening on http://localhost:${DEMO_PORT}`);
}

main().catch((error) => {
    console.error('Failed to start proposal portal demo:', error);
    process.exit(1);
});
