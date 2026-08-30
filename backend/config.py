import os
from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

def get_api_key() -> str:
    """Returns the active LLM API key (Gemini key or legacy Anthropic key)."""
    return (os.environ.get('GEMINI_API_KEY') or
            os.environ.get('ANTHROPIC_API_KEY') or
            os.environ.get('EMERGENT_LLM_KEY', ''))

# Models — Google Gemini (2.5 Flash)
SUMMARIZATION_MODEL = "gemini-2.5-flash"
QA_MODEL = "gemini-2.5-flash"

# Embeddings (local, no API key needed)
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DIM = 384

# Chunking
CHUNK_MAX_TOKENS = 450

# Clustering
CLUSTER_K_MIN = 3
CLUSTER_K_MAX = 5

# Token budgets
TOKEN_BUDGET_ROOT = 500
TOKEN_BUDGET_SECTION = 1500
TOKEN_BUDGET_CHUNK = 2000
TOKEN_BUDGET_TOTAL = 4000

# Multi-hop keywords
MULTIHOP_KEYWORDS = ["evolve", "over time", "changed", "history", "compare"]

# Retrieval
SIMILARITY_THRESHOLD = 0.4
FALLBACK_MIN_CANDIDATES = 5

# LLM concurrency limit
LLM_MAX_CONCURRENT = 5

# Storage
DATA_DIR = ROOT_DIR / "data"
CHROMA_DIR = str(DATA_DIR / "chroma")
INDEX_STORE_FILE = str(DATA_DIR / "index_store.json")

# Tiktoken
TIKTOKEN_ENCODING = "cl100k_base"
