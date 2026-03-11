import {
  startTransition,
  useDeferredValue,
  useEffect,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookOpenText,
  CheckCircle2,
  ChevronRight,
  FileCode2,
  KeyRound,
  LockKeyhole,
  Search,
  ShieldCheck,
  Sparkles,
  Wallet,
  Zap,
} from 'lucide-react';

const API_URL = (import.meta.env.VITE_WORDCLAW_URL || '').replace(/\/$/, '');
const API_KEY = import.meta.env.VITE_WORDCLAW_API_KEY || '';
const MOCK_PREIMAGE = 'mock_preimage_12345';

type CapabilityCategory =
  | 'Data Analysis'
  | 'Code Generation'
  | 'Research'
  | 'Copywriting'
  | 'Other';

type CapabilityData = {
  title: string;
  slug: string;
  description: string;
  authorName: string;
  authorAvatar: string;
  category: CapabilityCategory;
  promptTemplate: string;
  basePrice: number;
};

type Capability = {
  id: number;
  contentTypeId: number;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  data: CapabilityData;
};

type Offer = {
  id: number;
  domainId: number;
  slug: string;
  name: string;
  scopeType: string;
  scopeRef: number | null;
  priceSats: number;
  active: boolean;
};

type Entitlement = {
  id: number;
  offerId: number;
  paymentHash: string;
  status: string;
  remainingReads: number | null;
  activatedAt: string | null;
  expiresAt: string | null;
};

type InvoiceChallenge = {
  invoice: string;
  macaroon: string;
  amountSatoshis: number;
  paymentHash: string;
  offerId: number;
};

type AccessState = 'idle' | 'loading' | 'challenge' | 'confirming' | 'ready';

type ApiEnvelope<T> = {
  data: T;
  meta?: Record<string, unknown>;
};

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;
  const candidate = payload as {
    error?: string;
    remediation?: string;
    message?: string;
  };
  if (candidate.error && candidate.remediation) {
    return `${candidate.error}. ${candidate.remediation}`;
  }
  return candidate.error || candidate.message || fallback;
}

function parseCapability(item: {
  id: number;
  contentTypeId: number;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  data: string | CapabilityData;
}): Capability {
  return {
    ...item,
    data:
      typeof item.data === 'string'
        ? (JSON.parse(item.data) as CapabilityData)
        : item.data,
  };
}

function formatRelativeDate(dateString: string) {
  const target = new Date(dateString).getTime();
  const minutes = Math.max(1, Math.round((Date.now() - target) / 60000));

  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function extractTemplateVariables(template: string) {
  const matches = template.match(/{{([^}]+)}}/g) || [];
  return [...new Set(matches.map((match) => match.replace(/[{}]/g, '').trim()))];
}

