# OmniRAG — Observable Multi-Modal Research Assistant

A production-grade, hallucination-resistant **Agentic RAG (Retrieval-Augmented Generation)** platform engineered for multi-modal knowledge ingestion, mathematical hybrid retrieval, strict per-user tenant isolation, real-time latency/cost observability, and automated CI/CD evaluation gating.

---

## Core Engineering Differentiators

* **Multi-Modal Ingestion Pipeline (YouTube + PDF Vision):**
  * **YouTube Technical Lectures:** Fault-tolerant 3-tier extraction pipeline (**Direct InnerTube API** $\rightarrow$ **`yt-dlp` multi-client fallback** $\rightarrow$ **Duration-Calibrated Gemini 2.5 Flash**) segmented into 80-second overlapping windows (18s overlap) with exact timestamp preservation.
  * **PDF Research Papers & Slide Decks:** Multi-modal page-by-page extraction of dense text, equations, tables, and visual diagrams via **Gemini 2.5 Flash**, grouped into **$\le 22,000$-token rate-safe batches** to prevent `429 RESOURCE_EXHAUSTED` TPM rate-limit failures on large documents.
* **Strict Multi-Tenant Data Isolation:**
  * Authenticated via **Bcrypt + JWT**. Every vector chunk, Atlas Search query, corpus resource, and telemetry trace is scoped to the active user's `user_id` with a compound unique index on `(user_id, chunk_id)`.
* **Hybrid Retrieval + Reciprocal Rank Fusion (RRF):**
  * Executes **Dense Cosine Vector Search** (`3072`-dimensional `gemini-embedding-001` vectors) and **Lexical BM25 Search** concurrently in MongoDB Atlas, fusing rankings deterministically via RRF ($k = 60$) with automatic exact-KNN/lexical fallback.
* **Cross-Encoder Relevance Gate & Spoken-Filler Compaction:**
  * A batched **Cross-Encoder LLM judge** scores candidate chunks on a `[0.0, 1.0]` relevance scale and filters out anything below `0.50`—eliminating false positives from out-of-scope queries.
  * A deterministic regex compactor strips conversational lecture filler (`"um"`, `"you know"`, `"basically"`) prior to generation to lower **Time-To-First-Token (TTFT)** and prompt token costs.
* **Deterministic `$0.00` Abstention & Verifiable Inline Citations:**
  * **0 Surviving Chunks:** Immediately short-circuits with `is_abstained: true`, `answer: null`, and `$0.00` LLM generation cost.
  * **$\ge 1$ Surviving Chunk:** Streams schema-enforced JSON over **Server-Sent Events (SSE)** with inline `<chunk id="...">` citations mapped to clickable YouTube deep-links (`&t=...s`) and PDF page markers.
* **Real-Time Telemetry & CI/CD LLM-as-a-Judge Gate:**
  * Live **Midnight Emerald** observability sidebar tracking **Avg TTFT**, **Total Tokens**, **Cumulative USD Cost**, **Compaction Tokens Saved**, and **Active APIs**.
  * Automated **GitHub Actions** quality gate (`evals/runEvals.js`) using **Gemini 3.1 Flash-Lite** as an LLM-as-a-Judge against `evals/golden_dataset.json`, blocking merges to `main` if accuracy drops below `100%`.

---

## System Architecture

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                     LANE A: MULTI-MODAL INGESTION & STORE                    │
│                                                                              │
│  [YouTube URL] ──► InnerTube / yt-dlp / Gemini 2.5 Flash (80s Windows) ──┐   │
│                                                                          ├──►│
│  [PDF / Deck]  ──► Gemini 2.5 Flash Vision (≤22k TPM Token Batches)  ────┘   │
│                                      │                                       │
│                                      ▼                                       │
│             gemini-embedding-001 (3072-D) + JWT user_id Stamp                │
│                                      │                                       │
│                                      ▼                                       │
│        MongoDB Atlas (`video_chunks` · Compound Index: user_id + chunk_id)   │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼  Authenticated User Query (JWT)
┌──────────────────────────────────────────────────────────────────────────────┐
│                    LANE B: HYBRID RETRIEVAL & RELEVANCE GATE                 │
│                                                                              │
│   ┌───────────────────────────────┐    ┌────────────────────────────────┐    │
│   │  Atlas $vectorSearch (3072-D) │    │   Atlas $search (Lexical BM25) │    │
│   │    (Pre-filtered by user_id)  │    │    (Pre-filtered by user_id)   │    │
│   └───────────────┬───────────────┘    └───────────────┬────────────────┘    │
│                   └──────────────────┬─────────────────┘                     │
│                                      ▼                                       │
│                  Reciprocal Rank Fusion (RRF, k = 60)                        │
│                                      │                                       │
│                                      ▼                                       │
│          Cross-Encoder Relevance Gate (≥ 0.50) + Token Compactor             │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                        ┌──────────────┴──────────────┐
                        ▼ (0 Chunks)                  ▼ (≥ 1 Chunk)
┌──────────────────────────────────┐  ┌────────────────────────────────────────┐
│   DETERMINISTIC ABSTENTION       │  │   GROUNDED SSE JSON STREAMING          │
│   • is_abstained: true           │  │   • Strict Schema Validation           │
│   • $0.00 Generation Cost        │  │   • Inline <chunk id="..."> Citations  │
└──────────────────────────────────┘  └───────────────────┬────────────────────┘
                                                          │
                                                          ▼
                                      ┌────────────────────────────────────────┐
                                      │  TELEMETRY & CI/CD QUALITY GATE        │
                                      │  • Live TTFT / Token / USD Dashboard   │
                                      │  • GitHub Actions LLM-as-a-Judge Gate  │
                                      └────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 19, Vite, Tailwind CSS (Midnight Emerald UI), Server-Sent Events (SSE) |
