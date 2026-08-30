import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { motion } from "framer-motion";
import { GitBranch, ChevronRight } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// ── Layout algorithm ────────────────────────────────────────────────────────
function layoutTree(treeData) {
  if (!treeData?.nodes || !treeData.root_id) return { positions: {}, svgW: 600, svgH: 460 };
  const { nodes, root_id } = treeData;
  const root = nodes[root_id];
  if (!root) return { positions: {}, svgW: 600, svgH: 460 };

  const PAD = 60, ROOT_Y = 70, TOPIC_Y = 230, CHUNK_Y = 390;
  const TOPIC_MIN_W = 120;

  const topicIds = root.children_ids || [];
  const topicChunks = topicIds.map(tid => nodes[tid]?.children_ids || []);
  
  // Adaptive chunk spacing for large trees
  const totalChunks = topicChunks.reduce((s, c) => s + c.length, 0);
  const CHUNK_SPACING = Math.max(38, Math.min(65, 900 / Math.max(1, totalChunks)));
  
  const topicWidths = topicChunks.map(cks =>
    Math.max(TOPIC_MIN_W, cks.length * CHUNK_SPACING)
  );
  const totalW = topicWidths.reduce((s, w) => s + w + 16, 0) - 16 + PAD * 2;
  const svgW = Math.max(600, totalW);
  const positions = {};

  positions[root_id] = { x: svgW / 2, y: ROOT_Y };

  let xOff = PAD;
  topicIds.forEach((tid, i) => {
    const tw = topicWidths[i];
    const cx = xOff + tw / 2;
    positions[tid] = { x: cx, y: TOPIC_Y };
    const cks = topicChunks[i];
    const startX = xOff + (tw - (Math.max(cks.length - 1, 0)) * CHUNK_SPACING) / 2;
    cks.forEach((cid, ci) => { positions[cid] = { x: startX + ci * CHUNK_SPACING, y: CHUNK_Y }; });
    xOff += tw + 16;
  });

  return { positions, svgW, svgH: CHUNK_Y + 80 };
}

function bezier(x1, y1, x2, y2) {
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

// ── Node colors ─────────────────────────────────────────────────────────────
const NODE_COLORS = { ROOT: "#8B5CF6", TOPIC: "#4F46E5", CHUNK: "#10B981" };
const NODE_R = { ROOT: 28, TOPIC: 20, CHUNK: 13 };

// ── Tree SVG component ──────────────────────────────────────────────────────
function TreeSVG({ treeData, selected, onSelect }) {
  const { positions, svgW, svgH } = layoutTree(treeData);
  const { nodes, root_id } = treeData;
  const root = nodes[root_id];
  if (!root) return null;

  const edges = [];
  (root.children_ids || []).forEach(tid => {
    edges.push({ from: root_id, to: tid });
    const topic = nodes[tid];
    (topic?.children_ids || []).forEach(cid => edges.push({ from: tid, to: cid }));
  });

  return (
    <svg width={svgW} height={svgH} className="overflow-visible">
      {/* Edges */}
      {edges.map(({ from, to }) => {
        const p1 = positions[from], p2 = positions[to];
        if (!p1 || !p2) return null;
        return (
          <path
            key={`${from}-${to}`}
            d={bezier(p1.x, p1.y, p2.x, p2.y)}
            fill="none"
            stroke="#27272A"
            strokeWidth="1.5"
          />
        );
      })}

      {/* Nodes */}
      {Object.entries(positions).map(([nid, { x, y }], i) => {
        const node = nodes[nid];
        if (!node) return null;
        const r = NODE_R[node.level] || 13;
        const color = NODE_COLORS[node.level] || "#8B5CF6";
        const isSel = selected === nid;

        return (
          <motion.g
            key={nid}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: i * 0.04, duration: 0.3, type: "spring", stiffness: 200 }}
            style={{ transformOrigin: `${x}px ${y}px` }}
            onClick={() => onSelect(nid)}
            className="cursor-pointer"
          >
            <circle
              cx={x} cy={y} r={r + (isSel ? 4 : 0)}
              fill={isSel ? color : "#0F0F11"}
              stroke={color}
              strokeWidth={isSel ? 2 : 1.5}
              opacity={isSel ? 1 : 0.9}
            />
            {node.level !== "CHUNK" && (
              <text
                x={x} y={y + 1}
                textAnchor="middle" dominantBaseline="middle"
                fill={isSel ? "#fff" : color}
                fontSize={node.level === "ROOT" ? 10 : 8}
                fontFamily="IBM Plex Mono, monospace"
                fontWeight="700"
              >
                {node.level === "ROOT" ? "ROOT" : node.topic_label?.replace("Topic ", "T") || "T"}
              </text>
            )}
          </motion.g>
        );
      })}
    </svg>
  );
}

