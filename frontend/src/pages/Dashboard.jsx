import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { 
  GitBranch, MessageSquare, Trash2, RefreshCw, Layers, 
  Search, Share2, Copy, Check, ExternalLink, GitCompare, Sparkles, FileText, ArrowRight
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function StatCard({ label, value, sub }) {
  return (
    <div
      data-testid={`stat-card-${label.toLowerCase().replace(/\s/g, "-")}`}
      className="bg-[#0F0F11] border border-[#27272A] p-5"
    >
      <p className="text-[9px] font-mono-ibm tracking-[0.2em] uppercase text-[#71717A] mb-2">{label}</p>
      <p className="text-3xl font-mono-ibm font-bold text-[#F4F4F5] tracking-tighter">{value}</p>
      {sub && <p className="text-[10px] text-[#71717A] mt-1 font-mono-ibm">{sub}</p>}
    </div>
  );
}

function ContextTransferModal({ conversationId, isOpen, onClose }) {
  const [exportData, setExportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen || !conversationId) return;
    setLoading(true);
    setCopied(false);
    axios.get(`${API}/export/${conversationId}`)
      .then(res => setExportData(res.data))
      .catch(() => setExportData(null))
      .finally(() => setLoading(false));
  }, [isOpen, conversationId]);

  if (!isOpen) return null;

  const handleCopy = () => {
    if (exportData?.markdown) {
      navigator.clipboard.writeText(exportData.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#0F0F11] border border-[#27272A] w-full max-w-2xl max-h-[85vh] flex flex-col p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between pb-4 border-b border-[#27272A]">
          <div className="flex items-center gap-2">
            <Share2 size={18} className="text-[#8B5CF6]" />
            <h2 className="text-lg font-mono-ibm font-bold text-[#F4F4F5]">CROSS-MODEL CONTEXT TRANSFER</h2>
          </div>
          <button onClick={onClose} className="text-[#71717A] hover:text-[#F4F4F5] font-mono-ibm text-xs">✕ CLOSE</button>
        </div>

        <p className="text-xs text-[#71717A] font-mono-ibm mt-3">
          Synthesized hierarchical memory capsule. Feed this into <b className="text-[#F4F4F5]">ChatGPT, Gemini, DeepSeek, Cursor</b> or any LLM to transfer conversation history with 90%+ token compression.
        </p>

        <div className="mt-3 flex items-center justify-between text-[10px] font-mono-ibm bg-[#050505] p-2.5 border border-[#27272A]">
          <span className="text-[#71717A]">CONVERSATION: <b className="text-[#F4F4F5]">{conversationId}</b></span>
          <span className="text-[#10B981] font-bold">
            {exportData ? `${exportData.reduction_pct}% COMPRESSION` : ""}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto my-4 bg-[#050505] border border-[#27272A] p-4 text-[11px] font-mono-ibm text-[#A1A1AA] leading-relaxed whitespace-pre-wrap">
          {loading ? "Generating universal context capsule..." : exportData?.markdown || "Could not generate export."}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-[#27272A]">
          <span className="text-[10px] font-mono-ibm text-[#71717A]">
            Ready to paste into ChatGPT, Gemini, Claude, or Copilot
          </span>
          <div className="flex gap-3">
            <button 
              onClick={handleCopy}
              disabled={loading || !exportData}
              className="flex items-center gap-2 px-5 py-2 bg-[#8B5CF6] text-white text-xs font-mono-ibm font-bold hover:bg-[#7C3AED] transition-colors duration-200"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "COPIED TO CLIPBOARD!" : "COPY CONTEXT CAPSULE"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function Dashboard() {
  const [conversations, setConversations] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeExportConv, setActiveExportConv] = useState(null);
  const navigate = useNavigate();

  const fetchConversations = async () => {
    try {
      const res = await axios.get(`${API}/conversations`);
      setConversations(res.data || []);
    } catch {
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchConversations(); }, []);

  const handleDelete = async (id) => {
    if (!window.confirm(`Delete "${id}"?`)) return;
    await axios.delete(`${API}/index/${id}`).catch(() => {});
    fetchConversations();
  };

  const filtered = conversations.filter(c => 
    c.conversation_id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalMsgs = conversations.reduce((s, c) => s + (c.stats?.total_messages || 0), 0);
  const totalChunks = conversations.reduce((s, c) => s + (c.stats?.total_chunks || 0), 0);
  const totalRaw = conversations.reduce((s, c) => s + (c.stats?.estimated_raw_tokens || 0), 0);
  const TOKEN_BUDGET = 4000;
  const avgReduction = conversations.length
    ? Math.max(0, Math.round((1 - TOKEN_BUDGET / Math.max(1, totalRaw / Math.max(1, conversations.length))) * 100))
    : 0;

  return (
    <div className="p-8 min-h-full" data-testid="dashboard-page">
      <ContextTransferModal 
        conversationId={activeExportConv} 
        isOpen={!!activeExportConv} 
        onClose={() => setActiveExportConv(null)} 
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-4xl tracking-tighter font-mono-ibm font-bold text-[#F4F4F5]">
            RAPTOR Memory
          </h1>
          <p className="text-sm text-[#71717A] mt-1">Hierarchical token-aware conversation memory & cross-model context transfer</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => navigate("/compare")}
            className="flex items-center gap-2 px-4 py-2 bg-[#8B5CF6]/10 border border-[#8B5CF6]/40 text-[#8B5CF6] hover:bg-[#8B5CF6]/20 transition-colors duration-200 text-xs font-mono-ibm font-bold"
          >
            <GitCompare size={13} strokeWidth={1.5} /> BENCHMARK vs RAW
          </button>
          <button
            onClick={fetchConversations}
            data-testid="refresh-btn"
            className="flex items-center gap-2 px-4 py-2 border border-[#27272A] text-[#71717A] hover:text-[#F4F4F5] hover:border-[#3F3F46] transition-colors duration-200 text-xs font-mono-ibm"
          >
            <RefreshCw size={12} strokeWidth={1.5} /> REFRESH
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Indexed Conversations" value={conversations.length} />
        <StatCard label="Total Messages" value={totalMsgs.toLocaleString()} />
        <StatCard label="Est. Raw Tokens" value={totalRaw > 1000 ? `${(totalRaw / 1000).toFixed(1)}K` : totalRaw} />
        <StatCard
          label="Avg Token Reduction"
          value={conversations.length ? `${avgReduction}%` : "—"}
          sub={conversations.length ? `4K context from ~${(totalRaw / Math.max(1, conversations.length) / 1000).toFixed(1)}K raw` : "Index a conversation to see"}
        />
      </div>

      {/* Conversations table & search */}
      <div className="bg-[#0F0F11] border border-[#27272A]">
        <div className="flex flex-col md:flex-row items-center justify-between p-4 border-b border-[#27272A] gap-3">
          <div className="flex items-center gap-3 w-full md:w-auto">
            <p className="text-[9px] font-mono-ibm tracking-[0.2em] uppercase text-[#71717A] flex items-center gap-2 whitespace-nowrap">
              <Layers size={11} strokeWidth={1.5} /> INDEXED CONVERSATIONS ({filtered.length})
            </p>
            <div className="relative flex-1 md:w-72">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#71717A]" />
              <input 
                type="text" 
                placeholder="Find conversation by Name or ID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-[#050505] border border-[#27272A] text-xs font-mono-ibm text-[#F4F4F5] pl-8 pr-3 py-1.5 outline-none focus:border-[#8B5CF6] transition-colors"
              />
            </div>
          </div>
          <button
            onClick={() => navigate("/index")}
            data-testid="new-index-btn"
            className="px-4 py-2 bg-[#8B5CF6] text-white text-[10px] font-mono-ibm tracking-[0.1em] hover:bg-[#7C3AED] transition-colors duration-200 whitespace-nowrap font-bold"
          >
            + INDEX NEW CONVERSATION
          </button>
        </div>

        {loading ? (
          <div className="p-10 text-center text-[#71717A] text-xs font-mono-ibm">LOADING CONVERSATIONS...</div>
        ) : conversations.length === 0 ? (
          <div className="p-10 text-center" data-testid="empty-state">
            <Layers size={32} strokeWidth={1} className="text-[#27272A] mx-auto mb-3" />
            <p className="text-[#71717A] text-xs font-mono-ibm">No conversations indexed yet</p>
            <button
              onClick={() => navigate("/index")}
              className="mt-4 px-5 py-2 bg-[#8B5CF6] text-white text-xs font-mono-ibm hover:bg-[#7C3AED] transition-colors duration-200 font-bold"
            >
              INDEX FIRST CONVERSATION
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-[#71717A] text-xs font-mono-ibm">
            No conversations matching "{searchQuery}"
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono-ibm">
              <thead>
                <tr className="border-b border-[#27272A] bg-[#050505]/40">
                  {["CONVERSATION ID", "MESSAGES", "TOPICS", "CHUNKS", "RAW TOKENS", "REDUCTION", "ACTIONS"].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[9px] tracking-[0.15em] text-[#71717A]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#18181B]">
                {filtered.map(c => {
                  const s = c.stats || {};
                  const raw = s.estimated_raw_tokens || 0;
                  const red = raw > 0 ? Math.max(0, Math.round((1 - TOKEN_BUDGET / raw) * 100)) : 0;
                  return (
                    <tr key={c.conversation_id} className="hover:bg-[#18181B]/50 transition-colors duration-150">
                      <td className="px-4 py-3 font-bold text-[#F4F4F5]">
                        <div className="flex items-center gap-2">
                          <span className="text-[#8B5CF6]">●</span>
                          <span>{c.conversation_id}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#A1A1AA]">{s.total_messages ?? "—"}</td>
                      <td className="px-4 py-3 text-[#4F46E5] font-semibold">{s.total_topics ?? "—"}</td>
                      <td className="px-4 py-3 text-[#10B981] font-semibold">{s.total_chunks ?? "—"}</td>
                      <td className="px-4 py-3 text-[#A1A1AA]">{raw ? raw.toLocaleString() : "—"}</td>
                      <td className="px-4 py-3 text-[#10B981] font-bold">{red > 0 ? `${red}%` : "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => navigate(`/tree/${c.conversation_id}`)}
                            title="Inspect Hierarchical Tree"
                            className="px-2 py-1 bg-[#27272A] hover:bg-[#8B5CF6] text-[#F4F4F5] text-[10px] transition-colors"
                          >
                            Tree View
                          </button>
                          <button
                            onClick={() => navigate(`/compare/${c.conversation_id}`)}
                            title="Benchmark vs Raw"
                            className="px-2 py-1 bg-[#27272A] hover:bg-[#8B5CF6] text-[#F4F4F5] text-[10px] transition-colors"
                          >
                            Benchmark
                          </button>
                          <button
                            onClick={() => setActiveExportConv(c.conversation_id)}
                            title="Export for ChatGPT / Gemini / Claude"
                            className="px-2 py-1 bg-[#8B5CF6]/20 border border-[#8B5CF6]/40 text-[#8B5CF6] hover:bg-[#8B5CF6] hover:text-white text-[10px] transition-colors flex items-center gap-1 font-bold"
                          >
                            <Share2 size={10} /> Transfer
                          </button>
                          <button
                            onClick={() => handleDelete(c.conversation_id)}
                            title="Delete Index"
                            className="p-1 text-[#71717A] hover:text-[#EF4444] transition-colors ml-1"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