| **Backend** | Node.js (ESM), Express, Multer, Bcrypt, JSON Web Tokens (JWT) |
| **Database & Search** | MongoDB Atlas (`$vectorSearch` 3072-D Cosine + `$search` BM25) |
| **AI & Embeddings** | `@google/genai` (`gemini-2.5-flash`, `gemini-3.1-flash-lite`, `gemini-embedding-001`) |
| **Media & DevOps** | `yt-dlp`, `ffmpeg`, Docker, GitHub Actions CI/CD |

---

## Project Structure

```text
OmniRAG - Observable Multi-Modal Research Assistant/
├── .github/
│   └── workflows/
│       └── eval-gate.yml          # Automated GitHub Actions LLM-as-a-Judge gate
├── evals/
│   ├── golden_dataset.json        # Ground-truth factual & adversarial abstention cases
│   └── runEvals.js                # Automated CI/CD evaluation runner
├── omnirag-frontend/              # React + Vite + Tailwind Midnight Emerald UI
│   ├── src/
│   │   ├── components/
│   │   │   ├── ChatWindow.jsx     # Streaming SSE answer & clickable citation renderer
│   │   │   ├── CommandInput.jsx   # Glowing prompt bar
│   │   │   ├── Login.jsx          # Cyber-industrial JWT Sign-In / Register screen
│   │   │   ├── Modals.jsx         # YouTube & PDF multi-modal ingestion modal
│   │   │   ├── TelemetrySidebar.jsx # Live TTFT, token, cost & API status panel
│   │   │   ├── TopNavbar.jsx      # Global header, navigation pill & logout control
│   │   │   └── WorkspaceViews.jsx # Query audit history, corpus manager & animated About diagram
│   │   ├── App.jsx
│   │   └── index.css
│   ├── tailwind.config.js
│   └── vite.config.js
├── src/
│   ├── config/
│   │   └── db.js                  # Singleton MongoDB pool & per-user compound indexes
│   ├── contracts/
│   │   └── schema.js              # Runtime data contracts & Gemini structured output schema
│   ├── generation/
│   │   └── generator.js           # Grounded SSE generator & deterministic abstention path
│   ├── ingestion/
│   │   ├── pdfIngest.js           # Gemini 2.5 Flash vision PDF extractor & token-budget batcher
│   │   └── ytIngest.js            # 3-tier fault-tolerant YouTube transcript & chunker pipeline
│   ├── middleware/
│   │   └── telemetry.js           # Per-request latency, token & USD cost observability logger
│   ├── retrieval/
│   │   ├── compactor.js           # Cross-Encoder relevance judge & spoken-filler compactor
│   │   └── hybridSearch.js        # User-scoped Dense Vector + BM25 search & RRF merger
│   ├── services/
│   │   ├── auth.js                # Bcrypt password hashing & JWT middleware
│   │   └── embedder.js            # Asymmetric RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY embedder
│   └── server.js                  # Express API, SSE stream, auth & resource endpoints
├── Dockerfile
└── package.json
```

---

## Local Setup & Quickstart

### 1. Prerequisites
* **Node.js** `v20+` (or `v22+`)
* **MongoDB Atlas** cluster (M0 Free Tier or higher)
* **Google Gemini API Key** (`GEMINI_API_KEY`)
* *(Optional for local CLI fallback)* `yt-dlp` and `ffmpeg`

### 2. Configure Environment Variables
Create a `.env` file in the root directory:

```env
MONGODB_URI="mongodb+srv://<username>:<password>@<cluster-url>/?retryWrites=true&w=majority"
DB_NAME="omnirag"
COLLECTION_NAME="video_chunks"
GEMINI_API_KEY="your_google_gemini_api_key"
JWT_SECRET="your_strong_random_jwt_secret"
PORT=3000
```

### 3. Install Dependencies
```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd omnirag-frontend
npm install
cd ..
```

### 4. Run the Application
Start the backend API server (Terminal 1):
```bash
node src/server.js
```

Start the Vite frontend dev server (Terminal 2):
```bash
cd omnirag-frontend
npm run dev
```

Open **`http://localhost:5173`**, register an account, click **`+ Ingest`** in the top navigation bar to upload a PDF or YouTube lecture, and start querying in **Chat**.

---

## CLI Utilities & Evaluation Gate

```bash
# Seed mock lecture & verify MongoDB indexes
node src/ingestion/ytIngest.js --mock

# Ingest a YouTube lecture from CLI
node src/ingestion/ytIngest.js "[https://www.youtube.com/watch?v=7xTGNNLPyMI](https://www.youtube.com/watch?v=7xTGNNLPyMI)"

# Ingest a PDF document from CLI
node src/ingestion/pdfIngest.js ./path/to/slides.pdf

# Run the automated LLM-as-a-Judge CI/CD quality gate
node evals/runEvals.js
```

---

## CI/CD & Docker Deployment

1. **GitHub Actions Secrets:** In your GitHub repository, navigate to **Settings $\rightarrow$ Secrets and variables $\rightarrow$ Actions** and add:
   * `MONGODB_URI`
   * `GEMINI_API_KEY`
2. Every push or pull request to `main` automatically runs `.github/workflows/eval-gate.yml` to verify 100% pass accuracy on the golden dataset before deployment.
3. **Docker Build & Run:**
   ```bash
   docker build -t omnirag .
   docker run -p 3000:3000 --env-file .env omnirag
   ```