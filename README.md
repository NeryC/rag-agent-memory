# RAG Agent with Memory

Upload PDFs and chat with them. The agent cites specific pages, searches the web when documents fall short, and remembers facts about you across sessions.

**Live demo:** https://rag-agent-memory.vercel.app  
**Stack:** Next.js 16 · AI SDK v6 · Vercel AI Gateway · Supabase pgvector · Voyage AI · Vercel Blob · Exa

<!-- ![Upload and chat](docs/screenshot-chat.png) -->
<!-- ![Citations and memory](docs/screenshot-citations.png) -->

---

## What it does

1. **Upload** up to 5 PDF documents — text is extracted, chunked, and embedded instantly
2. **Ask questions** — the agent searches your documents semantically and answers with `[filename p.N]` citations
3. **Web fallback** — if documents don't cover the topic, it searches the web via Exa
4. **Memory** — after each conversation the agent extracts durable facts about you and recalls them in future sessions

---

## Architecture

```
Browser
  ├─ POST /api/upload
  │    ├─ Vercel Blob (private store)  — stores raw PDF
  │    ├─ extractPdfText()             — zlib + regex PDF parser (no deps)
  │    ├─ chunkText()                  — 500-token chunks, 50-token overlap
  │    └─ Voyage AI voyage-3           — embeds chunks → Supabase pgvector
  │
  └─ POST /api/chat  (SSE stream)
       ├─ embed(query)                 — Voyage AI, input_type:"query"
       ├─ match_chunks RPC             — pgvector cosine similarity
       ├─ match_memories RPC          — recall past facts about user
       ├─ generateText (AI SDK v6)    — claude-sonnet-4.6 with 3 tools:
       │    ├─ search_documents        — semantic doc search
       │    ├─ search_web              — Exa web search
       │    └─ save_memory            — persist facts explicitly
       └─ extractMemories()           — claude-haiku-4.5 extracts facts async
```

**Session model:** anonymous sessions via HttpOnly cookie. No login required — documents and memories are scoped to your session and automatically deleted after 24 hours.

---

## File map

```
src/
  app/
    page.tsx                     — server component shell
    api/
      upload/route.ts            — PDF ingest (extract + embed + store)
      chat/route.ts              — SSE chat with RAG + memory tools
      clear-session/route.ts    — reset session cookie (demo utility)
  lib/
    ingest.ts                    — zero-dep PDF parser + Voyage AI embedder
    embeddings.ts                — Voyage AI embed() for queries
    supabase.ts                  — server Supabase client
    session.ts                   — cookie-based anonymous session
    exa.ts                       — Exa web search client
    types.ts                     — shared TypeScript types
  components/
    rag/
      document-uploader.tsx      — drag-and-drop PDF upload
      chat-interface.tsx         — SSE chat consumer

supabase/
  schema.sql                     — pgvector tables, indexes, RPC functions
  
api/
  ingest.py                      — legacy Python handler (superseded by ingest.ts)
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Node.js runtime) |
| AI SDK | Vercel AI SDK v6 (`generateText`, `generateObject`, tool use) |
| Models | `anthropic/claude-sonnet-4.6` (chat), `anthropic/claude-haiku-4.5` (memory extraction) |
| Gateway | Vercel AI Gateway |
| Embeddings | Voyage AI `voyage-3` (1024-dim, `input_type` differentiated) |
| Vector DB | Supabase pgvector with cosine similarity RPC |
| Storage | Vercel Blob (private store) |
| Web search | Exa AI |
| Styling | Tailwind v4 |
| Deploy | Vercel Hobby (Node.js serverless) |

---

## Local setup

```bash
git clone https://github.com/NeryC/rag-agent-memory
cd rag-agent-memory
npm install
```

Create a Supabase project, enable the `vector` extension, and run `supabase/schema.sql`.

Create `.env.local`:

```env
AI_GATEWAY_API_KEY=your_vercel_ai_gateway_key
VOYAGE_API_KEY=your_voyage_ai_key
EXA_API_KEY=your_exa_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
```

```bash
npm run dev    # http://localhost:3000
npm test       # unit tests
```

---

## Technical decisions

**Zero-dependency PDF parser**  
Production PDF libraries (`pdf-parse`, `pdfjs-dist`) require browser APIs (`DOMMatrix`, `canvas`) unavailable in Vercel serverless. Instead, `src/lib/ingest.ts` uses Node.js built-in `zlib.inflateSync` to decompress FlateDecode streams and regex to extract `Tj`/`TJ` text operators — no npm dependency, works on any Node.js environment.

**Synchronous ingest in the upload route**  
Vercel Hobby plan caps serverless functions at 10 seconds. Background jobs via `after()` always timed out before the Python ingest could complete. The fix: run PDF extraction + embedding + Supabase insert synchronously in the upload route itself. For typical PDFs (1–10 pages) this completes in 2–5 seconds and returns `status: "ready"` immediately.

**`input_type` differentiation for Voyage AI**  
Voyage AI `voyage-3` performs significantly better when told whether an input is a `"query"` (for search) or `"document"` (for indexing). Without this, cosine similarity scores are ~0.25 regardless of semantic match. With it, true matches score 0.5–0.8, enabling reliable retrieval at a 0.25 threshold.

**Dual memory systems**  
Short-term context: top-5 matching chunks from pgvector injected into the system prompt. Long-term memory: after each conversation, `claude-haiku-4.5` extracts durable facts (confidence > 0.7) and stores them as embeddings. On the next session, relevant memories are recalled and injected alongside document context — the agent knows your preferences without you re-stating them.

**Session isolation without auth**  
Every anonymous user gets a UUID session ID in an HttpOnly cookie. All documents, chunks, and memories are scoped by `session_id`. A daily cron cleans up sessions older than 24 hours. This provides meaningful isolation with zero friction — no login, no GDPR headaches.

---

## Limits

- **Documents:** 5 per session, PDF only
- **Session lifetime:** 24 hours (auto-deleted by cron)
- **Chunk size:** ~500 tokens with 50-token overlap
- **Retrieval:** top-5 chunks + top-3 memories per query
- **Rate limit:** Voyage AI free tier (limited RPM)
