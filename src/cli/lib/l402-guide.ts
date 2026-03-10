type OfferLike = {
    id: number;
    slug: string;
    name: string;
    scopeType: string;
    scopeRef: number | null;
    priceSats: number;
    active: boolean;
};

export type L402GuideStep = {
    id: string;
    title: string;
    status: 'completed' | 'ready' | 'blocked';
    command: string | null;
    purpose: string;
    notes?: string[];
};

export type L402Guide = {
    taskId: 'consume-paid-content';
    itemId: number;
    selectedOfferId: number | null;
    requiredAuth: 'api-key';
    availableOffers: OfferLike[];
    apiKeyConfigured: boolean;
    warnings?: string[];
    steps: L402GuideStep[];
};

export function selectOfferForGuide(
    offers: OfferLike[],
    preferredOfferId?: number,
): OfferLike | null {
    if (offers.length === 0) {
        return null;
    }

    if (preferredOfferId !== undefined) {
        return offers.find((offer) => offer.id === preferredOfferId) ?? null;
    }

    return [...offers].sort((left, right) => left.priceSats - right.priceSats)[0];
}

export function buildL402Guide(options: {
    itemId: number;
    offers: OfferLike[];
    apiKeyConfigured: boolean;
    baseCommand?: string;
    preferredOfferId?: number;
}): L402Guide {
    const baseCommand = options.baseCommand ?? 'node dist/cli/index.js';
    const selectedOffer = selectOfferForGuide(options.offers, options.preferredOfferId);
    const purchaseCommand = selectedOffer
        ? `${baseCommand} l402 purchase --offer ${selectedOffer.id}`
        : null;
    const confirmCommand = selectedOffer
        ? `${baseCommand} l402 confirm --offer ${selectedOffer.id} --macaroon <macaroon> --preimage <preimage> [--payment-hash <paymentHash>]`
        : null;

    return {
        taskId: 'consume-paid-content',
        itemId: options.itemId,
        selectedOfferId: selectedOffer?.id ?? null,
        requiredAuth: 'api-key',
        availableOffers: options.offers,
        apiKeyConfigured: options.apiKeyConfigured,
        warnings: options.apiKeyConfigured
            ? undefined
            : ['No API key is configured, so live offers may be unavailable and purchase steps remain blocked.'],
        steps: [
            {
                id: 'discover-offers',
                title: 'Inspect available offers',
                status: 'completed',
                command: `${baseCommand} l402 offers --item ${options.itemId}`,
                purpose: 'Find the active paid-access offers that apply to this content item.',
            },
            {
                id: 'start-purchase',
                title: 'Start the L402 purchase',
                status: !options.apiKeyConfigured
                    ? 'blocked'
                    : selectedOffer
                        ? 'ready'
                        : 'blocked',
                command: purchaseCommand,
                purpose: 'Request the Lightning challenge for the selected offer.',
                notes: !options.apiKeyConfigured
                    ? ['Configure WORDCLAW_API_KEY or pass --api-key before purchasing; entitlement ownership is API-key scoped.']
                    : selectedOffer
                        ? [
                            `Selected offer ${selectedOffer.id} (${selectedOffer.name}) at ${selectedOffer.priceSats} sats.`,
                            'This request is expected to return HTTP 402 with a macaroon, paymentHash, and invoice challenge.',
                        ]
                        : ['No active offers were returned for this item.'],
            },
            {
                id: 'confirm-purchase',
                title: 'Confirm payment settlement',
                status: !options.apiKeyConfigured
                    ? 'blocked'
                    : selectedOffer
                        ? 'ready'
                        : 'blocked',
                command: confirmCommand,
                purpose: 'After you settle the invoice, confirm the purchase to activate an entitlement.',
                notes: [
                    'Use the macaroon and paymentHash from the purchase response.',
                    'Provide the Lightning preimage once payment is settled.',
                    'If multiple pending entitlements exist for the same offer, include --payment-hash.',
                ],
            },
            {
                id: 'inspect-entitlements',
                title: 'Inspect current entitlements',
                status: options.apiKeyConfigured ? 'ready' : 'blocked',
                command: `${baseCommand} l402 entitlements`,
                purpose: 'List active or pending entitlements for the current API key principal.',
            },
            {
                id: 'read-content',
                title: 'Read the paid content',
                status: options.apiKeyConfigured ? 'ready' : 'blocked',
                command: `${baseCommand} l402 read --item ${options.itemId} --entitlement-id <entitlementId>`,
                purpose: 'Use the activated entitlement to fetch the premium content item.',
                notes: [
                    'Replace <entitlementId> with the activated entitlement from the confirm response or entitlements list.',
                ],
            },
        ],
    };
}
