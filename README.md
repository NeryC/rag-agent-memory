# RAG Agent with Memory

Upload PDFs and chat with them. The agent cites specific pages, searches the web when documents don't cover the topic, and remembers facts about you between sessions.

> **Live demo:** [rag-agent-memory.vercel.app](https://rag-agent-memory.vercel.app)  
> **GitHub:** [github.com/NeryC/rag-agent-memory](https://github.com/NeryC/rag-agent-memory)

<!--
![Upload and chat](docs/screenshot-chat.png)
![Citations and memory](docs/screenshot-citations.png)
-->

---

## What does this project do?

This project implements a complete RAG system (Retrieval-Augmented Generation) with persistent memory across sessions. In plain terms:

- **RAG** means the agent answers questions based on real documents you uploaded, not on its training knowledge
- **Memory** means the agent learns facts about you during conversations and recalls them in future sessions

There are four main capabilities:

1. **Upload PDFs** — The system extracts text from the PDF, splits it into ~500-token chunks, and converts them into numeric vectors (embeddings) stored in Supabase
2. **Questions with citations** — When you ask a question, the system finds the most semantically similar chunks and the agent responds citing the source document and page as `[file.pdf p.3]`
3. **Web fallback** — If the documents don't cover the topic, the agent uses Exa to search the internet automatically
4. **Memory across sessions** — After each conversation, a second model (claude-haiku-4.5) extracts durable facts about the user. In the next session, the agent retrieves and uses them without you having to repeat yourself

---

## Step-by-step tutorial

### Step 1: Upload a PDF

1. Open [rag-agent-memory.vercel.app](https://rag-agent-memory.vercel.app)
2. In the left panel, click the upload area or drag a PDF onto it
3. Wait ~2-5 seconds (the time needed for extraction, embedding, and storage)
4. You will see the document with a green ✅ when it is ready

> **Example:** Upload a research paper, a technical manual, or any PDF documentation.

### Step 2: Ask questions about the content

Once the document is processed, type questions in the chat:

```
What is the main conclusion of the paper?
```

```
What algorithm does chapter 3 use?
```

```
Summarize the key points of the methodology section
```

The response will appear with citations like:
```
The paper concludes that attention models with episodic memory mechanisms
outperform standard transformers on long-range reasoning tasks
[research-paper.pdf p.8]. The authors propose an adaptive compression
mechanism that reduces memory usage by 40% [research-paper.pdf p.12].
```

### Step 3: See memory in action

Tell the agent something about yourself:
```
I am a Python developer learning about embeddings for a semantic search project.
```

In future conversations (even after reloading the page), the agent will remember:
- That you are a Python developer
- That your project involves embeddings
- That you are interested in semantic search

This is shown in the UI with a "Memories recalled" panel at the start of the response.

### Step 4: Test the web fallback

Ask something that is not in your documents:
```
What are the latest Claude updates in 2025?
```

The agent will detect that the documents don't cover the topic and will automatically use Exa to search the internet, indicating this in the response.

### Step 5: Upload up to 5 documents

You can upload up to 5 PDFs per session. The agent searches all of them simultaneously and can cite multiple documents in a single response:

```
Where do the two papers on transformers I uploaded agree and differ?
```

### Session management

- **The session lasts 24 hours** — documents and memories are deleted automatically
- **No login required** — the session is managed with an anonymous HttpOnly cookie
- To **reset the session** (clear all documents and start fresh), navigate to `/api/clear-session` in the browser

---

## Demo: full internal walkthrough

### Upload Flow

```
User drags "research.pdf"
         │
         ▼
┌──────────────────────────────────────────────────────────┐
│  document-uploader.tsx                                   │
│  POST /api/upload (FormData with the PDF)                │
└─────────────────────┬────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────┐
│  /api/upload/route.ts                                    │
│                                                          │
│  1. Get/create sessionId from HttpOnly cookie            │
│  2. Check limit: does session have < 5 documents?        │
│  3. Upload PDF to Vercel Blob (private storage)          │
│  4. Create record in 'documents' table (status: proc.)   │
│  5. await processDocument(blob.url, ...)                 │
│     ← SYNCHRONOUS: waits until complete before responding│
│  6. Respond { document_id, status: 'ready' }             │
└─────────────────────┬────────────────────────────────────┘
                      │ (inside processDocument)
                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  lib/ingest.ts — processDocument()                                       │
│                                                                          │
│  1. Download PDF from Vercel Blob                                        │
│  2. extractPdfText(buffer)                                               │
│     a. Read bytes in latin1                                              │
│     b. Find streams with regex: /stream\r?\n([\s\S]*?)\r?\nendstream/g  │
│     c. For each stream, check if the preceding dict says "FlateDecode"  │
│     d. If yes → inflateSync() to decompress (Node built-in zlib)        │
│     e. Extract text from Tj and TJ operators with regex                 │
│     f. Join all extracted text                                           │
│                                                                          │
│  3. chunkText(pages)                                                     │
│     - Split into paragraphs (split on \n\n)                             │
│     - Accumulate up to ~500 tokens (≈2000 chars) per chunk              │
│     - Add 50-token overlap between consecutive chunks                   │
│     → Output: [{ content: "...", pageNumber: 1 }, ...]                  │
│                                                                          │
│  4. embedBatch(texts)                                                    │
│     POST https://api.voyageai.com/v1/embeddings                         │
│     { input: [chunk1, chunk2, ...], model: "voyage-3",                  │
│       input_type: "document" }                                          │
│     → Each chunk → 1024-dimensional vector                              │
│                                                                          │
│  5. INSERT INTO chunks (document_id, session_id, content,               │
│                          embedding, chunk_index, page_number)            │
│     UPDATE documents SET status = 'ready', chunk_count = N              │
└──────────────────────────────────────────────────────────────────────────┘
```

### Chat Flow

```
User types: "What is the main algorithm in the paper?"
         │
         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  chat-interface.tsx                                                      │
│  POST /api/chat { message, conversation_id }                             │
│  Opens EventSource → listens to SSE events                              │
└─────────────────────┬────────────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  /api/chat/route.ts                                                      │
│                                                                          │
│  1. getOrCreateSessionId() from cookie                                   │
│  2. If conversation_id exists, load history from 'conversations'        │
│                                                                          │
│  3. embed(message) — Voyage AI with input_type: "query"                 │
│     → queryEmbedding: number[] of 1024 dims                             │
│                                                                          │
│  4. Promise.all([                                                        │
│       supabase.rpc('match_chunks', {                                     │
│         query_embedding, match_threshold: 0.25, match_count: 5          │
│       }),                                                                │
│       supabase.rpc('match_memories', {                                   │
│         query_embedding, match_threshold: 0.3, match_count: 3           │
│       }),                                                                │
│     ])                                                                   │
│     → chunks: top-5 most semantically similar fragments                 │
│     → memories: top-3 most relevant user memories                      │
│                                                                          │
│  5. buildSystemPrompt(chunks, memories)                                  │
│     "You are a personal assistant. Cite documents as [file p.N]."       │
│     + "## What you remember about the user:\n- Is a Python dev\n- ..."  │
│     + "## Relevant context:\n[paper.pdf p.3] The Adagrad algorithm..."  │
│                                                                          │
│  6. generateText({                                                       │
│       model: claude-sonnet-4.6,                                          │
│       system: buildSystemPrompt,                                         │
│       messages: history + { role: 'user', content: message },           │
│       tools: { search_documents, search_web, save_memory },             │
│       stopWhen: stepCountIs(6),                                          │
│     })                                                                   │
│                                                                          │
│  7. Send text in chunks via SSE (simulated streaming)                   │
│  8. Send { type: 'citations', citations } if citations were found       │
│  9. Save updated conversation to 'conversations'                         │
│  10. extractMemories() in background (does not block the response)      │
└──────────────────────────────────────────────────────────────────────────┘
```

### Memory Extraction Flow

```
After each assistant response (async, does not block the user):
         │
         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  extractMemories(supabase, sessionId, conversationId, userMsg, aiResp)   │
│                                                                          │
│  generateObject({                                                        │
│    model: claude-haiku-4.5,    ← cheaper, sufficient for this task      │
│    schema: z.object({                                                    │
│      facts: z.array(z.object({                                          │
│        content: z.string(),    ← "The user is a Python developer"       │
│        confidence: z.number(), ← 0.0–1.0                               │
│      }))                                                                 │
│    }),                                                                   │
│    prompt: `User: ${userMsg}\nAssistant: ${aiResp}\n                    │
│             Extract durable facts...`                                    │
│  })                                                                      │
│                                                                          │
│  Filter: only facts with confidence > 0.7                               │
│                                                                          │
│  For each fact:                                                          │
│    embed(fact.content)  ← vectorize for future semantic search          │
│    INSERT INTO memories (session_id, content, embedding, confidence)    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Code architecture

### Folder structure

```
rag-agent-memory/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Server shell (imports client components)
│   │   └── api/
│   │       ├── upload/route.ts         # POST — PDF ingestion (extract + embed + store)
│   │       ├── chat/route.ts           # POST — SSE stream with RAG + memory tools
│   │       └── clear-session/route.ts  # GET — expires the session cookie
│   ├── lib/
│   │   ├── ingest.ts                   # PDF extractor + chunker + embedder (no external deps)
│   │   ├── embeddings.ts               # embed() for queries (Voyage AI, input_type:"query")
│   │   ├── supabase.ts                 # createServerClient() — Supabase client
│   │   ├── session.ts                  # getOrCreateSessionId() — HttpOnly cookie
│   │   ├── exa.ts                      # searchWeb() — internet fallback via Exa
│   │   └── types.ts                    # Shared TypeScript types
│   └── components/rag/
│       ├── document-uploader.tsx       # Drag-and-drop PDF uploader
│       └── chat-interface.tsx          # SSE consumer + messages + citations
├── supabase/
│   └── schema.sql                      # Tables, pgvector indexes, RPC functions
└── api/
    └── ingest.py                       # Legacy Python version (replaced by ingest.ts)
```

### File-by-file: what each one does

#### `src/lib/ingest.ts` — The zero-dependency PDF parser

This is the most technical file in the project. Modern PDFs compress their content with zlib (the FlateDecode algorithm). Popular libraries like `pdf-parse` or `pdfjs-dist` require browser APIs (`DOMMatrix`, `canvas`) that do not exist in serverless Node.js. The solution: parse the PDF directly with Node built-ins.

```typescript
import { inflateSync } from 'zlib' // built-in Node.js module — no npm install needed

function extractPdfText(buffer: Buffer): string {
  // Read the PDF as latin1 text (byte-for-byte, no data loss)
  const raw = buffer.toString('latin1')
  const texts: string[] = []

  // A PDF is composed of "streams" — blocks of binary or text data
  // This regex finds every stream in the document
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  let m: RegExpExecArray | null

  while ((m = streamRegex.exec(raw)) !== null) {
    const streamStart = m.index
    const streamData = m[1]  // The raw stream content

    // The dictionary before the stream declares whether it is compressed
    const preceding = raw.slice(Math.max(0, streamStart - 500), streamStart)
    const isFlate = preceding.includes('FlateDecode')  // is it zlib-compressed?

    let content: string
    if (isFlate) {
      try {
        // Decompress using Node's built-in zlib module
        const compressed = Buffer.from(streamData, 'latin1')
        const decompressed = inflateSync(compressed)
        content = decompressed.toString('utf8')
      } catch { continue } // corrupted stream — skip
    } else {
      content = streamData // plain text — use directly
    }

    // Only process streams that contain PDF text operators
    if (!content.includes('Tj') && !content.includes('TJ')) continue

    // Extract text from the Tj operator: (text) Tj
    // PDF uses PostScript notation: text is enclosed in parentheses
    for (const t of content.matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g)) {
      const s = t[1]
        .replace(/\\n/g, '\n')
        .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
      if (s.trim()) texts.push(s)
    }

    // Extract text from the TJ operator: [(text) offset ...] TJ
    // TJ allows kerning adjustments between text fragments
    for (const t of content.matchAll(/\[([^\]]+)\]\s*TJ/g)) {
      for (const p of t[1].matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g)) {
        if (p[1].trim()) texts.push(p[1])
      }
    }
  }

  return texts.join(' ').replace(/\s+/g, ' ').trim()
}
```

**What are Tj and TJ?** They are operators from the PostScript language embedded inside PDFs. `Tj` renders a single string: `(Hello world) Tj`. `TJ` renders an array of strings with spacing adjustments: `[(Hello) 10 (world)] TJ`.

---

#### `src/lib/ingest.ts` — Chunking and embedding

```typescript
function chunkText(pages: { pageNum: number; text: string }[]): { content: string; pageNumber: number }[] {
  const chunks: { content: string; pageNumber: number }[] = []
  let buffer = ''
  let bufferPage = 1

  for (const { pageNum, text } of pages) {
    // Split by paragraphs (\n\n)
    const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean)

    for (const para of paragraphs) {
      // If adding this paragraph would exceed ~500 tokens, flush the current chunk
      if (roughTokenCount(buffer) + roughTokenCount(para) > 500 && buffer) {
        chunks.push({ content: buffer.trim(), pageNumber: bufferPage })

        // OVERLAP: keep the last ~50 tokens of the previous chunk
        // This ensures context at the start of each chunk is not abruptly cut off
        const words = buffer.split(/\s+/)
        const overlapWords = Math.floor((50 * 4) / 5) // ~40 overlap words
        buffer = words.slice(-overlapWords).join(' ') + ' '
        bufferPage = pageNum
      }
      buffer += para + '\n\n'
    }
  }

  if (buffer.trim()) chunks.push({ content: buffer.trim(), pageNumber: bufferPage })
  return chunks
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  // Voyage AI accepts up to 100 texts per request
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: texts,
      model: 'voyage-3',
      input_type: 'document',  // critical: different from 'query' used at search time
    }),
  })
  const data = await res.json()
  return data.data.map((d: { embedding: number[] }) => d.embedding)
  // Each embedding is a vector of 1024 float numbers
}
```

**Why overlap?** Imagine an important concept is described in the last 2 lines of one chunk and the first 2 lines of the next. Without overlap, a semantic search for that concept might retrieve incomplete fragments. With a 50-token overlap, each chunk "shares" context with its neighbors.

---

#### `src/lib/embeddings.ts` — Embeddings for queries

```typescript
export async function embed(text: string): Promise<number[]> {
  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    body: JSON.stringify({
      input: text,
      model: 'voyage-3',
      input_type: 'query',   // intentionally different from 'document'
    }),
  })
  const data = await response.json()
  return data.data[0].embedding  // 1024-dimensional vector
}
```

**Why different `input_type`?** Voyage AI provides two optimized embedding modes:
- `"document"` — optimized for indexing: maximizes semantic information in the content
- `"query"` — optimized for searching: maximizes similarity with relevant documents

Without this distinction, cosine similarity scores were ~0.25 regardless of whether a chunk was relevant or not. With the distinction, relevant chunks score 0.5–0.8 and irrelevant ones fall below the 0.25 threshold.

---

#### `src/app/api/chat/route.ts` — The brain of the system

The `buildSystemPrompt` function dynamically constructs the system prompt for each query:

```typescript
function buildSystemPrompt(chunks: ChunkSearchResult[], memories: MemorySearchResult[]): string {
  let prompt = `You are a personal knowledge assistant. Answer questions based on the user's uploaded documents.
If documents don't cover the topic, use the search_web tool.
Always cite documents as [filename p.N] when quoting or paraphrasing.`

  if (memories.length > 0) {
    // Inject relevant memories at the top of the prompt
    prompt += `\n\n## What you remember about this user:\n`
    prompt += memories.map(m => `- ${m.content}`).join('\n')
  }

  if (chunks.length > 0) {
    // Inject relevant document fragments
    prompt += `\n\n## Relevant context from their documents:\n`
    prompt += chunks.map(c => `[${c.filename} p.${c.page_number}] ${c.content}`).join('\n\n')
  }

  return prompt
}
```

The three tools available to the agent:

```typescript
const tools = {
  // Searches for additional chunks if the automatically retrieved ones are insufficient
  search_documents: tool({
    description: "Search the user's uploaded documents for relevant information",
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      const qEmb = await embed(query)  // vectorize the query
      const { data } = await supabase.rpc('match_chunks', {
        query_embedding: qEmb,
        match_threshold: 0.2,  // lower threshold for active search
        match_count: 5,
        p_session_id: sessionId,
      })
      return results.map(r => `[${r.filename} p.${r.page_number}] ${r.content}`).join('\n\n')
    },
  }),

  // Web fallback when documents don't cover the topic
  search_web: tool({
    description: 'Search the web when document context is insufficient',
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      const results = await searchWeb(query)  // 3 results, 800 chars each
      return results.map(r => `[${r.title}](${r.url})\n${r.snippet}`).join('\n\n')
    },
  }),

  // The agent can proactively save important facts
  save_memory: tool({
    description: 'Save an important fact about the user for future conversations',
    inputSchema: z.object({ fact: z.string() }),
    execute: async ({ fact }) => {
      const emb = await embed(fact)
      await supabase.from('memories').insert({
        session_id: sessionId,
        content: fact,
        embedding: emb,
        confidence: 0.9,  // high confidence when the agent saves it explicitly
      })
      return `Saved memory: "${fact}"`
    },
  }),
}
```

---

#### `supabase/schema.sql` — The database

```sql
-- Enable vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Table for uploaded documents
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  blob_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',  -- 'processing' | 'ready' | 'error'
  chunk_count INT DEFAULT 0,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for text chunks with embeddings (the core of RAG)
