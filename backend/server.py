import os
import sys
import asyncio
import logging
import time
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).parent
sys.path.insert(0, str(ROOT_DIR))

from fastapi import FastAPI, APIRouter, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv(ROOT_DIR / ".env")
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Try to import heavy RAPTOR modules (requires ML packages) ──────────────
RAPTOR_READY = False
try:
    from models import IndexRequest, IndexResponse, QueryRequest, QueryResponse
    from ingestion.tree_builder import build_tree
    from ingestion.chunker import count_tokens
    from retrieval.searcher import search_similar_nodes
    from retrieval.node_selector import select_nodes, is_multihop_query, select_multihop
    from retrieval.context_assembler import assemble_context
    from retrieval.qa import answer_question
    from store.vector_store import VectorStore
    import store.index_store as index_store
    from config import get_api_key
    RAPTOR_READY = True
    logger.info("RAPTOR modules loaded successfully")
except ImportError as e:
    logger.warning(f"RAPTOR modules not available yet: {e}")
    # Minimal fallback models
    class IndexRequest(BaseModel):
        conversation_id: str
        messages: list[Any] = []
        options: dict = {}
    class IndexResponse(BaseModel):
        conversation_id: str
        status: str
        stats: dict = {}
    class QueryRequest(BaseModel):
        conversation_id: str
        query: str
        token_budget: int = 4000
        model: str = "gemini-2.0-flash"
    class QueryResponse(BaseModel):
        answer: str
        nodes_used: list = []
        token_counts: dict = {}
        latency_ms: int = 0

# MongoDB (keep existing env)
mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[os.environ.get("DB_NAME", "test_database")]

app = FastAPI(title="ConvoMemory RAPTOR API")
api_router = APIRouter(prefix="/api")

# In-memory indexing status tracker
indexing_status: dict[str, dict] = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    if RAPTOR_READY:
        index_store.load()
        await asyncio.to_thread(VectorStore.get_instance)
    logger.info(f"ConvoMemory backend started (RAPTOR_READY={RAPTOR_READY})")


@app.on_event("shutdown")
async def shutdown():
    mongo_client.close()


# ── Health ──────────────────────────────────────────────────────────────────
@api_router.get("/health")
async def health():
    return {"status": "ok", "raptor_ready": RAPTOR_READY}


# ── Index ───────────────────────────────────────────────────────────────────
async def run_indexing(request: IndexRequest):
    conv_id = request.conversation_id
    try:
        if not get_api_key():
            indexing_status[conv_id] = {
                "status": "error",
                "progress": "No API key. Add GEMINI_API_KEY in Settings.",
            }
            return

        indexing_status[conv_id] = {"status": "indexing", "progress": "Chunking messages..."}
        tree = await build_tree(request.messages, conv_id)

        indexing_status[conv_id]["progress"] = "Storing embeddings in vector DB..."
        nodes_list = []
        for node in tree.nodes.values():
            d = node.model_dump() if hasattr(node, "model_dump") else dict(node)
            nodes_list.append(d)

        vs = VectorStore.get_instance()
        await asyncio.to_thread(vs.upsert_nodes, conv_id, nodes_list)

        index_store.set_tree(conv_id, tree)

        indexing_status[conv_id] = {
            "status": "indexed",
            "progress": "Complete",
            "stats": tree.stats,
        }
        logger.info(f"Indexed {conv_id}: {tree.stats}")

    except Exception as e:
        logger.error(f"Indexing failed for {conv_id}: {e}", exc_info=True)
        indexing_status[conv_id] = {"status": "error", "progress": str(e)}


@api_router.post("/index", response_model=IndexResponse)
async def index_conversation(request: IndexRequest, background_tasks: BackgroundTasks):
    if not RAPTOR_READY:
        raise HTTPException(503, "ML packages not installed yet. Please wait ~1 minute and retry.")
    conv_id = request.conversation_id
    indexing_status[conv_id] = {"status": "indexing", "progress": "Starting..."}
    background_tasks.add_task(run_indexing, request)
    return IndexResponse(conversation_id=conv_id, status="indexing", stats={})


