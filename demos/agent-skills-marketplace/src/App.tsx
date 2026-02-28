import { useState, useEffect } from 'react';
import { Bot, TerminalSquare, ShoppingCart, Zap, CheckCircle2, Code2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const API_URL = import.meta.env.VITE_WORDCLAW_URL;
const API_KEY = import.meta.env.VITE_WORDCLAW_API_KEY;

interface Skill {
  id: string;
  data: {
    title: string;
    slug: string;
    description: string;
    authorName: string;
    authorAvatar: string;
    category: string;
    promptTemplate: string;
    basePrice: number;
  };
}

export default function App() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [activeTab, setActiveTab] = useState<'marketplace' | 'guide'>('marketplace');

  // L402 State
  const [invoiceStatus, setInvoiceStatus] = useState<'idle' | 'required' | 'paying' | 'paid'>('idle');
  const [invoiceData, setInvoiceData] = useState<{ invoice: string, macaroon: string, amount: number } | null>(null);
  const [purchasedSkillData, setPurchasedSkillData] = useState<Skill | null>(null);

  // Sandbox State
  const [sandboxMode, setSandboxMode] = useState(false);
  const [sandboxVariables, setSandboxVariables] = useState<Record<string, string>>({});
  const [sandboxResult, setSandboxResult] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);

  useEffect(() => {
    fetchSkills();
  }, []);

  const fetchSkills = async () => {
    try {
      // 1. First fetch the content type ID for 'agent-skill'
      const ctRes = await fetch(`${API_URL}/content-types`, {
        headers: {
          'x-api-key': API_KEY
        }
      });
      const ctJson = await ctRes.json();
      const skillCt = (ctJson.data || []).find((ct: any) => ct.slug === 'agent-skill');

      if (!skillCt) {
        console.error("Agent Skill content type not found");
        setLoading(false);
        return;
      }

      // 2. Fetch skills using the specific contentTypeId
      const res = await fetch(`${API_URL}/content-items?contentTypeId=${skillCt.id}`, {
        headers: {
          'x-api-key': API_KEY
        }
      });
      const resJson = await res.json();
      if (resJson.data) {
        // WordClaw stores content item 'data' as stringified JSON, need to parse it for the UI
        const parsedSkills = resJson.data.map((item: any) => ({
          ...item,
          data: typeof item.data === 'string' ? JSON.parse(item.data) : item.data
        }));
        setSkills(parsedSkills);
      }
    } catch (err) {
      console.error("Failed to fetch skills", err);
    } finally {
      setLoading(false);
    }
  };

  const attemptToReadSkill = async (skillId: string) => {
    setInvoiceStatus('idle');
    setInvoiceData(null);
    setPurchasedSkillData(null);
    setSandboxMode(false);
    setSandboxVariables({});
    setSandboxResult(null);
    setSelectedSkill(skills.find(s => s.id === skillId) || null);

    try {
      // 1. Fetch available offers for this skill
      const offersRes = await fetch(`${API_URL}/content-items/${skillId}/offers`, {
        headers: {
          'x-api-key': API_KEY
        }
      });
      const offersData = await offersRes.json();
      const availableOffers = offersData.data || [];

      if (availableOffers.length > 0) {
        const offer = availableOffers[0];

        // 2. Initiate purchase to get invoice/macaroon
        const purchaseRes = await fetch(`${API_URL}/offers/${offer.id}/purchase`, {
          method: 'POST',
          headers: {
            'x-api-key': API_KEY
          }
        });

        if (purchaseRes.status === 402) {
          const purchaseData = await purchaseRes.json();
          const details = purchaseData.error?.details || {};
          setInvoiceStatus('required');
          setInvoiceData({
            invoice: details.invoice,
            macaroon: details.macaroon,
            amount: details.amountSatoshis,
            offerId: offer.id,
            paymentHash: purchaseData.paymentHash
          });
          return;
        }
      }

      // If no offers (free), we just read the item directly
      const res = await fetch(`${API_URL}/content-items/${skillId}`, {
        method: 'GET',
        headers: {
          'x-api-key': API_KEY,
        }
      });
      const data = await res.json();
      if (data.data) {
        const parsedData = { ...data.data, data: typeof data.data.data === 'string' ? JSON.parse(data.data.data) : data.data.data };
        setPurchasedSkillData(parsedData);
      }
    } catch (err) {
      console.error("Failed to fetch skill data", err);
    }
  };

  const payInvoice = async () => {
    setInvoiceStatus('paying');

    // Simulate real-world Lightning delay
    setTimeout(async () => {
      setInvoiceStatus('paid');
      const MOCK_PREIMAGE = "mock_preimage_12345";

      if (selectedSkill && invoiceData) {
        try {
          // 3. Confirm purchase to transition entitlement to paid
          await fetch(`${API_URL}/offers/${invoiceData.offerId}/purchase/confirm`, {
            method: 'POST',
            headers: {
              'x-api-key': API_KEY,
              'x-payment-hash': invoiceData.paymentHash,
              'Authorization': `L402 ${invoiceData.macaroon}:${MOCK_PREIMAGE}`
            }
          });

          // 4. Fetch the premium skill payload with the active L402 token
          const res = await fetch(`${API_URL}/content-items/${selectedSkill.id}`, {
            headers: {
              'x-api-key': API_KEY,
              'Authorization': `L402 ${invoiceData.macaroon}:${MOCK_PREIMAGE}`
            }
          });

          const data = await res.json();
          if (data.data) {
            const parsedData = { ...data.data, data: typeof data.data.data === 'string' ? JSON.parse(data.data.data) : data.data.data };
            setPurchasedSkillData(parsedData);
          }
        } catch (err) {
          console.error("Failed to confirm purchase or fetch secure payload", err);
        }
      }
    }, 1500);
  };

  const handleSelectSkill = (skill: Skill) => {
    setSelectedSkill(skill);
    setInvoiceStatus('idle');
    setInvoiceData(null);
    setPurchasedSkillData(null);
    setSandboxMode(false);
    setSandboxVariables({});
    setSandboxResult(null);
  };

  const getPromptVariables = (prompt: string) => {
    const matches = prompt.match(/{{([^}]+)}}/g) || [];
    return [...new Set(matches.map(m => m.replace(/{{|}}/g, '').trim()))];
  };

  const simulateExecution = () => {
    setSimulating(true);
    setSandboxResult(null);

    setTimeout(() => {
      let finalPrompt = purchasedSkillData?.data.promptTemplate || '';
      Object.entries(sandboxVariables).forEach(([key, val]) => {
        finalPrompt = finalPrompt.replace(new RegExp(`{{${key}}}`, 'g'), val || `[${key}]`);
      });

      setSandboxResult(`[SIMULATED LLM RESPONSE FOR PROMPT]\n\nEvaluating: "${finalPrompt.substring(0, 50)}..."\n\nResult:\nSuccessfully applied agent skill. In a real environment, this bounded prompt structure would be securely routed to an LLM provider and the response mapped back to the agent's memory or action loop.`);
      setSimulating(false);
    }, 1500);
  };

  const downloadSkill = () => {
    if (!purchasedSkillData) return;

    const payloadString = JSON.stringify(purchasedSkillData.data, null, 2);
    const blob = new Blob([payloadString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${purchasedSkillData.data.slug}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 font-sans selection:bg-blue-500/30">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Agent<span className="text-blue-500">Skills</span></h1>
              <p className="text-xs text-slate-400 font-medium tracking-wide uppercase">L402 Native Marketplace</p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <nav className="flex items-center gap-4 text-sm font-medium text-slate-400">
              <button
                onClick={() => setActiveTab('marketplace')}
                className={`hover:text-white transition-colors ${activeTab === 'marketplace' ? 'text-white border-b-2 border-blue-500 py-7' : 'py-7'}`}
              >
                Marketplace
              </button>
              <button
                onClick={() => setActiveTab('guide')}
                className={`hover:text-white transition-colors ${activeTab === 'guide' ? 'text-white border-b-2 border-blue-500 py-7' : 'py-7'}`}
              >
                How It Works
              </button>
            </nav>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-800 border border-slate-700 text-sm font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Agent Node: Connected
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-12">

        <div className="mb-12 text-center max-w-2xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6 bg-gradient-to-br from-white to-slate-400 bg-clip-text text-transparent">
            Expand Your Agent's Capabilities
          </h2>
          <p className="text-lg text-slate-400">
            Discover, purchase, and integrate programmatic skills built by other agents. All payments settle instantly via the Lightning Network.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 rounded-full border-t-2 border-l-2 border-blue-500 animate-spin"></div>
          </div>
        ) : activeTab === 'guide' ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-4xl mx-auto"
          >
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 md:p-12 shadow-2xl">
              <h3 className="text-3xl font-bold mb-8 flex items-center gap-3">
                <TerminalSquare className="w-8 h-8 text-blue-500" />
                How It Works
              </h3>

              <div className="space-y-12 text-slate-400 leading-relaxed mt-12">
                {/* 1. Publishing */}
                <div className="flex flex-col md:flex-row gap-6 items-start">
                  <div className="w-12 h-12 rounded-2xl bg-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
                    <Code2 className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xl font-bold text-white mb-3">1. Agent Publishing & Revenue Routing</h4>
                    <p className="mb-4">
                      Autonomous creators (or human engineers) use the standard WordClaw Content Management API to upload their programmatic skills into the registry. During creation, the agent defines the <strong>payload</strong> (e.g., highly optimized system prompts or JSON definitions) and sets a <strong>base price</strong> in Satoshis.
                    </p>
                    <p className="mb-4">
                      Leveraging WordClaw's <strong>AP2 (Agentic Podcasting 2.0)</strong> standard, creators attach nested revenue routing splits natively to the content model—ensuring the primary creator, hosting instance, and any downstream dependencies receive their exact micro-payouts instantly upon consumption.
                    </p>
                    <div className="bg-black/50 rounded-xl p-4 font-mono text-[11px] md:text-xs text-purple-300 border border-slate-800 whitespace-pre-wrap overflow-x-auto shadow-inner">
                      {`POST /api/content-items
{
  "contentTypeId": "<agent-skill-id>",
  "status": "published",
  "data": { 
     "title": "Advanced React Generator",
     "basePrice": 250,
     "ap2_routing": [
        { "name": "Agent Creator", "pubkey": "03abcd...", "split": 90 },
        { "name": "Marketplace Node", "pubkey": "02bcde...", "split": 10 }
     ],
     "promptTemplate": "..."
  }
}`}
                    </div>
                  </div>
                </div>

                {/* 2. Purchasing */}
                <div className="flex flex-col md:flex-row gap-6 items-start">
                  <div className="w-12 h-12 rounded-2xl bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                    <Bot className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xl font-bold text-white mb-3">2. L402 Discovery & Challenge</h4>
                    <p className="mb-4">
                      When an executing agent discovers a skill it wants to acquire, it makes a standard HTTP request to fetch the payload. Because the content has a defined `basePrice`, WordClaw dynamically intercepts the request via its <strong>L402 middleware</strong>.
                    </p>
                    <div className="bg-black/50 rounded-xl p-4 font-mono text-[11px] md:text-xs text-blue-300 border border-slate-800 mb-4 whitespace-pre-wrap overflow-x-auto shadow-inner">
                      {`1. GET /api/content-items/:id
// HTTP 402 Payment Required
// WWW-Authenticate: L402 macaroon="..." invoice="..."

2. <Consuming Agent pays LN invoice off-band>

3. GET /api/content-items/:id
// Authorization: L402 <macaroon>:<preimage>
// HTTP 200 OK`}
                    </div>
                    <p className="text-sm">
                      The consumer pays the attached Lightning Network invoice using its own integrated node or wallet, fulfilling the cryptographic L402 challenge.
                    </p>
                  </div>
                </div>

                {/* 3. Delivery and Settlement */}
                <div className="flex flex-col md:flex-row gap-6 items-start">
                  <div className="w-12 h-12 rounded-2xl bg-orange-500/20 text-orange-400 flex items-center justify-center shrink-0">
                    <Zap className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xl font-bold text-white mb-3">3. Secure Delivery & Global Settlement</h4>
                    <p className="mb-4">
                      Upon validating the payment preimage attached to the macaroon, WordClaw unlocks the gate. The purchasing agent instantly receives the unredacted skill payload to execute locally in its sandbox environment.
                    </p>
                    <p className="mb-4">
                      Simultaneously, the Lightning Network inherently routes the Satoshis directly to the specific node addresses identified in the <strong>AP2 routing splits</strong>.
                    </p>
                    <div className="flex items-center gap-2 px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm font-medium">
                      <CheckCircle2 className="w-5 h-5 shrink-0" />
                      No middlemen, no withdrawal limits—just instant, programmatic revenue sharing between autonomous actors.
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">


            {/* Skills Grid */}
            <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-6">
              {skills.map((skill) => (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={skill.id}
                  onClick={() => handleSelectSkill(skill)}
                  className={`group bg-slate-900 rounded-2xl border transition-all duration-300 cursor-pointer ${selectedSkill?.id === skill.id ? 'border-blue-500 shadow-xl shadow-blue-500/10' : 'border-slate-800 hover:border-slate-700 hover:shadow-2xl hover:shadow-black'}`}
                >
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                        {skill.data.category}
                      </span>
                      <div className="flex items-center gap-1.5 text-orange-400 font-mono text-sm bg-orange-400/10 px-3 py-1 rounded-full border border-orange-400/20">
                        <Zap className="w-4 h-4" />
                        {skill.data.basePrice} sats
                      </div>
                    </div>

                    <h3 className="text-xl font-bold mb-3 group-hover:text-blue-400 transition-colors">{skill.data.title}</h3>
                    <p className="text-sm text-slate-400 mb-6 line-clamp-2 leading-relaxed">{skill.data.description}</p>

                    <div className="flex items-center justify-between mt-auto">
                      <div className="flex items-center gap-2">
                        <img src={skill.data.authorAvatar} alt={skill.data.authorName} className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700" />
                        <span className="text-xs font-medium text-slate-400">{skill.data.authorName}</span>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          attemptToReadSkill(skill.id);
                        }}
                        className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                      >
                        <ShoppingCart className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Detail / Payment Sidebar */}
            <div className="lg:col-span-1">
              <AnimatePresence mode="popLayout">
                {!selectedSkill && (
                  <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="bg-slate-900/50 rounded-2xl border border-slate-800 border-dashed p-10 flex flex-col items-center justify-center text-center h-[500px]"
                  >
                    <TerminalSquare className="w-12 h-12 text-slate-600 mb-4" />
                    <p className="text-slate-400 font-medium">Select a skill to view properties and initiate purchase.</p>
                  </motion.div>
                )}

                {selectedSkill && invoiceStatus === 'idle' && (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-slate-900 rounded-2xl border border-blue-500/30 overflow-hidden shadow-2xl shadow-blue-500/10 sticky top-28 flex flex-col h-[500px]"
                  >
                    <div className="bg-slate-800/50 border-b border-slate-800 p-6">
                      <div className="flex items-center gap-3 mb-4">
                        <img src={selectedSkill.data.authorAvatar} alt={selectedSkill.data.authorName} className="w-12 h-12 rounded-xl bg-slate-800 border-2 border-slate-700" />
                        <div>
                          <h3 className="text-lg font-bold text-white line-clamp-1">{selectedSkill.data.title}</h3>
                          <span className="text-sm text-slate-400">by {selectedSkill.data.authorName}</span>
                        </div>
                      </div>
                      <div className="flex gap-2 mb-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                          {selectedSkill.data.category}
                        </span>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-500/10 text-orange-400 border border-orange-500/20">
                          <Zap className="w-3 h-3" />
                          {selectedSkill.data.basePrice} sats
                        </span>
                      </div>
                      <p className="text-sm text-slate-300 leading-relaxed mb-6">
                        {selectedSkill.data.description}
                      </p>
                    </div>
                    <div className="p-6 mt-auto">
                      <button
                        onClick={(e) => { e.stopPropagation(); attemptToReadSkill(selectedSkill.id); }}
                        className="w-full py-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
                      >
                        <ShoppingCart className="w-5 h-5" /> Initiate Purchase
                      </button>
                    </div>
                  </motion.div>
                )}

                {selectedSkill && invoiceStatus === 'required' && (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-slate-900 rounded-2xl border border-orange-500/30 overflow-hidden shadow-2xl shadow-orange-500/10 sticky top-28"
                  >
                    <div className="bg-orange-500/10 border-b border-orange-500/20 p-6 flex flex-col items-center justify-center text-center">
                      <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-yellow-500 rounded-full flex items-center justify-center mb-4 shadow-lg shadow-orange-500/30">
                        <Zap className="w-8 h-8 text-white" />
                      </div>
                      <h3 className="text-xl font-bold text-white mb-1">402 Payment Required</h3>
                      <p className="text-sm text-orange-200/80">You must pay the following Lightning invoice to access this skill.</p>
                    </div>

                    <div className="p-6">
                      <div className="mb-6">
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-slate-400">Target Skill</span>
                          <span className="font-medium truncate max-w-[150px]">{selectedSkill.data.title}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Amount</span>
                          <span className="font-mono text-orange-400 font-bold">{invoiceData?.amount} sats</span>
                        </div>
                      </div>

                      <div className="bg-black/50 rounded-xl p-4 font-mono text-[10px] text-slate-500 break-all mb-6 border border-slate-800 leading-tight">
                        {invoiceData?.invoice}
                      </div>

                      <button
                        onClick={payInvoice}
                        className="w-full py-3.5 rounded-xl bg-gradient-to-r from-orange-500 to-yellow-500 hover:from-orange-400 hover:to-yellow-400 text-white font-bold shadow-lg shadow-orange-500/20 transition-all flex items-center justify-center gap-2"
                      >
                        <Zap className="w-4 h-4" /> Simulate Agent Payment
                      </button>
                      <p className="text-xs text-center text-slate-500 mt-4">This action simulates a backend agent fulfilling the L402 challenge.</p>
                    </div>
                  </motion.div>
                )}

                {selectedSkill && invoiceStatus === 'paying' && (
                  <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="bg-slate-900 rounded-2xl border border-blue-500/30 p-10 flex flex-col items-center justify-center text-center shadow-2xl shadow-blue-500/10 h-[500px]"
                  >
                    <div className="w-16 h-16 rounded-full border-4 border-slate-800 border-t-blue-500 animate-spin mb-6"></div>
                    <h3 className="text-lg font-bold text-blue-400 mb-2">Verifying Payment Signature</h3>
                    <p className="text-sm text-slate-400">Routing {invoiceData?.amount} sats via local Lightning node...</p>
                  </motion.div>
                )}

                {selectedSkill && invoiceStatus === 'paid' && purchasedSkillData && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`bg-slate-900 rounded-2xl border border-emerald-500/30 overflow-hidden shadow-2xl shadow-emerald-500/10 sticky top-28 h-[500px] flex flex-col ${!sandboxMode ? 'items-center justify-center text-center p-8' : 'p-6'}`}
                  >
                    {!sandboxMode ? (
                      <>
                        <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-6 ring-4 ring-emerald-500/10">
                          <CheckCircle2 className="w-8 h-8" />
                        </div>

                        <h3 className="text-2xl font-bold mb-2">Payment Successful</h3>
                        <p className="text-emerald-400/80 mb-8 font-medium">Skill unlocked and securely delivered.</p>

                        <div className="w-full text-left">
                          <div className="bg-slate-900 rounded-xl p-4 font-mono text-xs text-emerald-400 border border-slate-800 overflow-y-auto max-h-64 mb-6 leading-relaxed flex flex-col gap-2 shadow-inner">
                            <span className="text-slate-500 font-sans font-semibold uppercase tracking-wider text-[10px] sticky top-0 bg-slate-900/90 backdrop-blur-sm py-1 z-10 flex items-center gap-2">
                              <TerminalSquare className="w-3 h-3" />
                              Prompt Payload
                            </span>
                            {purchasedSkillData.data.promptTemplate.split('\n').map((line, i) => line.trim() ? (
                              <span key={i} className="bg-slate-800/50 px-2 py-1 flex-wrap break-words rounded inline-block max-w-full">{line}</span>
                            ) : null)}
                          </div>

                          <div className="flex gap-4">
                            <button
                              onClick={() => setSandboxMode(true)}
                              className="flex-1 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium transition-colors border border-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 font-sans"
                            >
                              Execute Skill in Sandbox
                            </button>
                            <button
                              onClick={downloadSkill}
                              className="px-4 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium transition-colors border border-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500 font-sans"
                              title="Download Skill JSON"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="w-full flex flex-col h-full">
                        <div className="flex items-center justify-between mb-6">
                          <h3 className="text-xl font-bold flex items-center gap-2">
                            <Code2 className="w-5 h-5 text-blue-400" />
                            Agent Sandbox
                          </h3>
                          <button onClick={() => setSandboxMode(false)} className="text-sm text-slate-400 hover:text-white transition-colors">
                            &larr; Back
                          </button>
                        </div>

                        <div className="mb-6">
                          <p className="text-sm text-slate-400 mb-4">Complete the template variables and simulate execution.</p>
                          {getPromptVariables(purchasedSkillData.data.promptTemplate).length > 0 ? (
                            <div className="space-y-4">
                              {getPromptVariables(purchasedSkillData.data.promptTemplate).map(variable => (
                                <div key={variable}>
                                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                    {variable}
                                  </label>
                                  <input
                                    type="text"
                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                                    placeholder={`Enter ${variable}...`}
                                    value={sandboxVariables[variable] || ''}
                                    onChange={(e) => setSandboxVariables(prev => ({ ...prev, [variable]: e.target.value }))}
                                  />
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-400">
                              No variables found in this prompt template.
                            </div>
                          )}
                        </div>

                        <div className="mt-auto">
                          {sandboxResult && (
                            <div className="mb-4 bg-black/50 border border-emerald-900/50 rounded-lg p-4 font-mono text-xs text-emerald-400 whitespace-pre-wrap">
                              {sandboxResult}
                            </div>
                          )}

                          <button
                            onClick={simulateExecution}
                            disabled={simulating}
                            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors shadow-lg shadow-blue-500/20"
                          >
                            {simulating ? 'Simulating...' : 'Simulate Execution'}
                          </button>
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )
        }
      </main >
    </div >
  );
}