CREATE TABLE chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1024),   -- pgvector: 1024-dimensional vector (Voyage AI)
  chunk_index INT NOT NULL,
  page_number INT NOT NULL
);

-- Index for efficient vector search (HNSW = Hierarchical Navigable Small World)
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);

-- Table for user memories
CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1024),   -- vectorized for semantic search
  confidence FLOAT NOT NULL DEFAULT 0.9,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON memories USING hnsw (embedding vector_cosine_ops);

-- RPC for semantic search over chunks
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding VECTOR(1024),
  match_threshold FLOAT,
  match_count INT,
  p_session_id TEXT
)
RETURNS TABLE(id UUID, content TEXT, document_id UUID, filename TEXT, page_number INT, similarity FLOAT)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.content, c.document_id, d.filename, c.page_number,
         1 - (c.embedding <=> query_embedding) AS similarity   -- <=> is cosine distance in pgvector
  FROM chunks c
  JOIN documents d ON c.document_id = d.id
  WHERE c.session_id = p_session_id
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- RPC for semantic search over memories
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding VECTOR(1024),
  match_threshold FLOAT,
  match_count INT,
  p_session_id TEXT
)
RETURNS TABLE(id UUID, content TEXT, confidence FLOAT, similarity FLOAT)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.content, m.confidence,
         1 - (m.embedding <=> query_embedding) AS similarity
  FROM memories m
  WHERE m.session_id = p_session_id
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;
```

**What is pgvector?** It is a PostgreSQL extension that adds a `VECTOR(n)` data type and mathematical operators to compute similarity between vectors. The `<=>` operator computes the cosine distance between two vectors. `1 - cosine distance = cosine similarity`. HNSW indexes make these searches efficient even with millions of vectors.

---

#### `src/lib/session.ts` — Anonymous sessions without login

```typescript
const SESSION_COOKIE = 'rag_session'
const TTL_SECONDS = 24 * 60 * 60  // 24 hours