# ── Status ───────────────────────────────────────────────────────────────────
@api_router.get("/status/{conversation_id}")
async def get_status(conversation_id: str):
    if RAPTOR_READY:
        tree = index_store.get(conversation_id)
        if tree:
            return {"status": "indexed", "stats": tree.stats, "progress": "Complete"}
    status = indexing_status.get(conversation_id, {"status": "not_indexed"})
    return status


# ── Query helpers (shared by /query and /compare) ─────────────────────────────
async def _raptor_query(request, tree):
    """Run RAPTOR retrieval + LLM answer. Returns dict."""
    root = tree.nodes.get(tree.root_id)
    if not root:
        raise ValueError("Root node missing")
    root_dict = root.model_dump() if hasattr(root, "model_dump") else dict(root)
    root_dict["similarity"] = 1.0

    if is_multihop_query(request.query):
        raw_candidates = await search_similar_nodes(request.conversation_id, request.query, top_k=15)
        topic_cands = [c for c in raw_candidates if c["level"] in ("SECTION", "TOPIC")]
        matched_ids = [c["node_id"] for c in topic_cands[:3]]
        candidates = raw_candidates + (select_multihop(tree, matched_ids) if matched_ids else [])
    else:
        candidates = await search_similar_nodes(request.conversation_id, request.query, top_k=20)

    selected, is_fallback = select_nodes(candidates, root_dict, request.token_budget)

    enriched = []
    for sel in selected:
        node = tree.nodes.get(sel["node_id"])
        if node:
            d = node.model_dump() if hasattr(node, "model_dump") else dict(node)
            d["similarity"] = sel.get("similarity", 0.0)
            enriched.append(d)
        else:
            enriched.append(sel)

    context_text = assemble_context(enriched)
    answer, latency_ms = await answer_question(request.query, context_text, request.model)
    if is_fallback:
        answer += "\n\n*Note: Limited context found for this query.*"

    context_tokens = count_tokens(context_text)
    answer_tokens = count_tokens(answer)
    estimated_raw = tree.stats.get("estimated_raw_tokens", 0)
    reduction_pct = max(0, int((1 - context_tokens / max(1, estimated_raw)) * 100)) if estimated_raw else 0

    return {
        "answer": answer,
        "nodes_used": [
            {
                "node_id": n["node_id"],
                "level": n["level"],
                "similarity": round(n.get("similarity", 0), 3),
                "token_count": n.get("token_count", 0),
                "line_range": list(n.get("line_range", [0, 0])),
                "topic_label": n.get("topic_label", ""),
            }
            for n in enriched
        ],
        "token_counts": {
            "context_tokens": context_tokens,
            "token_budget": request.token_budget,
            "answer_tokens": answer_tokens,
            "estimated_raw_tokens": estimated_raw,
            "reduction_pct": reduction_pct,
            "latency_ms": latency_ms,
        },
        "latency_ms": latency_ms,
    }


async def _raw_query(request, tree):
    """Run query with ALL raw chunks as context (no RAPTOR retrieval)."""
    chunks = [n for n in tree.nodes.values()
              if (hasattr(n, "level") and n.level == "CHUNK") or
              (isinstance(n, dict) and n.get("level") == "CHUNK")]

    def start_line(c):
        lr = c.line_range if hasattr(c, "line_range") else c.get("line_range", [0, 0])
        return lr[0] if isinstance(lr, (list, tuple)) else 0

    chunks.sort(key=start_line)

    parts = ["=== FULL CONVERSATION (RAW) ===\n"]
    for chunk in chunks:
        text = chunk.text if hasattr(chunk, "text") else chunk.get("text", "")
        lr = chunk.line_range if hasattr(chunk, "line_range") else chunk.get("line_range", [0, 0])
        s, e = (lr[0], lr[1]) if isinstance(lr, (list, tuple)) else (0, 0)
        parts.append(f"[Lines {s}–{e}]\n{text}")

    raw_context = "\n\n".join(parts)

    # Cap at 80K tokens (Claude supports 200K)
    raw_tokens = count_tokens(raw_context)
    if raw_tokens > 80000:
        chars_target = int(len(raw_context) * 80000 / raw_tokens)
        raw_context = raw_context[:chars_target] + "\n\n[... truncated for length ...]"
        raw_tokens = count_tokens(raw_context)

    answer, latency_ms = await answer_question(request.query, raw_context, request.model)
    return {
        "answer": answer,
        "context_tokens": raw_tokens,
        "answer_tokens": count_tokens(answer),
        "latency_ms": latency_ms,
    }


