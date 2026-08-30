import { useState, useEffect } from "react";
import axios from "axios";
import { Save, CheckCircle, AlertCircle, Eye, EyeOff, Info, Key, Sparkles, ExternalLink } from "lucide-react";
import { motion } from "framer-motion";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const fetchSettings = () => {
    axios.get(`${API}/settings`).then(r => setSettings(r.data)).catch(() => {});
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setSaving(true); setError(""); setSaved(false);
    try {
      await axios.post(`${API}/settings`, { api_key: apiKey.trim() });
      setSaved(true);
      fetchSettings();
      setApiKey("");
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e.response?.data?.detail || "Failed to save settings");
    } finally { setSaving(false); }
  };

  return (
    <div className="p-8 min-h-full max-w-2xl" data-testid="settings-page">
      <div className="mb-8">
        <h1 className="text-4xl tracking-tighter font-mono-ibm font-bold text-[#F4F4F5]">SETTINGS</h1>
        <p className="text-sm text-[#71717A] mt-1">Configure your ConvoMemory backend and LLM provider</p>
      </div>

      <div className="space-y-5">
        {/* API Key section */}
        <div className="bg-[#0F0F11] border border-[#27272A] p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[9px] font-mono-ibm tracking-[0.2em] uppercase text-[#8B5CF6] font-bold flex items-center gap-1.5">
              <Key size={12} /> GOOGLE GEMINI API KEY (FREE TIER)
            </p>
            <a 
              href="https://aistudio.google.com/apikey" 
              target="_blank" 
              rel="noreferrer"
              className="text-[10px] font-mono-ibm text-[#8B5CF6] hover:underline flex items-center gap-1"
            >
              Get Free Key <ExternalLink size={10} />
            </a>
          </div>

          {settings && (
            <div className="flex items-center gap-2 mb-4 text-[10px] font-mono-ibm" data-testid="api-key-status">
              {settings.has_api_key ? (
                <>
                  <CheckCircle size={12} strokeWidth={1.5} className="text-[#10B981]" />
                  <span className="text-[#10B981] font-bold">API Key Active</span>
                  <span className="text-[#71717A] ml-1">({settings.key_preview})</span>
                </>
              ) : (
                <>
                  <AlertCircle size={12} strokeWidth={1.5} className="text-[#EF4444]" />
                  <span className="text-[#EF4444] font-bold">No API Key Configured</span>
                  <span className="text-[#71717A] ml-1">— Required for live AI comparisons and queries</span>
                </>
              )}
            </div>
          )}

          <div className="relative mb-3">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              data-testid="api-key-input"
              className="w-full px-3 py-2.5 bg-[#050505] border border-[#27272A] text-[#F4F4F5] text-xs font-mono-ibm outline-none focus:border-[#8B5CF6] transition-colors duration-200 pr-10"
              placeholder="Paste your Gemini API key (AIza...)"
              onKeyDown={e => e.key === "Enter" && handleSave()}
            />
            <button
              type="button"
              onClick={() => setShowKey(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-[#F4F4F5] transition-colors duration-200"
            >
              {showKey ? <EyeOff size={13} strokeWidth={1.5} /> : <Eye size={13} strokeWidth={1.5} />}
            </button>
          </div>

          {error && (
            <p className="text-[10px] font-mono-ibm text-[#EF4444] mb-3" data-testid="settings-error">{error}</p>
          )}

          <button
            onClick={handleSave}
            disabled={saving || !apiKey.trim()}
            data-testid="save-api-key-btn"
            className="flex items-center gap-2 px-5 py-2.5 bg-[#8B5CF6] text-white text-xs font-mono-ibm tracking-[0.1em] hover:bg-[#7C3AED] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200 font-bold"
          >
            {saved ? <CheckCircle size={13} strokeWidth={1.5} /> : <Save size={13} strokeWidth={1.5} />}
            {saved ? "SAVED!" : saving ? "SAVING..." : "SAVE GEMINI KEY"}
          </button>
        </div>

        {/* System info */}
        <div className="bg-[#0F0F11] border border-[#27272A] p-6">
          <p className="text-[9px] font-mono-ibm tracking-[0.2em] uppercase text-[#71717A] mb-4">SYSTEM STATUS & MODELS</p>
          <div className="grid grid-cols-2 gap-4 text-[10px] font-mono-ibm">
            {[
              ["RAPTOR ENGINE", settings?.raptor_ready ? "READY (ML Active)" : "LOADING...", settings?.raptor_ready ? "#10B981" : "#F59E0B"],
              ["DEFAULT LLM", "gemini-2.0-flash (Free Tier)", "#8B5CF6"],
              ["SUMMARIZATION MODEL", "gemini-2.0-flash", "#A1A1AA"],
              ["EMBEDDING MODEL", "sentence-transformers/all-MiniLM-L6-v2 (Local 384-d)", "#10B981"],
              ["CLUSTERING ALGO", "Gaussian Mixture Models (GMM) + BIC", "#4F46E5"],
              ["VECTOR DB", "ChromaDB (Persistent Local)", "#10B981"],
            ].map(([k, v, c]) => (
              <div key={k}>
                <p className="text-[#71717A] tracking-[0.1em] mb-0.5">{k}</p>
                <p style={{ color: c || "#F4F4F5" }} className="font-semibold">{v}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Free tier notice */}
        <div className="flex gap-3 px-4 py-3 bg-[#8B5CF6]/5 border border-[#8B5CF6]/20 text-[10px] font-mono-ibm text-[#A1A1AA]">
          <Sparkles size={14} strokeWidth={1.5} className="text-[#8B5CF6] flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-[#F4F4F5] font-bold">100% Free Gemini API Support:</p>
            <p>ConvoMemory uses Google's official <span className="text-[#8B5CF6]">gemini-2.0-flash</span> model with generous free quotas (15 requests per minute, 1,500 requests per day) with zero credit card required.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