export async function getOrCreateSessionId(): Promise<string> {
  const cookieStore = await cookies()
  const existing = cookieStore.get(SESSION_COOKIE)
  if (existing?.value) return existing.value  // existing session
  return randomUUID()                          // new session
}

export function sessionCookieOptions() {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,    // client-side JavaScript CANNOT read this cookie
    sameSite: 'lax',  // basic CSRF protection
    maxAge: TTL_SECONDS,
    path: '/',
  }
}
```

Each anonymous user has a UUID as their session ID. All their documents, chunks, and memories are linked to that `session_id`. The cookie is `HttpOnly` to prevent malicious JavaScript from stealing it (XSS protection).

---

### How vector similarity works

When you search for "backpropagation algorithm", here is what happens:

```
1. Your query → Voyage AI → 1024-number vector
   "backpropagation algorithm" → [0.23, -0.45, 0.12, 0.89, ..., -0.33]

2. Each chunk in the database is also a vector:
   "Backpropagation computes gradients..." → [0.21, -0.43, 0.15, 0.87, ..., -0.31]
   "History of neural networks..."         → [-0.12, 0.34, -0.56, 0.23, ..., 0.45]
   "Pasta carbonara recipe..."             → [-0.89, 0.12, 0.78, -0.34, ..., 0.67]