async def _supermemory_query(request, tree):
    """Run Flat Vector RAG (Supermemory approach: retrieves top-K isolated chunks only, zero hierarchical summaries)."""
    raw_candidates = await search_similar_nodes(request.conversation_id, request.query, top_k=20)
    # Supermemory has no ROOT or TOPIC hierarchical summaries — only flat chunks
    chunk_candidates = [c for c in raw_candidates if c.get("level") == "CHUNK"][:5]

    parts = ["=== FLAT CHUNKS (SUPERMEMORY / STANDARD VECTOR RAG) ===\n"]
    for c in chunk_candidates:
        lr = c.get("line_range", (0, 0))
        parts.append(f"[Lines {lr[0]}–{lr[1]}]\n{c.get('text', '')}")

    context_text = "\n\n".join(parts) if chunk_candidates else "No matching chunks found."
    answer, latency_ms = await answer_question(request.query, context_text, request.model)
    context_tokens = count_tokens(context_text)

    return {
        "answer": answer,
        "nodes_used": chunk_candidates,
        "context_tokens": context_tokens,
        "answer_tokens": count_tokens(answer),
        "latency_ms": latency_ms,
    }


# ── Query ────────────────────────────────────────────────────────────────────
@api_router.post("/query", response_model=QueryResponse)
async def query_conversation(request: QueryRequest):
    if not RAPTOR_READY:
        raise HTTPException(503, "ML packages not installed yet.")
    if not get_api_key():
        raise HTTPException(400, "No API key configured. Please paste your free Gemini API key in Settings (http://localhost:3000/settings) to run live queries.")
    tree = index_store.get(request.conversation_id)
    if not tree:
        raise HTTPException(404, f"Conversation '{request.conversation_id}' not indexed")

    try:
        result = await _raptor_query(request, tree)
        return QueryResponse(**result)
    except Exception as e:
        logger.error(f"Query error for {request.conversation_id}: {e}", exc_info=True)
        raise HTTPException(500, f"Query failed: {str(e)}")


# ── Compare: RAPTOR vs Supermemory vs Raw ──────────────────────────────────────
@api_router.post("/compare")
async def compare_query(request: QueryRequest):
    if not RAPTOR_READY:
        raise HTTPException(503, "ML packages not installed yet.")
    if not get_api_key():
        raise HTTPException(400, "No API key configured. Please paste your free Gemini API key in Settings (http://localhost:3000/settings) to run live comparisons.")
    tree = index_store.get(request.conversation_id)
    if not tree:
        raise HTTPException(404, f"Conversation '{request.conversation_id}' not indexed")

    try:
        start = time.time()
        raptor_result, supermemory_result, raw_result = await asyncio.gather(
            _raptor_query(request, tree),
            _supermemory_query(request, tree),
            _raw_query(request, tree),
        )
        total_ms = int((time.time() - start) * 1000)
    except Exception as e:
        logger.error(f"Compare query error for {request.conversation_id}: {e}", exc_info=True)
        raise HTTPException(500, f"Comparison failed: {str(e)}")

    raptor_tc = raptor_result["token_counts"]
    return {
        "raptor": raptor_result,
        "supermemory": supermemory_result,
        "raw": raw_result,
        "summary": {
            "raptor_tokens": raptor_tc["context_tokens"],
            "supermemory_tokens": supermemory_result["context_tokens"],
            "raw_tokens": raw_result["context_tokens"],
            "estimated_full_tokens": raptor_tc["estimated_raw_tokens"],
            "reduction_pct": raptor_tc["reduction_pct"],
            "raptor_latency_ms": raptor_result["latency_ms"],
            "supermemory_latency_ms": supermemory_result["latency_ms"],
            "raw_latency_ms": raw_result["latency_ms"],
            "total_latency_ms": total_ms,
        },
    }


