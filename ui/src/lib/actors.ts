export type ActorIdentityLike = {
    actorId?: string | null;
    actorType?: string | null;
    actorSource?: string | null;
    legacyUserId?: number | string | null;
};

function titleCase(value: string): string {
    return value
        .split(/[_:-]/g)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

export function inferActorType(
    actorId?: string | null,
    actorType?: string | null,
): string | null {
    if (typeof actorType === "string" && actorType.trim().length > 0) {
        return actorType.trim();
    }

    if (typeof actorId !== "string") {
        return null;
    }

    if (actorId.startsWith("api_key:")) return "api_key";
    if (actorId.startsWith("env_key:")) return "env_key";
    if (actorId.startsWith("supervisor:")) return "supervisor";
    if (actorId === "mcp-local") return "mcp";
    if (actorId === "anonymous") return "anonymous";
    if (actorId === "system") return "system";
    if (/^\d+$/.test(actorId)) return "api_key";
    return null;
}

export function inferActorSource(
    actorId?: string | null,
    actorType?: string | null,
    actorSource?: string | null,
): string | null {
    if (typeof actorSource === "string" && actorSource.trim().length > 0) {
        return actorSource.trim();
    }

    const resolvedType = inferActorType(actorId, actorType);
    if (resolvedType === "api_key") return "db";
    if (resolvedType === "env_key") return "env";
    if (resolvedType === "supervisor") return "cookie";
    if (resolvedType === "mcp") return "local";
    if (resolvedType === "anonymous") return "anonymous";
    if (resolvedType === "system") return "system";
    return null;
}

export function formatActorTypeLabel(actorType?: string | null): string | null {
    if (!actorType) return null;
    if (actorType === "api_key") return "API key";
    if (actorType === "env_key") return "Env key";
    if (actorType === "mcp") return "MCP";
    return titleCase(actorType);
}

export function formatActorSourceLabel(
    actorSource?: string | null,
): string | null {
    if (!actorSource) return null;
    if (actorSource === "db") return "DB";
    if (actorSource === "env") return "Env";
    if (actorSource === "cookie") return "Cookie";
    if (actorSource === "local") return "Local";
    if (actorSource === "anonymous") return "Anonymous";
    if (actorSource === "system") return "System";
    if (actorSource === "test") return "Test";
    return titleCase(actorSource);
}

export function actorVariant(
    actorType?: string | null,
):
    | "muted"
    | "outline"
    | "success"
    | "warning"
    | "danger"
    | "paid"
    | "info" {
    switch (actorType) {
        case "supervisor":
            return "info";
        case "api_key":
            return "muted";
        case "env_key":
            return "outline";
        case "mcp":
            return "info";
        case "anonymous":
            return "warning";
        case "system":
            return "danger";
        default:
            return "muted";
    }
}

export function resolveActorIdentity(
    actor: ActorIdentityLike,
    fallback = "System / unauthenticated",
) {
    const legacyUserId =
        actor.legacyUserId !== null && actor.legacyUserId !== undefined
            ? String(actor.legacyUserId)
            : null;
    const actorId =
        typeof actor.actorId === "string" && actor.actorId.trim().length > 0
            ? actor.actorId.trim()
            : legacyUserId
              ? `api_key:${legacyUserId}`
              : null;
    const actorType = inferActorType(actorId, actor.actorType);
    const actorSource = inferActorSource(actorId, actorType, actor.actorSource);

    return {
        actorId,
        actorType,
        actorSource,
        actorTypeLabel: formatActorTypeLabel(actorType),
        actorSourceLabel: formatActorSourceLabel(actorSource),
        fallbackLabel: fallback,
        isFallback: !actorId,
        isLegacyFallback:
            !actor.actorId && legacyUserId !== null && actorId !== null,
    };
}
