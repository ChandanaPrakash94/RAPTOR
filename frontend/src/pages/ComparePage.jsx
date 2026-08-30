import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import { 
  GitCompare, Loader, AlertCircle, ChevronDown, ChevronUp, 
  DollarSign, Zap, ShieldCheck, TrendingDown, Layers, Award, Sparkles, AlertTriangle 
} from "lucide-react";
import MarkdownRenderer from "@/components/MarkdownRenderer";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const NODE_COLORS = { ROOT: "#8B5CF6", TOPIC: "#4F46E5", SECTION: "#4F46E5", CHUNK: "#10B981" };

// Model pricing per 1M input tokens
const PRICING_MODELS = {
  "gemini-2-5-flash": { name: "Gemini 2.5 Flash", rate: 0.15 },
  "claude-3-5-sonnet": { name: "Claude 3.5 Sonnet", rate: 3.00 },
  "gpt-4o": { name: "GPT-4o", rate: 2.50 },
  "gemini-1-5-pro": { name: "Gemini 1.5 Pro", rate: 1.25 }
};

function TokenMeter({ tokens, rawTotal, label, accent }) {
  const pct = Math.min(100, Math.round((tokens / Math.max(1, rawTotal)) * 100));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[9px] font-mono-ibm tracking-[0.1em] text-[#71717A]">
        <span>{label}</span>
        <span style={{ color: accent }} className="font-bold">{tokens?.toLocaleString()} tokens</span>
      </div>
      <div className="h-1.5 bg-[#18181B]">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="h-full"
          style={{ background: accent }}
        />
      </div>
      <div className="text-[8px] font-mono-ibm text-[#3F3F46]">
        {pct}% of raw conversation ({rawTotal?.toLocaleString()} total)
      </div>
    </div>
  );
}