# ── Delete ────────────────────────────────────────────────────────────────────
@api_router.delete("/index/{conversation_id}", status_code=204)
async def delete_index(conversation_id: str):
    if RAPTOR_READY:
        index_store.delete(conversation_id)
        vs = VectorStore.get_instance()
        await asyncio.to_thread(vs.delete_conversation, conversation_id)
    indexing_status.pop(conversation_id, None)
    return None


# ── Tree structure (for dashboard) ────────────────────────────────────────────
@api_router.get("/tree/{conversation_id}")
async def get_tree(conversation_id: str):
    if not RAPTOR_READY:
        raise HTTPException(503, "ML packages not installed yet.")
    tree = index_store.get(conversation_id)
    if not tree:
        raise HTTPException(404, f"Conversation '{conversation_id}' not found")

    nodes_out = {}
    for node_id, node in tree.nodes.items():
        d = node.model_dump() if hasattr(node, "model_dump") else dict(node)
        d.pop("embedding", None)  # Strip large vectors from response
        nodes_out[node_id] = d

    return {
        "conversation_id": tree.conversation_id,
        "root_id": tree.root_id,
        "nodes": nodes_out,
        "stats": tree.stats,
    }


# ── Conversations list ─────────────────────────────────────────────────────────
@api_router.get("/conversations")
async def list_conversations():
    if not RAPTOR_READY:
        return []
    return index_store.get_all_stats()


# ── Context Transfer Export (Cross-Model Portability) ────────────────────────
@api_router.get("/export/{conversation_id}")
async def export_conversation_context(conversation_id: str):
    if not RAPTOR_READY:
        raise HTTPException(503, "ML packages not installed yet.")
    tree = index_store.get(conversation_id)
    if not tree:
        raise HTTPException(404, f"Conversation '{conversation_id}' not found in index store. Please index it first.")

    def get_node_attr(node, attr, default=None):
        if hasattr(node, attr):
            return getattr(node, attr)
        if isinstance(node, dict):
            return node.get(attr, default)
        return default

    root = tree.nodes.get(tree.root_id)
    root_text = get_node_attr(root, "text", "") if root else ""
    root_tokens = get_node_attr(root, "token_count", 400) if root else 400

    topic_nodes = [
        n for n in tree.nodes.values()
        if get_node_attr(n, "level") == "TOPIC"
    ]

    chunk_nodes = [
        n for n in tree.nodes.values()
        if get_node_attr(n, "level") == "CHUNK"
    ]

    raw_tokens = tree.stats.get("estimated_raw_tokens", 0) if tree.stats else 0
    total_msgs = tree.stats.get("total_messages", 0) if tree.stats else len(chunk_nodes) * 2
    reduction_pct = max(0, int((1 - root_tokens / max(1, raw_tokens)) * 100)) if raw_tokens else 89

    # Generate ASCII Tree representation
    ascii_tree = [
        "```",
        f"┌── [ROOT] Global Executive Summary (~{root_tokens} tokens)",
    ]
    for idx, t in enumerate(topic_nodes):
        label = get_node_attr(t, "topic_label", f"Topic {idx+1}")
        children = get_node_attr(t, "children_ids", [])
        is_last_topic = (idx == len(topic_nodes) - 1)
        prefix = "└──" if is_last_topic else "├──"
        ascii_tree.append(f"{prefix} [TOPIC {idx+1}] {label} ({len(children)} chunks)")
    ascii_tree.append("```")

    parts = [
        f"# 🧠 ConvoMemory Hierarchical Capsule: `{conversation_id}`",
        f"> **Compression**: `{raw_tokens:,}` raw tokens ➔ `{root_tokens + sum(get_node_attr(t, 'token_count', 0) for t in topic_nodes):,}` tokens (**{reduction_pct}% token reduction**)",
        f"> **Source**: Claude Conversation ({total_msgs} messages) | **Format**: RAPTOR Tree DAG",
        "",
        "## 🌳 Memory Hierarchy Map",
        "\n".join(ascii_tree),
        "",
        "---",
        "",
        "## 📍 LEVEL 0: GLOBAL ROOT SYNTHESIS",
        root_text,
        "",
        "---",
        "",
        "## 📍 LEVEL 1: TOPIC CLUSTERS (GMM Soft-Clustering)",
    ]

    for idx, t in enumerate(topic_nodes, 1):
        label = get_node_attr(t, "topic_label", f"Topic {idx}")
        text = get_node_attr(t, "text", "")
        token_c = get_node_attr(t, "token_count", 0)
        parts.append(f"### [Topic {idx}] {label} `(~{token_c} tokens)`")
        parts.append(text)
        parts.append("")

    # Add a curated sample of key decisions / concrete evidence from leaf chunks
    if chunk_nodes:
        parts.extend([
            "---",
            "",
            "## 📍 LEVEL 2: KEY GRANULAR EVIDENCE & CONVERSATION CHUNKS",
        ])
        for idx, c in enumerate(chunk_nodes[:4], 1):
            lr = get_node_attr(c, "line_range", [0, 0])
            txt = get_node_attr(c, "text", "")
            parts.append(f"#### [Evidence Chunk {idx}] (Lines {lr[0]}–{lr[1]})")
            parts.append(f"```text\n{txt}\n```")
            parts.append("")

    parts.extend([
        "---",
        "",
        "### 🤖 System Instructions for Target AI (ChatGPT / Gemini / Claude):",
        "1. **Context Awareness**: You have been provided with a complete hierarchical memory capsule of a previous conversation.",
        "2. **Continuous Reasoning**: Use Level 0 for high-level continuity, Level 1 for domain-specific thematic rules, and Level 2 for exact formulas/agreements.",
        "3. **Zero Redundancy**: Do not ask the user to repeat past background. Continue seamlessly from the last state.",
    ])

    markdown_export = "\n".join(parts)
    return {
        "conversation_id": conversation_id,
        "markdown": markdown_export,
        "token_count": root_tokens + sum(get_node_attr(t, "token_count", 0) for t in topic_nodes),
        "raw_tokens": raw_tokens,
        "reduction_pct": reduction_pct,
    }


