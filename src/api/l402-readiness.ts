import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { l402OperatorConfigs } from '../db/schema.js';
import { logAudit } from '../services/audit.js';
import { parseSupervisorDomainHeader } from './domain-context.js';

const supportedArchitectures = ['mock', 'lnbits'] as const;

function normalizeArchitecture(raw: unknown): typeof supportedArchitectures[number] {
    return raw === 'lnbits' ? 'lnbits' : 'mock';
}

export const l402ReadinessRoutes: FastifyPluginAsync = async (server: FastifyInstance) => {
    // These routes will be registered under '/api/supervisors/l402-readiness'
    // and protect via supervisor authentication (or custom hooks)

    server.get('/', {
        schema: {
            response: {
                200: Type.Object({
                    id: Type.Optional(Type.Number()),
                    domainId: Type.Number(),
                    architecture: Type.String(),
                    webhookEndpoint: Type.Union([Type.String(), Type.Null()]),
                    secretManagerPath: Type.Union([Type.String(), Type.Null()]),
                    checklistApprovals: Type.Record(Type.String(), Type.Boolean()),
                    diagnostics: Type.Object({
                        hasLnbitsUrl: Type.Boolean(),
                        hasLnbitsKey: Type.Boolean(),
                        webhookConfigured: Type.Boolean()
                    })
                }),
                400: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String()
                }),
                401: Type.Object({
                    error: Type.String()
                })
            }
        }
    }, async (request, reply) => {
        let domainId: number;
        try {
            await request.jwtVerify({ onlyCookie: true });
            const user = (request as any).user;
            if (user.role !== 'supervisor') {
                return reply.status(401).send({ error: 'Unauthorized' });
            }

            const domainContext = parseSupervisorDomainHeader(request.headers);
            if (!domainContext.ok) {
                return reply.status(domainContext.statusCode).send(domainContext.payload);
            }
            domainId = domainContext.domainId;
        } catch (err) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const [config] = await db
            .select()
            .from(l402OperatorConfigs)
            .where(eq(l402OperatorConfigs.domainId, domainId))
            .limit(1);

        const diagnostics = {
            hasLnbitsUrl: !!process.env.LNBITS_BASE_URL,
            hasLnbitsKey: !!process.env.LNBITS_ADMIN_KEY,
            webhookConfigured: config?.webhookEndpoint ? true : false
        };

        if (!config) {
            return {
                domainId,
                architecture: 'mock',
                webhookEndpoint: null,
                secretManagerPath: null,
                checklistApprovals: {},
                diagnostics
            };
        }

        return {
            id: config.id,
            domainId: config.domainId,
            architecture: normalizeArchitecture(config.architecture),
            webhookEndpoint: config.webhookEndpoint,
            secretManagerPath: config.secretManagerPath,
            checklistApprovals: config.checklistApprovals as Record<string, boolean>,
            diagnostics
        };
    });

    server.put('/', {
        schema: {
            body: Type.Object({
                architecture: Type.Optional(Type.Union([
                    Type.Literal(supportedArchitectures[0]),
                    Type.Literal(supportedArchitectures[1])
                ])),
                webhookEndpoint: Type.Optional(Type.String()),
                secretManagerPath: Type.Optional(Type.String()),
                checklistApprovals: Type.Optional(Type.Record(Type.String(), Type.Boolean()))
            }),
            response: {
                200: Type.Object({
                    ok: Type.Literal(true)
                }),
                400: Type.Object({
                    error: Type.String(),
                    code: Type.String(),
                    remediation: Type.String()
                }),
                401: Type.Object({
                    error: Type.String()
                })
            }
        }
    }, async (request, reply) => {
        let domainId: number;
        let userId: number;
        try {
            await request.jwtVerify({ onlyCookie: true });
            const user = (request as any).user;
            if (user.role !== 'supervisor') {
                return reply.status(401).send({ error: 'Unauthorized' });
            }
            userId = user.sub;

            const domainContext = parseSupervisorDomainHeader(request.headers);
            if (!domainContext.ok) {
                return reply.status(domainContext.statusCode).send(domainContext.payload);
            }
            domainId = domainContext.domainId;
        } catch (err) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const body = request.body as any;

        const [existing] = await db
            .select()
            .from(l402OperatorConfigs)
            .where(eq(l402OperatorConfigs.domainId, domainId))
            .limit(1);

        if (existing) {
            await db.update(l402OperatorConfigs)
                .set({
                    architecture: normalizeArchitecture(body.architecture ?? existing.architecture),
                    webhookEndpoint: body.webhookEndpoint !== undefined ? body.webhookEndpoint : existing.webhookEndpoint,
                    secretManagerPath: body.secretManagerPath !== undefined ? body.secretManagerPath : existing.secretManagerPath,
                    checklistApprovals: body.checklistApprovals !== undefined ? body.checklistApprovals : existing.checklistApprovals,
                    updatedAt: new Date()
                })
                .where(eq(l402OperatorConfigs.id, existing.id));
        } else {
            await db.insert(l402OperatorConfigs).values({
                domainId,
                architecture: normalizeArchitecture(body.architecture),
                webhookEndpoint: body.webhookEndpoint,
                secretManagerPath: body.secretManagerPath,
                checklistApprovals: body.checklistApprovals ?? {}
            });
        }

        await logAudit(
            domainId,
            'update',
            'l402_operator_config',
            domainId,
            { action: 'updated_l402_readiness_config' },
            userId,
            request.id
        );

        return { ok: true };
    });
};
