# ConvoMemory — RAPTOR Hierarchical Memory for Claude

ConvoMemory is a RAPTOR (Recursive Abstractive Processing Tree for Organized Retrieval) memory system that lets you index your long Claude conversations and query them intelligently — using far fewer tokens than naive retrieval.

## Features

- 🌳 **RAPTOR Tree Indexing** — Chunks → KMeans clusters → Gemini summaries → ROOT node
- 🔍 **Smart Retrieval** — Token-budget-aware node selection with multi-hop support
- ⚖️ **3-Way Compare** — RAPTOR vs Flat Vector RAG vs Full Raw context
- 📤 **Context Export** — Portable Markdown capsule for cross-model use
- 🧩 **Chrome Extension** — One-click extraction from Claude.ai

## Setup

### Prerequisites
- Python 3.10+
- Node.js 18+
- A free [Gemini API key](https://aistudio.google.com/app/apikey)

### Backend

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate
# Mac/Linux
source venv/bin/activate

pip install -r requirements.txt
```

Create a `.env` file in the `backend/` directory:
```
GEMINI_API_KEY=your_gemini_api_key_here
```

Start the server:
```bash
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

Backend runs at: `http://localhost:8001`

### Frontend

```bash
cd frontend
npm install --legacy-peer-deps
npm start
```

Frontend runs at: `http://localhost:3000`

### Chrome Extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load unpacked** and select the `extension/` folder
4. Visit [claude.ai](https://claude.ai) — the extension injects automatically

## Usage

1. Open the app at `http://localhost:3000`
2. Go to **Settings** and enter your Gemini API key
3. Open any Claude conversation in your browser
4. Click the ConvoMemory extension icon → **Index Conversation**
5. Once indexed, go to **Query** or **Compare** to ask questions
6. Use **Tree View** to visualize the RAPTOR hierarchy

## Architecture

```
Claude.ai → Chrome Extension → FastAPI Backend
                                    │
                              RAPTOR Pipeline
                                    │
                    ┌───────────────┼──────────────────┐
                Chunker        KMeans             Gemini 2.5 Flash
                (tiktoken)    Clusterer            Summarizer
                    │              │                    │
                    └──────────────┴────────────────────┘
                                   │
                              ChromaDB
                          (persistent vector store)
                                   │
                            React Frontend
                   (Dashboard / Query / Compare / Tree)
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Google Gemini API key for summarization & Q&A |
| `MONGO_URL` | No | MongoDB URL (default: mongodb://localhost:27017) |
| `DB_NAME` | No | MongoDB database name (default: test_database) |

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI, Python 3.12, uvicorn |
| Embeddings | sentence-transformers/all-MiniLM-L6-v2 (local) |
| Vector Store | ChromaDB (persistent, local) |
| Clustering | scikit-learn KMeans |
| LLM | Google Gemini 2.5 Flash |
| Frontend | React 19, TailwindCSS, Recharts, Framer Motion |
| Extension | Chrome Manifest V3 |