# ── Settings ──────────────────────────────────────────────────────────────────
class SettingsUpdate(BaseModel):
    api_key: str = ""

@api_router.post("/settings")
async def update_settings(data: SettingsUpdate):
    key = data.api_key.strip()
    env_path = ROOT_DIR / ".env"

    if key:
        os.environ["GEMINI_API_KEY"] = key
    else:
        os.environ.pop("GEMINI_API_KEY", None)

    env_path.parent.mkdir(parents=True, exist_ok=True)
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines()
    else:
        lines = []

    new_lines = []
    found = False
    for line in lines:
        if line.startswith("GEMINI_API_KEY=") or line.startswith("ANTHROPIC_API_KEY="):
            if key:
                new_lines.append(f"GEMINI_API_KEY={key}")
            found = True
        else:
            new_lines.append(line)

    if key and not found:
        new_lines.append(f"GEMINI_API_KEY={key}")

    env_path.write_text("\n".join(new_lines) + ("\n" if new_lines else ""), encoding="utf-8")
    return {"status": "ok"}


@api_router.get("/settings")
async def get_settings():
    key = os.environ.get("GEMINI_API_KEY", "") or os.environ.get("ANTHROPIC_API_KEY", "") or os.environ.get("EMERGENT_LLM_KEY", "")
    has_key = bool(key.strip())
    preview = (key[:8] + "...") if has_key else ""
    return {
        "has_api_key": has_key,
        "key_preview": preview,
        "raptor_ready": RAPTOR_READY,
    }


# ── Legacy status endpoint (keep existing) ────────────────────────────────────
@api_router.get("/")
async def root():
    return {"message": "ConvoMemory RAPTOR API", "raptor_ready": RAPTOR_READY}


app.include_router(api_router)