function ResultPanel({ result, label, sublabel, accent, badge, isRaw, isSupermemory, sourcesOpen, setSourcesOpen, pricingKey }) {
  const tc = isRaw
    ? { context_tokens: result?.context_tokens, latency_ms: result?.latency_ms, answer_tokens: result?.answer_tokens }
    : isSupermemory
    ? { context_tokens: result?.context_tokens, latency_ms: result?.latency_ms, answer_tokens: result?.answer_tokens }
    : result?.token_counts || {};

  const pricing = PRICING_MODELS[pricingKey] || PRICING_MODELS["gemini-2-5-flash"];
  const costPerQuery = ((tc.context_tokens || 0) / 1_000_000) * pricing.rate;
  const costPer10k = costPerQuery * 10000;

  return (
    <div className="flex-1 min-w-0 border flex flex-col bg-[#0A0A0C]" style={{ borderColor: accent + "40" }}>
      {/* Panel header */}
      <div className="px-4 py-3 border-b" style={{ borderColor: accent + "30", background: accent + "08" }}>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-[9px] font-mono-ibm tracking-[0.15em] uppercase font-bold" style={{ color: accent }}>
                {label}
              </p>
              {badge && (
                <span className="text-[8px] font-mono-ibm px-1.5 py-0.2 rounded" style={{ background: accent + "25", color: accent }}>
                  {badge}
                </span>
              )}
            </div>
            <p className="text-[10px] text-[#71717A] font-mono-ibm mt-0.5">{sublabel}</p>
            <p className="text-xl font-mono-ibm font-bold text-[#F4F4F5] mt-1">
              {tc.context_tokens?.toLocaleString() ?? "—"}
              <span className="text-[#71717A] text-xs font-normal"> tokens</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-mono-ibm text-[#71717A]">LATENCY</p>
            <p className="text-sm font-mono-ibm font-bold text-[#F4F4F5]">{tc.latency_ms?.toLocaleString() || "—"}ms</p>
            <p className="text-[9px] font-mono-ibm text-[#10B981] mt-0.5">
              ${costPerQuery.toFixed(5)}
            </p>
          </div>
        </div>
      </div>

      {/* Answer Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3.5 max-h-[500px]" data-testid={`answer-panel-${label.toLowerCase().replace(/\s/g, '-')}`}>
        {result?.answer ? (
          <MarkdownRenderer content={result.answer} compact={false} />
        ) : (
          <p className="text-[#3F3F46] text-xs font-mono-ibm">No answer generated yet</p>
        )}
      </div>

      {/* Cost footer */}
      <div className="px-4 py-2 bg-[#0D0D10] border-t border-[#18181B] flex items-center justify-between text-[9px] font-mono-ibm">
        <span className="text-[#71717A]">10K QUERIES:</span>
        <span className="font-bold" style={{ color: isRaw ? '#EF4444' : isSupermemory ? '#F59E0B' : '#10B981' }}>
          ${costPer10k.toFixed(2)} ({pricing.name})
        </span>
      </div>

      {/* Sources list */}
      {!isRaw && result?.nodes_used?.length > 0 && (
        <div className="border-t px-4 py-2.5 bg-[#0F0F11]" style={{ borderColor: accent + "20" }}>
          <button
            onClick={() => setSourcesOpen(o => !o)}
            className="flex items-center gap-1.5 text-[9px] font-mono-ibm text-[#71717A] hover:text-[#F4F4F5] transition-colors duration-200"
          >
            {sourcesOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            <span className="font-bold" style={{ color: accent }}>{result.nodes_used.length} NODES USED</span>
          </button>
          {sourcesOpen && (
            <div className="mt-2 space-y-1 max-h-36 overflow-y-auto">
              {result.nodes_used.map((n, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[8px] font-mono-ibm py-0.5 border-l-2 pl-1.5 bg-[#050505]"
                  style={{ borderColor: NODE_COLORS[n.level] || accent }}>
                  <span className="font-bold" style={{ color: NODE_COLORS[n.level] || accent }}>{n.level || 'CHUNK'}</span>
                  {n.similarity !== undefined && (
                    <span className="text-[#A1A1AA]">{(n.similarity * 100).toFixed(0)}%</span>
                  )}
                  {n.token_count && <span className="text-[#71717A]">{n.token_count}t</span>}
                  {n.topic_label && <span className="text-[#8B5CF6] font-semibold">{n.topic_label}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ComparePage() {
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState("");
  const [query, setQuery] = useState("");
  const [tokenBudget, setTokenBudget] = useState(4000);
  const [pricingModel, setPricingModel] = useState("gemini-2-5-flash");
  const [queryVolume, setQueryVolume] = useState(50000);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    axios.get(`${API}/conversations`).then(r => {
      const convs = r.data || [];
      setConversations(convs);
      if (!selectedConv && convs.length > 0) {
        const biggest = convs.reduce((a, b) =>
          (b.stats?.estimated_raw_tokens || 0) > (a.stats?.estimated_raw_tokens || 0) ? b : a
        );
        setSelectedConv(biggest.conversation_id);
      }
    }).catch(() => {});
  }, []);

  const handleCompare = async () => {
    if (!query.trim() || !selectedConv) return;
    setLoading(true); setError(""); setResult(null); setSourcesOpen(false);
    try {
      const res = await axios.post(`${API}/compare`, {
        conversation_id: selectedConv,
        query: query.trim(),
        token_budget: tokenBudget,
      }, { timeout: 120000 });
      setResult(res.data);
    } catch (e) {
      setError(e.response?.data?.detail || e.message || "Comparison failed. Please verify your Gemini API Key in Settings.");
    } finally { setLoading(false); }
  };

  const summary = result?.summary;
  const selectedStats = conversations.find(c => c.conversation_id === selectedConv)?.stats;

  // Financial calculations
  const currentRate = PRICING_MODELS[pricingModel]?.rate || 0.15;
  const rawQueryCost = summary ? (summary.raw_tokens / 1_000_000) * currentRate : 0;
  const raptorQueryCost = summary ? (summary.raptor_tokens / 1_000_000) * currentRate : 0;
  const savingsPerQuery = Math.max(0, rawQueryCost - raptorQueryCost);
  const monthlySavings = savingsPerQuery * queryVolume;

  return (
    <div className="p-8 min-h-full" data-testid="compare-page">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <GitCompare size={24} strokeWidth={1.5} className="text-[#8B5CF6]" />
            <h1 className="text-3xl tracking-tighter font-mono-ibm font-bold text-[#F4F4F5]">3-WAY LIVE BENCHMARK</h1>
            <span className="px-2.5 py-1 bg-[#8B5CF6]/20 border border-[#8B5CF6]/40 text-[#8B5CF6] text-[9px] font-mono-ibm font-bold tracking-[0.2em] uppercase rounded-sm flex items-center gap-1">
              <Award size={10} /> Judge Presentation Mode
            </span>
          </div>
          <p className="text-xs text-[#71717A] font-mono-ibm">
            ConvoMemory (Hierarchical RAPTOR) vs. Supermemory (Flat Vector RAG) vs. Full Raw Window Dump
          </p>
        </div>

        {/* Pricing selector */}
        <div className="flex items-center gap-2 bg-[#0F0F11] border border-[#27272A] p-1.5">
          <DollarSign size={13} className="text-[#10B981]" />
          <span className="text-[9px] font-mono-ibm text-[#71717A] tracking-wider uppercase">PRICING:</span>
          <select 
            value={pricingModel} 
            onChange={e => setPricingModel(e.target.value)}
            className="bg-[#050505] border border-[#27272A] text-xs font-mono-ibm text-[#F4F4F5] px-2 py-1 outline-none cursor-pointer"
          >
            {Object.entries(PRICING_MODELS).map(([k, v]) => (
              <option key={k} value={k}>{v.name} (${v.rate}/1M)</option>
            ))}
          </select>
        </div>
      </div>

      {/* Architectural Advantage Matrix for Judges */}
      <div className="bg-[#0F0F11] border border-[#27272A] p-4 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono-ibm">
          <div className="p-3 bg-[#8B5CF6]/08 border border-[#8B5CF6]/50">
            <p className="text-[#8B5CF6] font-bold tracking-wide uppercase mb-1 flex items-center gap-1">
              <ShieldCheck size={12} /> 1. ConvoMemory (Our RAPTOR)
            </p>
            <p className="text-[#A1A1AA] text-[10px] leading-relaxed">
              <b className="text-[#F4F4F5]">Hierarchical GMM Clustering</b> + Recursive summaries. Dynamically selects ROOT overview, TOPIC clusters, and CHUNKS. Excels at both holistic and specific questions.
            </p>
          </div>
          <div className="p-3 bg-[#050505] border border-[#F59E0B]/30">
            <p className="text-[#F59E0B] font-bold tracking-wide uppercase mb-1 flex items-center gap-1">
              <AlertTriangle size={12} /> 2. Supermemory (Flat Vector RAG)
            </p>
            <p className="text-[#71717A] text-[10px] leading-relaxed">
              <b className="text-[#F4F4F5]">Flat Top-5 Chunks</b> only. Has zero macro summaries. Fails on overarching queries (*"Summarize our full architecture changes"*) because no single chunk has high cosine match.
            </p>
          </div>
          <div className="p-3 bg-[#050505] border border-[#EF4444]/30">
            <p className="text-[#EF4444] font-bold tracking-wide uppercase mb-1">3. Full Raw Window Dump</p>
            <p className="text-[#71717A] text-[10px] leading-relaxed">
              <b className="text-[#F4F4F5]">Injects all 37K+ tokens</b>. Very high latency (5–12s), 15× higher API bills, and suffers from the well-documented "lost-in-the-middle" LLM attention degradation.
            </p>
          </div>
        </div>
      </div>

      {/* Query Controls */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div>
          <label className="block text-[9px] font-mono-ibm tracking-[0.2em] uppercase text-[#71717A] mb-2">CONVERSATION</label>
          <select
            value={selectedConv}
            onChange={e => setSelectedConv(e.target.value)}
            data-testid="compare-conv-selector"
            className="w-full px-3 py-2.5 bg-[#0F0F11] border border-[#27272A] text-[#F4F4F5] text-xs font-mono-ibm outline-none focus:border-[#8B5CF6] transition-colors duration-200 cursor-pointer"
          >
            <option value="">Select conversation...</option>
            {conversations.map(c => (
              <option key={c.conversation_id} value={c.conversation_id}>
                {c.conversation_id} ({c.stats?.total_messages} msg · {((c.stats?.estimated_raw_tokens || 0) / 1000).toFixed(1)}K tokens)
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <div className="flex items-center justify-between mb-2">
            <label className="text-[9px] font-mono-ibm tracking-[0.2em] uppercase text-[#71717A]">TEST QUESTION</label>
            {selectedStats && (
              <span className="text-[9px] font-mono-ibm text-[#71717A]">
                {selectedStats.estimated_raw_tokens?.toLocaleString()} raw tokens · {selectedStats.total_topics} topics · {selectedStats.total_chunks} chunks
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleCompare()}
              data-testid="compare-query-input"
              disabled={loading}
              placeholder="e.g., What were all the key strategic decisions and architectural trade-offs made?"
              className="flex-1 px-3 py-2.5 bg-[#0F0F11] border border-[#27272A] text-[#F4F4F5] text-sm font-sans-ibm outline-none focus:border-[#8B5CF6] transition-colors duration-200"
            />
            <button
              onClick={handleCompare}
              disabled={loading || !query.trim() || !selectedConv}
              data-testid="compare-run-btn"
              className="px-6 py-2.5 bg-[#8B5CF6] text-white text-xs font-mono-ibm tracking-[0.1em] hover:bg-[#7C3AED] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200 whitespace-nowrap font-bold"
            >
              {loading ? "BENCHMARKING 3 PIPELINES..." : "RUN 3-WAY BENCHMARK"}
            </button>
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-3 px-5 py-4 bg-[#0F0F11] border border-[#8B5CF6]/50 mb-4"
          data-testid="compare-loading"
        >
          <Loader size={18} strokeWidth={1.5} className="animate-spin text-[#8B5CF6]" />
          <div>
            <p className="text-xs font-mono-ibm text-[#F4F4F5] font-bold">Running 3 Concurrent LLM Execution Pipelines</p>
            <p className="text-[10px] font-mono-ibm text-[#71717A] mt-0.5">
              1. ConvoMemory RAPTOR Tree &nbsp;|&nbsp; 2. Supermemory Flat Vector RAG &nbsp;|&nbsp; 3. Full Unfiltered Raw Context Dump
            </p>
          </div>
        </motion.div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center justify-between px-4 py-3 mb-4 bg-[#7F1D1D]/20 border border-[#EF4444]/40 text-[#FCA5A5] text-xs font-mono-ibm">
          <div className="flex items-center gap-2">
            <AlertCircle size={14} strokeWidth={1.5} /> 
            <span>{error}</span>
          </div>
          <button 
            onClick={() => navigate('/settings')}
            className="px-3 py-1 bg-[#8B5CF6] text-white text-[10px] font-bold hover:bg-[#7C3AED]"
          >
            Go to Settings →
          </button>
        </div>
      )}

      {/* Results */}
      <AnimatePresence>
        {result && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            data-testid="compare-results"
          >
            {/* Live Metrics Banner */}
            {summary && (
              <div className="bg-[#0F0F11] border border-[#27272A] p-4 mb-5">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pb-3 border-b border-[#1F1F23]">
                  <div>
                    <p className="text-[8px] font-mono-ibm tracking-[0.15em] uppercase text-[#8B5CF6] mb-0.5 font-bold">CONVOMEMORY (RAPTOR)</p>
                    <p className="text-2xl font-mono-ibm font-bold text-[#8B5CF6]">{summary.raptor_tokens?.toLocaleString()}t</p>
                    <span className="text-[8px] font-mono-ibm text-[#10B981]">{summary.raptor_latency_ms}ms latency</span>
                  </div>
                  <div>
                    <p className="text-[8px] font-mono-ibm tracking-[0.15em] uppercase text-[#F59E0B] mb-0.5 font-bold">SUPERMEMORY (FLAT RAG)</p>
                    <p className="text-2xl font-mono-ibm font-bold text-[#F59E0B]">{summary.supermemory_tokens?.toLocaleString()}t</p>
                    <span className="text-[8px] font-mono-ibm text-[#A1A1AA]">{summary.supermemory_latency_ms}ms latency</span>
                  </div>
                  <div>
                    <p className="text-[8px] font-mono-ibm tracking-[0.15em] uppercase text-[#A1A1AA] mb-0.5 font-bold">RAW CONTEXT DUMP</p>
                    <p className="text-2xl font-mono-ibm font-bold text-[#A1A1AA]">{summary.raw_tokens?.toLocaleString()}t</p>
                    <span className="text-[8px] font-mono-ibm text-[#EF4444]">{summary.raw_latency_ms}ms latency</span>
                  </div>
                  <div>
                    <p className="text-[8px] font-mono-ibm tracking-[0.15em] uppercase text-[#10B981] mb-0.5 font-bold">TOKEN REDUCTION</p>
                    <p className="text-2xl font-mono-ibm font-bold text-[#10B981] flex items-center gap-1">
                      <TrendingDown size={18} /> {summary.reduction_pct}%
                    </p>
                    <span className="text-[8px] font-mono-ibm text-[#71717A]">vs Raw context</span>
                  </div>
                  <div className="col-span-2 md:col-span-1 bg-[#052E16]/40 border border-[#10B981]/30 p-2">
                    <p className="text-[8px] font-mono-ibm tracking-[0.15em] uppercase text-[#10B981] font-bold mb-0.5 flex items-center gap-1">
                      <DollarSign size={10} /> SAVINGS / 10K
                    </p>
                    <p className="text-lg font-mono-ibm font-bold text-[#10B981]">
                      ${(savingsPerQuery * 10000).toFixed(2)}
                    </p>
                    <span className="text-[8px] font-mono-ibm text-[#A1A1AA]">savings vs raw</span>
                  </div>
                </div>

                {/* Comparative token bars */}
                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <TokenMeter
                    tokens={summary.raptor_tokens}
                    rawTotal={summary.estimated_full_tokens}
                    label="CONVOMEMORY (RAPTOR)"
                    accent="#8B5CF6"
                  />
                  <TokenMeter
                    tokens={summary.supermemory_tokens}
                    rawTotal={summary.estimated_full_tokens}
                    label="SUPERMEMORY (FLAT RAG)"
                    accent="#F59E0B"
                  />
                  <TokenMeter
                    tokens={summary.raw_tokens}
                    rawTotal={summary.estimated_full_tokens}
                    label="RAW DUMP"
                    accent="#4B5563"
                  />
                </div>
              </div>
            )}

            {/* 3-Column Side-by-Side Response Quality Panels */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch min-h-[440px]">
              <ResultPanel
                result={result.raptor}
                label="CONVOMEMORY"
                sublabel="Recursive Hierarchical Memory"
                badge="OUR SYSTEM"
                accent="#8B5CF6"
                isRaw={false}
                isSupermemory={false}
                sourcesOpen={sourcesOpen}
                setSourcesOpen={setSourcesOpen}
                pricingKey={pricingModel}
              />
              <ResultPanel
                result={result.supermemory}
                label="SUPERMEMORY"
                sublabel="Flat Top-5 Chunks RAG"
                badge="COMPETITOR"
                accent="#F59E0B"
                isRaw={false}
                isSupermemory={true}
                sourcesOpen={false}
                setSourcesOpen={() => {}}
                pricingKey={pricingModel}
              />
              <ResultPanel
                result={{ answer: result.raw?.answer, token_counts: { context_tokens: result.raw?.context_tokens, latency_ms: result.raw?.latency_ms } }}
                label="RAW WINDOW DUMP"
                sublabel="Uncompressed Entire Chat"
                badge="TRADITIONAL"
                accent="#4B5563"
                isRaw={true}
                isSupermemory={false}
                sourcesOpen={false}
                setSourcesOpen={() => {}}
                pricingKey={pricingModel}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="text-center py-16 text-[#71717A] bg-[#0A0A0C] border border-[#27272A]/50 mt-4">
          <GitCompare size={44} strokeWidth={0.8} className="mx-auto mb-4 text-[#8B5CF6]" />
          <p className="text-sm font-mono-ibm text-[#F4F4F5] font-bold">Ready to Run the 3-Way Live Benchmark</p>
          <p className="text-xs font-mono-ibm text-[#71717A] mt-1 max-w-lg mx-auto">
            Select an indexed conversation above and ask a high-level synthesis question. The system will execute ConvoMemory RAPTOR, Supermemory Flat Vector RAG, and Raw Context Stuffing in parallel to demonstrate accuracy, token savings, and latency live!
          </p>
        </div>
      )}
    </div>
  );
}