3. pgvector computes cosine similarity between your query and each chunk:
   "Backpropagation computes gradients..." → similarity: 0.82  ← highly relevant
   "History of neural networks..."         → similarity: 0.41  ← somewhat relevant
   "Pasta carbonara recipe..."             → similarity: 0.05  ← irrelevant

4. Only chunks with similarity > 0.25 are retrieved (top 5)
5. Those fragments are injected into the system prompt
```

Cosine similarity measures the angle between two vectors. Vectors pointing in the same direction (same semantic meaning) have similarity close to 1. Perpendicular vectors (different meaning) have similarity close to 0.

---

## Tech stack

| Layer | Technology | Why |
|-------|------------|-----|
| Framework | Next.js 16 App Router | Server Components, Route Handlers, deploy on Vercel |
| AI SDK | Vercel AI SDK v6 | `generateText` with tools, `generateObject` for memory extraction |
| Chat model | `claude-sonnet-4.6` | Best at RAG and following citation instructions |
| Memory model | `claude-haiku-4.5` | Fact extraction is a mechanical task; Haiku is sufficient |
| Gateway | Vercel AI Gateway | Single API key for both models |
| Embeddings | Voyage AI `voyage-3` | 1024 dims, `input_type` document/query differentiation, high quality |
| Vector DB | Supabase pgvector | Vector search with PostgreSQL, HNSW indexes, SQL RPCs |
| Storage | Vercel Blob (private) | Storage for original PDFs with authenticated access |
| Web search | Exa AI | Returns clean text content directly |
| Sessions | HttpOnly Cookie | No login, isolation by session_id, 24h TTL |
| Styling | Tailwind v4 | |
| Deploy | Vercel Hobby | |

---

## Local setup

```bash
git clone https://github.com/NeryC/rag-agent-memory
cd rag-agent-memory
npm install
```

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a project
2. In the dashboard: Database → Extensions → search "vector" → enable it
3. Go to SQL Editor and run the full contents of `supabase/schema.sql`

### 2. Configure environment variables

Create `.env.local`:

```env
AI_GATEWAY_API_KEY=your_vercel_ai_gateway_key
VOYAGE_API_KEY=your_voyage_ai_key
EXA_API_KEY=your_exa_key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
BLOB_READ_WRITE_TOKEN=your_vercel_blob_token
```

| Variable | Where to get it |
|----------|-----------------|
| `AI_GATEWAY_API_KEY` | Vercel dashboard → AI Gateway → API Keys |
| `VOYAGE_API_KEY` | [dash.voyageai.com](https://dash.voyageai.com) |
| `EXA_API_KEY` | [dashboard.exa.ai](https://dashboard.exa.ai) |
| `SUPABASE_URL` | Supabase dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Settings → API → service_role |
| `BLOB_READ_WRITE_TOKEN` | Vercel dashboard → Storage → Blob → your store → Tokens |

### 3. Run

```bash
npm run dev    # → http://localhost:3000
npm test       # → unit tests
```

---

## Technical decisions explained

### Zero-dependency PDF parser (built-in `zlib`)

Popular libraries like `pdf-parse` (which internally uses `pdfjs-dist`) fail on Vercel serverless with the error `DOMMatrix is not defined`. This is because `pdfjs-dist` was designed to run in the browser and uses DOM APIs that do not exist in Node.js.

The solution: write an extractor from scratch using only `zlib` (Node.js built-in) to decompress FlateDecode streams, and regex to extract PDF text operators (`Tj`, `TJ`). No `npm install`, no browser dependencies, works in any Node.js environment.

### Synchronous ingestion (solution to Vercel Hobby's 10s limit)

Vercel's Hobby plan has a hard limit of 10 seconds per serverless function. `maxDuration = 60` in the code is simply ignored. The original solution used `after()` to run ingestion in background, but that also expired.

The solution: run the entire ingestion pipeline (download → extract → chunk → embed → store) synchronously inside the `/api/upload` route handler. For typical 1–10 page PDFs, this completes in 2–5 seconds. The client receives `status: 'ready'` directly in the response.

### Voyage AI `input_type` differentiation

Without specifying `input_type`, cosine similarity scores were ~0.25 for any (query, chunk) pair regardless of actual relevance. With `input_type: "document"` for ingestion and `input_type: "query"` for search, relevant pairs score 0.5–0.8 and irrelevant ones fall below the 0.25 threshold. This one-line change transformed the system from "always returns some random chunk" to "only returns truly relevant chunks".

### Dual memory system

**Short-term memory:** The top-5 most semantically similar chunks are injected into the system prompt for each query. They disappear when the conversation ends.

**Long-term memory:** After each response, `claude-haiku-4.5` analyzes the conversation and extracts durable facts (`confidence > 0.7`). These facts are vectorized and stored in the `memories` table. In the next session, the top-3 memories most relevant to the current query are injected into the prompt — the agent knows who you are without you having to repeat yourself.

### Session isolation without authentication

Each anonymous user receives a session UUID in an HttpOnly cookie. No login, no registration. All documents, chunks, and memories are linked to that `session_id`. A daily cron deletes sessions older than 24 hours. This provides meaningful isolation (users cannot see each other's documents) without any authentication friction.

---

## Limits

| Limit | Value | Reason |
|-------|-------|--------|
| Documents per session | 5 | Protect embedding and storage costs |
| Session duration | 24 hours | Data deleted automatically |
| Chunk size | ~500 tokens | Balance between context and search precision |
| Chunks retrieved | top-5 per query | Keep prompts within budget |
| Memories retrieved | top-3 per query | Avoid "noise" from irrelevant memories |
| Voyage AI rate limit | Free tier (limited RPM) | Demo only |
| Max upload time | 10s | Vercel Hobby hard limit |