export default function App() {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'library' | 'flow'>('library');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  const [selectedCapabilityId, setSelectedCapabilityId] = useState<number | null>(
    null,
  );
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null);
  const [selectedEntitlement, setSelectedEntitlement] =
    useState<Entitlement | null>(null);
  const [invoiceChallenge, setInvoiceChallenge] =
    useState<InvoiceChallenge | null>(null);
  const [unlockedCapability, setUnlockedCapability] =
    useState<Capability | null>(null);
  const [accessState, setAccessState] = useState<AccessState>('idle');

  const [sandboxMode, setSandboxMode] = useState(false);
  const [sandboxVariables, setSandboxVariables] = useState<Record<string, string>>(
    {},
  );
  const [sandboxResult, setSandboxResult] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);

  const filteredCapabilities = (() => {
    const normalized = deferredQuery.trim().toLowerCase();
    if (!normalized) return capabilities;

    return capabilities.filter((capability) => {
      const haystack = [
        capability.data.title,
        capability.data.slug,
        capability.data.description,
        capability.data.authorName,
        capability.data.category,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalized);
    });
  })();

  const selectedCapability =
    filteredCapabilities.find((capability) => capability.id === selectedCapabilityId) ??
    filteredCapabilities[0] ??
    null;

  useEffect(() => {
    let cancelled = false;

    async function loadLibrary() {
      if (!API_URL || !API_KEY) {
        setError(
          'Set VITE_WORDCLAW_URL and VITE_WORDCLAW_API_KEY before starting the demo.',
        );
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const targetResponse = await fetch(`${API_URL}/workspace-target?intent=paid`, {
          headers: { 'x-api-key': API_KEY },
        });

        const targetPayload = (await targetResponse.json()) as ApiEnvelope<{
          bestTarget?: {
            contentType?: { id: number; slug: string };
          };
        }>;

        if (!targetResponse.ok) {
          throw new Error(
            getErrorMessage(
              targetPayload,
              'Failed to resolve the workspace target for paid capabilities.',
            ),
          );
        }

        const capabilityType = targetPayload.data?.bestTarget?.contentType;

        if (!capabilityType) {
          throw new Error(
            'The workspace could not automatically resolve a schema target for paid capabilities. Run npx tsx scripts/setup-skills-marketplace.ts first.',
          );
        }

        const contentItemsResponse = await fetch(
          `${API_URL}/content-items?contentTypeId=${capabilityType.id}`,
          {
            headers: { 'x-api-key': API_KEY },
          },
        );
        const contentItemsPayload = (await contentItemsResponse.json()) as ApiEnvelope<
          Array<{
            id: number;
            contentTypeId: number;
            status: string;
            version: number;
            createdAt: string;
            updatedAt: string;
            data: string | CapabilityData;
          }>
        >;

        if (!contentItemsResponse.ok) {
          throw new Error(
            getErrorMessage(
              contentItemsPayload,
              'Failed to load capability content items.',
            ),
          );
        }

        const nextCapabilities = contentItemsPayload.data
          .map(parseCapability)
          .filter((capability) => capability.status === 'published')
          .sort(
            (left, right) =>
              new Date(right.updatedAt).getTime() -
              new Date(left.updatedAt).getTime(),
          );

        if (!cancelled) {
          startTransition(() => {
            setCapabilities(nextCapabilities);
            setSelectedCapabilityId((current) => {
              if (
                current &&
                nextCapabilities.some((capability) => capability.id === current)
              ) {
                return current;
              }
              return nextCapabilities[0]?.id ?? null;
            });
          });
        }
      } catch (loadError) {
        if (!cancelled) {
          setError((loadError as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadLibrary();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (filteredCapabilities.length === 0) return;
    if (
      selectedCapabilityId &&
      filteredCapabilities.some((capability) => capability.id === selectedCapabilityId)
    ) {
      return;
    }

    setSelectedCapabilityId(filteredCapabilities[0].id);
  }, [filteredCapabilities, selectedCapabilityId]);

  useEffect(() => {
    let cancelled = false;

    async function loadAccessContext(capabilityId: number) {
      setAccessState('loading');
      setSelectedOffer(null);
      setSelectedEntitlement(null);
      setInvoiceChallenge(null);
      setUnlockedCapability(null);
      setSandboxMode(false);
      setSandboxVariables({});
      setSandboxResult(null);

      try {
        const [offersResponse, entitlementsResponse] = await Promise.all([
          fetch(`${API_URL}/content-items/${capabilityId}/offers`, {
            headers: { 'x-api-key': API_KEY },
          }),
          fetch(`${API_URL}/entitlements/me`, {
            headers: { 'x-api-key': API_KEY },
          }),
        ]);

        const offersPayload = (await offersResponse.json()) as ApiEnvelope<Offer[]>;
        const entitlementsPayload = (await entitlementsResponse.json()) as ApiEnvelope<
          Entitlement[]
        >;

        if (!offersResponse.ok) {
          throw new Error(
            getErrorMessage(
              offersPayload,
              'Failed to inspect purchase offers for this capability.',
            ),
          );
        }

        if (!entitlementsResponse.ok) {
          throw new Error(
            getErrorMessage(
              entitlementsPayload,
              'Failed to inspect entitlement ownership for this API key.',
            ),
          );
        }

        const primaryOffer = offersPayload.data[0] ?? null;
        const activeEntitlement = primaryOffer
          ? entitlementsPayload.data.find(
            (entitlement) =>
              entitlement.offerId === primaryOffer.id &&
              entitlement.status === 'active',
          ) ?? null
          : null;

        if (!cancelled) {
          setSelectedOffer(primaryOffer);
          setSelectedEntitlement(activeEntitlement);
          setAccessState(activeEntitlement || !primaryOffer ? 'ready' : 'idle');
        }
      } catch (loadError) {
        if (!cancelled) {
          setError((loadError as Error).message);
          setAccessState('idle');
        }
      }
    }

    if (selectedCapabilityId) {
      void loadAccessContext(selectedCapabilityId);
    }

    return () => {
      cancelled = true;
    };
  }, [selectedCapabilityId]);

  async function openCapability(entitlement: Entitlement | null) {
    if (!selectedCapability) return;

    const headers: Record<string, string> = { 'x-api-key': API_KEY };
    if (entitlement) {
      headers['x-entitlement-id'] = String(entitlement.id);
    }

    setAccessState('loading');
    setError(null);

    try {
      const response = await fetch(`${API_URL}/content-items/${selectedCapability.id}`, {
        headers,
      });
      const payload = (await response.json()) as ApiEnvelope<{
        id: number;
        contentTypeId: number;
        status: string;
        version: number;
        createdAt: string;
        updatedAt: string;
        data: string | CapabilityData;
      }>;

      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, 'Failed to unlock the capability payload.'),
        );
      }

      setUnlockedCapability(parseCapability(payload.data));
      setAccessState('ready');
    } catch (openError) {
      setError((openError as Error).message);
      setAccessState('ready');
    }
  }

  async function startPurchase() {
    if (!selectedOffer) return;

    setAccessState('loading');
    setError(null);

    try {
      const response = await fetch(`${API_URL}/offers/${selectedOffer.id}/purchase`, {
        method: 'POST',
        headers: { 'x-api-key': API_KEY },
      });
      const payload = (await response.json()) as {
        error?: string;
        remediation?: string;
        code?: string;
        context?: {
          invoice?: string;
          macaroon?: string;
          amountSatoshis?: number;
        };
        paymentHash?: string;
      };

      if (response.status !== 402) {
        throw new Error(
          getErrorMessage(payload, 'Expected an L402 challenge but got another response.'),
        );
      }

      if (
        !payload.context?.invoice ||
        !payload.context?.macaroon ||
        typeof payload.context.amountSatoshis !== 'number' ||
        !payload.paymentHash
      ) {
        throw new Error('The purchase challenge did not include the expected L402 fields.');
      }

      setInvoiceChallenge({
        invoice: payload.context.invoice,
        macaroon: payload.context.macaroon,
        amountSatoshis: payload.context.amountSatoshis,
        paymentHash: payload.paymentHash,
        offerId: selectedOffer.id,
      });
      setAccessState('challenge');
    } catch (purchaseError) {
      setError((purchaseError as Error).message);
      setAccessState('idle');
    }
  }

  async function confirmPurchase() {
    if (!invoiceChallenge || !selectedCapability) return;

    setAccessState('confirming');
    setError(null);

    try {
      const response = await fetch(
        `${API_URL}/offers/${invoiceChallenge.offerId}/purchase/confirm`,
        {
          method: 'POST',
          headers: {
            'x-api-key': API_KEY,
            'x-payment-hash': invoiceChallenge.paymentHash,
            Authorization: `L402 ${invoiceChallenge.macaroon}:${MOCK_PREIMAGE}`,
          },
        },
      );
      const payload = (await response.json()) as ApiEnvelope<Entitlement>;

      if (!response.ok) {
        throw new Error(
          getErrorMessage(payload, 'Failed to confirm Lightning settlement.'),
        );
      }

      setSelectedEntitlement(payload.data);
      setInvoiceChallenge(null);
      await openCapability(payload.data);
    } catch (confirmError) {
      setError((confirmError as Error).message);
      setAccessState('challenge');
    }
  }

  function simulateExecution() {
    if (!unlockedCapability) return;

    setSimulating(true);
    setSandboxResult(null);

    window.setTimeout(() => {
      let renderedPrompt = unlockedCapability.data.promptTemplate;

      for (const [key, value] of Object.entries(sandboxVariables)) {
        renderedPrompt = renderedPrompt.replace(
          new RegExp(`{{${key}}}`, 'g'),
          value || `[${key}]`,
        );
      }

      setSandboxResult(
        [
          '[SIMULATED EXECUTION]',
          '',
          `Capability: ${unlockedCapability.data.title}`,
          `Rendered prompt preview:`,
          renderedPrompt.slice(0, 320),
          '',
          'Result:',
          'WordClaw delivered the paid capability payload after entitlement activation. In a real agent runtime, the caller would now hand this prompt or JSON payload to its local execution loop.',
        ].join('\n'),
      );
      setSimulating(false);
    }, 900);
  }

  function downloadPayload() {
    if (!unlockedCapability) return;

    const blob = new Blob([JSON.stringify(unlockedCapability.data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${unlockedCapability.data.slug}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const templateVariables = unlockedCapability
    ? extractTemplateVariables(unlockedCapability.data.promptTemplate)
    : [];

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-stone-950/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-5">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500 text-stone-950">
              <BookOpenText className="h-6 w-6" />
            </div>
            <div>
              <div className="text-sm font-semibold uppercase tracking-[0.24em] text-stone-500">
                WordClaw Demo
              </div>
              <h1 className="text-xl font-semibold tracking-tight">
                Paid Capability Library
              </h1>
            </div>
          </div>

          <nav className="flex items-center gap-6 text-sm text-stone-400">
            <button
              type="button"
              onClick={() => setActiveView('library')}
              className={`border-b pb-1 transition ${activeView === 'library'
                ? 'border-stone-100 text-stone-100'
                : 'border-transparent hover:text-stone-100'
                }`}
            >
              Library
            </button>
            <button
              type="button"
              onClick={() => setActiveView('flow')}
              className={`border-b pb-1 transition ${activeView === 'flow'
                ? 'border-stone-100 text-stone-100'
                : 'border-transparent hover:text-stone-100'
                }`}
            >
              Current Flow
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10">
        <section className="mb-10 grid gap-6 lg:grid-cols-[1.7fr_0.95fr]">
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-8">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              Refactored for current core functionality
            </div>
            <h2 className="max-w-3xl text-4xl font-semibold tracking-tight text-stone-50 md:text-5xl">
              Browse structured capabilities, unlock them with L402, and run them locally.
            </h2>
            <p className="mt-4 max-w-3xl text-base leading-7 text-stone-400">
              This demo now follows the supported WordClaw path: published content
              items, attached offers, entitlement activation, and paid reads. It
              deliberately removes the old AP2 and marketplace-settlement story.
            </p>
          </div>

          <div className="grid gap-4 rounded-[28px] border border-white/10 bg-stone-900/80 p-6">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Demo Uses
              </div>
              <div className="mt-3 flex items-center gap-3 text-sm text-stone-200">
                <Search className="h-4 w-4 text-amber-300" />
                Smart workspace targeting for paid consumption
              </div>
              <div className="mt-2 flex items-center gap-3 text-sm text-stone-200">
                <FileCode2 className="h-4 w-4 text-amber-300" />
                Published content items as capability payloads
              </div>
              <div className="mt-2 flex items-center gap-3 text-sm text-stone-200">
                <Wallet className="h-4 w-4 text-amber-300" />
                Offers, purchases, and entitlements
              </div>
              <div className="mt-2 flex items-center gap-3 text-sm text-stone-200">
                <ShieldCheck className="h-4 w-4 text-amber-300" />
                Actor-aware provenance guidance
              </div>
              <div className="mt-2 flex items-center gap-3 text-sm text-stone-200">
                <KeyRound className="h-4 w-4 text-amber-300" />
                API-key scoped ownership
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-stone-400">
              Seed the demo with:
              <div className="mt-2 rounded-xl bg-black/30 px-3 py-2 font-mono text-xs text-stone-200">
                npx tsx scripts/setup-skills-marketplace.ts
              </div>
            </div>
          </div>
        </section>

        {error && (
          <div className="mb-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center rounded-[28px] border border-white/10 bg-white/5">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-amber-400" />
          </div>
        ) : activeView === 'flow' ? (
          <motion.section
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid gap-5 rounded-[32px] border border-white/10 bg-white/[0.04] p-6 md:p-8"
          >
            {[
              {
                title: '1. Resolve workspace target',
                body:
                  'Instead of guessing the API schema, the client asks the runtime for `intent=paid` guidance to auto-resolve the best schema target from the workspace context.',
              },
              {
                title: '2. Model capabilities as content',
                body:
                  'Capability payloads are plain WordClaw content items. The demo setup script creates the agent-skill content type and publishes several paid capability entries.',
              },
              {
                title: '2. Attach offers and policies',
                body:
                  'Each capability gets a normal offer plus a license policy. The runtime decides which offer applies when the agent tries to read the content.',
              },
              {
                title: '3. Trigger an L402 purchase challenge',
                body:
                  'The client starts POST /api/offers/:id/purchase and receives a 402 response with invoice, macaroon, and payment hash. That is the supported purchase handshake today.',
              },
              {
                title: '4. Activate entitlement and read',
                body:
                  'After payment confirmation, WordClaw activates the entitlement. The caller can then read the item with its owned entitlement instead of relying on marketplace or payout semantics.',
              },
            ].map((step, index) => (
              <div
                key={step.title}
                className="grid gap-4 rounded-3xl border border-white/10 bg-stone-900/70 p-6 md:grid-cols-[72px_1fr]"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 text-stone-950">
                  <span className="text-lg font-semibold">{index + 1}</span>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-stone-50">{step.title}</h3>
                  <p className="mt-2 max-w-3xl text-sm leading-7 text-stone-400">
                    {step.body}
                  </p>
                </div>
              </div>
            ))}
          </motion.section>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
            <section className="rounded-[32px] border border-white/10 bg-white/[0.04] p-6">
              <div className="mb-5 flex flex-col gap-4 border-b border-white/10 pb-5 md:flex-row md:items-end md:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                    Library
                  </div>
                  <h3 className="mt-2 text-2xl font-semibold tracking-tight text-stone-50">
                    Paid capabilities
                  </h3>
                  <p className="mt-1 text-sm text-stone-400">
                    Published capability items available in the seeded demo domain.
                  </p>
                </div>

                <label className="flex min-w-[240px] items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-stone-300">
                  <Search className="h-4 w-4 text-stone-500" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Find by title, slug, author, or category"
                    className="w-full bg-transparent outline-none placeholder:text-stone-500"
                  />
                </label>
              </div>

              <div className="grid gap-4">
                {filteredCapabilities.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-stone-500">
                    No capabilities matched this search.
                  </div>
                ) : (
                  filteredCapabilities.map((capability) => {
                    const isSelected = capability.id === selectedCapability?.id;
                    return (
                      <button
                        key={capability.id}
                        type="button"
                        onClick={() => setSelectedCapabilityId(capability.id)}
                        className={`rounded-3xl border px-5 py-5 text-left transition ${isSelected
                          ? 'border-amber-400/50 bg-amber-500/10'
                          : 'border-white/8 bg-stone-900/70 hover:border-white/20'
                          }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                              {capability.data.category}
                            </div>
                            <h4 className="mt-2 text-lg font-semibold text-stone-100">
                              {capability.data.title}
                            </h4>
                          </div>
                          <div className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300">
                            {capability.data.basePrice} sats
                          </div>
                        </div>

                        <p className="mt-3 line-clamp-2 text-sm leading-6 text-stone-400">
                          {capability.data.description}
                        </p>

                        <div className="mt-5 flex items-center justify-between text-xs text-stone-500">
                          <span>{capability.data.authorName}</span>
                          <span>Updated {formatRelativeDate(capability.updatedAt)}</span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            <section className="rounded-[32px] border border-white/10 bg-stone-900/70">
              <AnimatePresence mode="wait">
                {selectedCapability ? (
                  <motion.div
                    key={selectedCapability.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    className="flex h-full flex-col"
                  >
                    <div className="border-b border-white/10 px-6 py-6">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                            Capability Detail
                          </div>
                          <h3 className="mt-2 text-2xl font-semibold tracking-tight text-stone-50">
                            {selectedCapability.data.title}
                          </h3>
                        </div>
                        <div className="rounded-full border border-white/10 px-3 py-1 text-xs text-stone-400">
                          v{selectedCapability.version}
                        </div>
                      </div>

                      <p className="mt-4 text-sm leading-7 text-stone-400">
                        {selectedCapability.data.description}
                      </p>

                      <div className="mt-5 flex flex-wrap gap-2 text-xs text-stone-500">
                        <span className="rounded-full border border-white/10 px-3 py-1">
                          slug {selectedCapability.data.slug}
                        </span>
                        <span className="rounded-full border border-white/10 px-3 py-1">
                          status {selectedCapability.status}
                        </span>
                        <span className="rounded-full border border-white/10 px-3 py-1">
                          author {selectedCapability.data.authorName}
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-5 px-6 py-6">
                      <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                        <div className="flex items-center gap-2 text-sm font-semibold text-stone-200">
                          <LockKeyhole className="h-4 w-4 text-amber-300" />
                          Access contract
                        </div>
                        <p className="mt-2 text-sm leading-6 text-stone-400">
                          {selectedOffer
                            ? `${selectedOffer.name} is attached to this item. Purchase activates an entitlement for this API key.`
                            : 'No paid offer is attached, so this capability can be opened directly.'}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-3 text-xs">
                          {selectedOffer ? (
                            <>
                              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-amber-300">
                                {selectedOffer.priceSats} sats
                              </span>
                              <span className="rounded-full border border-white/10 px-3 py-1 text-stone-400">
                                scope {selectedOffer.scopeType}
                              </span>
                            </>
                          ) : (
                            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-emerald-300">
                              free read
                            </span>
                          )}
                          {selectedEntitlement && (
                            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-emerald-300">
                              entitlement #{selectedEntitlement.id} active
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                        <div className="flex items-center gap-2 text-sm font-semibold text-stone-200">
                          <Wallet className="h-4 w-4 text-amber-300" />
                          Purchase flow
                        </div>

                        {accessState === 'loading' && (
                          <div className="mt-4 flex items-center gap-3 text-sm text-stone-400">
                            <div className="h-4 w-4 animate-spin rounded-full border border-white/10 border-t-amber-400" />
                            Inspecting offer and entitlement state...
                          </div>
                        )}

                        {accessState !== 'loading' && !selectedOffer && (
                          <div className="mt-4 space-y-4">
                            <p className="text-sm leading-6 text-stone-400">
                              This item is readable without a purchase. It still lives in
                              the same structured content model as the paid entries.
                            </p>
                            <button
                              type="button"
                              onClick={() => void openCapability(null)}
                              className="inline-flex items-center gap-2 rounded-2xl bg-stone-100 px-4 py-3 text-sm font-medium text-stone-950 transition hover:bg-white"
                            >
                              Open payload
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </div>
                        )}

                        {accessState !== 'loading' &&
                          selectedOffer &&
                          !invoiceChallenge &&
                          !selectedEntitlement && (
                            <div className="mt-4 space-y-4">
                              <p className="text-sm leading-6 text-stone-400">
                                Start the supported offer purchase flow to receive an L402
                                challenge with invoice, macaroon, and payment hash.
                              </p>
                              <button
                                type="button"
                                onClick={() => void startPurchase()}
                                className="inline-flex items-center gap-2 rounded-2xl bg-amber-500 px-4 py-3 text-sm font-medium text-stone-950 transition hover:bg-amber-400"
                              >
                                Start purchase
                                <Zap className="h-4 w-4" />
                              </button>
                            </div>
                          )}

                        {invoiceChallenge && (
                          <div className="mt-4 space-y-4">
                            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
                                L402 challenge
                              </div>
                              <div className="mt-3 text-sm text-stone-200">
                                {invoiceChallenge.amountSatoshis} sats
                              </div>
                              <div className="mt-3 rounded-xl bg-black/40 p-3 font-mono text-[11px] leading-5 text-stone-400">
                                {invoiceChallenge.invoice}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => void confirmPurchase()}
                              disabled={accessState === 'confirming'}
                              className="inline-flex items-center gap-2 rounded-2xl bg-stone-100 px-4 py-3 text-sm font-medium text-stone-950 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-stone-300"
                            >
                              {accessState === 'confirming'
                                ? 'Confirming payment...'
                                : 'Simulate Lightning payment'}
                              <Wallet className="h-4 w-4" />
                            </button>
                          </div>
                        )}

                        {selectedEntitlement && (
                          <div className="mt-4 space-y-4">
                            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm leading-6 text-emerald-100">
                              Entitlement #{selectedEntitlement.id} is active for this API key.
                              Read access is now owned by the caller.
                            </div>
                            {!unlockedCapability && (
                              <button
                                type="button"
                                onClick={() => void openCapability(selectedEntitlement)}
                                className="inline-flex items-center gap-2 rounded-2xl bg-stone-100 px-4 py-3 text-sm font-medium text-stone-950 transition hover:bg-white"
                              >
                                Open paid payload
                                <ChevronRight className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {unlockedCapability && (
                        <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.08] p-5">
                          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-100">
                            <CheckCircle2 className="h-4 w-4" />
                            Unlocked payload
                          </div>
                          <p className="mt-2 text-sm leading-6 text-emerald-50/80">
                            The full prompt template is now available to the caller.
                            Download it or render it inside the local sandbox.
                          </p>

                          <div className="mt-4 rounded-2xl bg-black/35 p-4 font-mono text-xs leading-6 text-emerald-100">
                            {unlockedCapability.data.promptTemplate.split('\n').slice(0, 10).map((line, index) => (
                              <div key={`${line}-${index}`}>{line}</div>
                            ))}
                          </div>

                          <div className="mt-4 flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => setSandboxMode((current) => !current)}
                              className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-medium text-stone-100 transition hover:border-white/20 hover:bg-white/5"
                            >
                              {sandboxMode ? 'Hide sandbox' : 'Run in sandbox'}
                            </button>
                            <button
                              type="button"
                              onClick={downloadPayload}
                              className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-medium text-stone-100 transition hover:border-white/20 hover:bg-white/5"
                            >
                              Download JSON
                            </button>
                          </div>
                        </div>
                      )}

                      {sandboxMode && unlockedCapability && (
                        <div className="rounded-3xl border border-white/10 bg-black/20 p-5">
                          <div className="flex items-center gap-2 text-sm font-semibold text-stone-200">
                            <Sparkles className="h-4 w-4 text-amber-300" />
                            Local execution sandbox
                          </div>

                          <div className="mt-4 grid gap-4">
                            {templateVariables.length === 0 ? (
                              <div className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-stone-400">
                                This capability template has no placeholder variables.
                              </div>
                            ) : (
                              templateVariables.map((variable) => (
                                <label key={variable} className="grid gap-2 text-sm">
                                  <span className="font-medium text-stone-300">
                                    {variable}
                                  </span>
                                  <input
                                    value={sandboxVariables[variable] || ''}
                                    onChange={(event) =>
                                      setSandboxVariables((current) => ({
                                        ...current,
                                        [variable]: event.target.value,
                                      }))
                                    }
                                    placeholder={`Enter ${variable}`}
                                    className="rounded-2xl border border-white/10 bg-stone-950 px-4 py-3 text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-amber-400/60"
                                  />
                                </label>
                              ))
                            )}
                          </div>

                          {sandboxResult && (
                            <div className="mt-4 rounded-2xl bg-stone-950 p-4 font-mono text-xs leading-6 text-emerald-100">
                              {sandboxResult}
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={simulateExecution}
                            disabled={simulating}
                            className="mt-4 rounded-2xl bg-amber-500 px-4 py-3 text-sm font-medium text-stone-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-amber-300"
                          >
                            {simulating ? 'Simulating...' : 'Simulate execution'}
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex min-h-[560px] items-center justify-center px-8 py-10 text-center"
                  >
                    <div>
                      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-dashed border-white/10 text-stone-500">
                        <BookOpenText className="h-7 w-7" />
                      </div>
                      <p className="mt-5 text-sm leading-6 text-stone-500">
                        Load the seed script first, then select a capability from the
                        library.
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
