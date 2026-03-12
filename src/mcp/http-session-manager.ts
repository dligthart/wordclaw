import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import type { ActorPrincipal } from '../services/actor-identity.js';
import { auditEventBus, type AuditEventPayload } from '../services/event-bus.js';

import { createServer as createMcpServer } from './server.js';
import {
    buildReactiveEventNotification,
    canSubscribeToReactiveTopic,
    deriveReactiveTopics,
    isReactiveTopicSupported,
    type ReactiveEventBindings,
    type SubscribeEventsResult,
} from './reactive-events.js';

type NodeMcpRequest = IncomingMessage & {
    auth?: {
        token: string;
        clientId: string;
        scopes: string[];
        extra?: Record<string, unknown>;
    };
};

export class McpHttpSession {
    private readonly subscribedTopics = new Set<string>();
    private readonly transport: StreamableHTTPServerTransport;
    private readonly mcpServer: ReturnType<typeof createMcpServer>;
    private readonly ready: Promise<void>;
    private sessionIdValue: string | null = null;

    constructor(
        readonly principal: ActorPrincipal,
        private readonly manager: McpHttpSessionManager,
    ) {
        const reactiveBindings: ReactiveEventBindings = {
            subscribe: (topics, replaceExisting) => this.subscribe(topics, replaceExisting),
        };

        this.mcpServer = createMcpServer({ reactiveEvents: reactiveBindings });
        this.transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: async (sessionId) => {
                this.sessionIdValue = sessionId;
                this.manager.register(sessionId, this);
            },
            onsessionclosed: async (sessionId) => {
                this.manager.unregister(sessionId, this);
            },
        });
        this.ready = this.mcpServer.connect(this.transport);
    }

    get sessionId() {
        return this.sessionIdValue;
    }

    matchesPrincipal(principal: ActorPrincipal): boolean {
        return this.principal.domainId === principal.domainId
            && this.principal.actorId === principal.actorId
            && this.principal.actorType === principal.actorType
            && this.principal.actorSource === principal.actorSource;
    }

    async handleRequest(request: NodeMcpRequest, response: ServerResponse, parsedBody?: unknown) {
        await this.ready;
        await this.transport.handleRequest(request, response, parsedBody);
    }

    async close() {
        await this.mcpServer.close();
    }

    async publishAuditEvent(event: AuditEventPayload) {
        if (this.subscribedTopics.size === 0 || event.domainId !== this.principal.domainId) {
            return;
        }

        const derivedTopics = deriveReactiveTopics(event);
        const matchedTopics = [...this.subscribedTopics].filter((topic) => (
            topic === '*' || derivedTopics.includes(topic)
        ));

        if (matchedTopics.length === 0) {
            return;
        }

        await this.mcpServer.server.notification(
            buildReactiveEventNotification(event, matchedTopics),
        );
    }

    private subscribe(topics: string[], replaceExisting = false): SubscribeEventsResult {
        const newlyAddedTopics: string[] = [];
        const blockedTopics: Array<{ topic: string; reason: string }> = [];
        const unsupportedTopics: string[] = [];
        const normalizedTopics = Array.from(new Set(
            topics.map((topic) => topic.trim()).filter(Boolean),
        ));

        if (replaceExisting) {
            this.subscribedTopics.clear();
        }

        for (const topic of normalizedTopics) {
            if (!isReactiveTopicSupported(topic)) {
                unsupportedTopics.push(topic);
                continue;
            }

            if (!canSubscribeToReactiveTopic(this.principal, topic)) {
                blockedTopics.push({
                    topic,
                    reason: 'Current actor is missing the scope required for this event topic.',
                });
                continue;
            }

            if (!this.subscribedTopics.has(topic)) {
                this.subscribedTopics.add(topic);
                newlyAddedTopics.push(topic);
            }
        }

        return {
            transport: 'streamable-http',
            sessionId: this.sessionIdValue,
            subscribedTopics: [...this.subscribedTopics].sort(),
            newlyAddedTopics,
            blockedTopics,
            unsupportedTopics,
        };
    }
}

export class McpHttpSessionManager {
    private readonly sessions = new Map<string, McpHttpSession>();

    private readonly onAuditEvent = (event: AuditEventPayload) => {
        for (const session of this.sessions.values()) {
            void session.publishAuditEvent(event).catch((error) => {
                console.error('Failed to publish MCP reactive event', error);
            });
        }
    };

    constructor() {
        auditEventBus.on('audit', this.onAuditEvent);
    }

    async createSession(principal: ActorPrincipal) {
        const session = new McpHttpSession(principal, this);
        return session;
    }

    get(sessionId: string) {
        return this.sessions.get(sessionId) ?? null;
    }

    register(sessionId: string, session: McpHttpSession) {
        this.sessions.set(sessionId, session);
    }

    unregister(sessionId: string, session: McpHttpSession) {
        if (this.sessions.get(sessionId) === session) {
            this.sessions.delete(sessionId);
        }
    }

    async close() {
        auditEventBus.off('audit', this.onAuditEvent);
        const sessions = [...this.sessions.values()];
        this.sessions.clear();
        await Promise.allSettled(sessions.map((session) => session.close()));
    }
}