export default function TreeView() {
  const { conversationId: paramId } = useParams();
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState(paramId || "");
  const [treeData, setTreeData] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const treeContainerRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    axios.get(`${API}/conversations`).then(r => setConversations(r.data || [])).catch(() => {});
  }, []);

  const loadTree = useCallback(async (id) => {
    if (!id) return;
    setLoading(true); setError(""); setSelectedNode(null);
    try {
      const res = await axios.get(`${API}/tree/${id}`);
      setTreeData(res.data);
    } catch (e) {
      setError(e.response?.data?.detail || "Failed to load tree");
      setTreeData(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (selectedConv) loadTree(selectedConv);
  }, [selectedConv, loadTree]);

  useEffect(() => { if (paramId) setSelectedConv(paramId); }, [paramId]);

  // Auto-scroll to center the ROOT node after tree loads
  useEffect(() => {
    if (!treeData || !treeContainerRef.current) return;
    const { positions } = layoutTree(treeData);
    const rootPos = positions[treeData.root_id];
    if (rootPos) {
      const containerW = treeContainerRef.current.clientWidth;
      treeContainerRef.current.scrollLeft = Math.max(0, rootPos.x - containerW / 2);
    }
  }, [treeData]);

  const selectedNodeData = selectedNode ? treeData?.nodes?.[selectedNode] : null;

  return (
    <div className="p-8 min-h-full" data-testid="tree-view-page">
      <div className="flex items-center gap-4 mb-8">
        <div>
          <h1 className="text-4xl tracking-tighter font-mono-ibm font-bold text-[#F4F4F5]">
            RAPTOR TREE
          </h1>
          <p className="text-sm text-[#71717A] mt-1">Hierarchical memory structure visualization</p>
        </div>
      </div>

      {/* Conversation selector & Transfer Export */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-1">
          <label className="text-[9px] font-mono-ibm tracking-[0.2em] uppercase text-[#71717A] whitespace-nowrap">
            CONVERSATION
          </label>
          <select
            value={selectedConv}
            onChange={e => { setSelectedConv(e.target.value); navigate(`/tree/${e.target.value}`); }}
            data-testid="conv-selector"
            className="flex-1 max-w-sm px-3 py-2 bg-[#0F0F11] border border-[#27272A] text-[#F4F4F5] text-xs font-mono-ibm outline-none focus:border-[#8B5CF6] transition-colors duration-200 cursor-pointer"
          >
            <option value="">Select a conversation...</option>
            {conversations.map(c => (
              <option key={c.conversation_id} value={c.conversation_id}>{c.conversation_id}</option>
            ))}
          </select>
        </div>

        {selectedConv && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/compare/${selectedConv}`)}
              className="px-3 py-1.5 bg-[#27272A] hover:bg-[#3F3F46] text-[#F4F4F5] text-xs font-mono-ibm transition-colors"
            >
              Benchmark vs Raw
            </button>
            <button
              onClick={() => {
                axios.get(`${API}/export/${selectedConv}`).then(r => {
                  if (r.data?.markdown) {
                    navigator.clipboard.writeText(r.data.markdown);
                    alert("Context transfer capsule copied! Paste into ChatGPT, Gemini, or Claude.");
                  }
                });
              }}
              className="px-3 py-1.5 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-mono-ibm font-bold transition-colors"
            >
              📋 Copy Context for Other AIs
            </button>
          </div>
        )}
      </div>

      {/* Legend */}
      {treeData && (
        <div className="flex items-center gap-5 mb-5">
          {[["ROOT", "#8B5CF6"], ["TOPIC", "#4F46E5"], ["CHUNK", "#10B981"]].map(([l, c]) => (
            <div key={l} className="flex items-center gap-1.5 text-[9px] font-mono-ibm tracking-[0.1em] text-[#71717A]">
              <div className="w-2.5 h-2.5 rounded-full border" style={{ borderColor: c, background: "transparent" }} />
              {l}
            </div>
          ))}
          <span className="ml-auto text-[9px] font-mono-ibm text-[#71717A]">
            {treeData.stats?.total_nodes ?? 0} nodes · click to inspect
          </span>
        </div>
      )}

      {/* Main area */}
      <div className="flex gap-4">
        {/* Tree canvas */}
        <div className={`flex-1 bg-[#0F0F11] border border-[#27272A] overflow-auto min-h-[480px] ${selectedNode ? "max-w-[calc(100%-320px)]" : ""}`}
          data-testid="tree-canvas"
          ref={treeContainerRef}>
          {loading && (
            <div className="flex items-center justify-center h-full min-h-[300px]">
              <div className="text-[#71717A] font-mono-ibm text-xs animate-pulse">LOADING TREE...</div>
            </div>
          )}
          {!loading && !treeData && !error && (
            <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-[#71717A]">
              <GitBranch size={40} strokeWidth={0.8} className="mb-4 text-[#27272A]" />
              <p className="text-xs font-mono-ibm">Select a conversation above</p>
            </div>
          )}
          {error && (
            <div className="flex items-center justify-center h-full min-h-[300px] text-[#EF4444] text-xs font-mono-ibm">
              {error}
            </div>
          )}
          {!loading && treeData && (
            <div className="p-6">
              <TreeSVG treeData={treeData} selected={selectedNode} onSelect={setSelectedNode} />
            </div>
          )}
        </div>

        {/* Node detail panel */}
        {selectedNodeData && (
          <motion.aside
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="w-72 flex-shrink-0 bg-[#0F0F11] border border-[#27272A] p-5"
            data-testid="node-detail-panel"
          >
            <div className="flex items-center justify-between mb-4">
              <span
                className="text-[9px] font-mono-ibm tracking-[0.2em] px-2 py-1"
                style={{
                  color: NODE_COLORS[selectedNodeData.level],
                  background: NODE_COLORS[selectedNodeData.level] + "20",
                  border: `1px solid ${NODE_COLORS[selectedNodeData.level]}40`,
                }}
              >
                {selectedNodeData.level}
              </span>
              <button onClick={() => setSelectedNode(null)} className="text-[#71717A] hover:text-[#F4F4F5] text-xs font-mono-ibm">✕</button>
            </div>

            <div className="space-y-3 text-[10px] font-mono-ibm">
              {selectedNodeData.topic_label && (
                <div>
                  <p className="text-[#71717A] tracking-[0.15em]">LABEL</p>
                  <p className="text-[#F4F4F5]">{selectedNodeData.topic_label}</p>
                </div>
              )}
              <div className="flex gap-4">
                <div>
                  <p className="text-[#71717A] tracking-[0.15em]">TOKENS</p>
                  <p className="text-[#F4F4F5]">{selectedNodeData.token_count}</p>
                </div>
                <div>
                  <p className="text-[#71717A] tracking-[0.15em]">LINES</p>
                  <p className="text-[#F4F4F5]">
                    {Array.isArray(selectedNodeData.line_range)
                      ? `${selectedNodeData.line_range[0]}–${selectedNodeData.line_range[1]}`
                      : "--"}
                  </p>
                </div>
              </div>
              {selectedNodeData.children_ids?.length > 0 && (
                <div>
                  <p className="text-[#71717A] tracking-[0.15em]">CHILDREN</p>
                  <p className="text-[#F4F4F5]">{selectedNodeData.children_ids.length} nodes</p>
                </div>
              )}
              <div>
                <p className="text-[#71717A] tracking-[0.15em] mb-2">CONTENT</p>
                <div className="bg-[#050505] border border-[#27272A] p-3 max-h-48 overflow-y-auto text-[#A1A1AA] leading-relaxed whitespace-pre-wrap">
                  {selectedNodeData.text || "—"}
                </div>
              </div>
            </div>

            <button
              onClick={() => navigate(`/query/${selectedConv}`)}
              data-testid="query-from-tree-btn"
              className="mt-4 w-full flex items-center justify-center gap-2 py-2 bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 text-[#8B5CF6] text-[10px] font-mono-ibm tracking-[0.1em] hover:bg-[#8B5CF6]/20 transition-colors duration-200"
            >
              <ChevronRight size={11} /> QUERY THIS CONVERSATION
            </button>
          </motion.aside>
        )}
      </div>
    </div>
  );
}
