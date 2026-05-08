# RAG Agent with Memory

Sube PDFs y chatea con ellos. El agente cita páginas específicas, busca en la web cuando los documentos no cubren el tema, y recuerda hechos sobre ti entre sesiones.

> **Demo en vivo:** [rag-agent-memory.vercel.app](https://rag-agent-memory.vercel.app)  
> **GitHub:** [github.com/NeryC/rag-agent-memory](https://github.com/NeryC/rag-agent-memory)

<!--
![Upload and chat](docs/screenshot-chat.png)
![Citations and memory](docs/screenshot-citations.png)
-->

---

## ¿Qué hace este proyecto?

Este proyecto implementa un sistema RAG completo (Retrieval-Augmented Generation) con memoria persistente entre sesiones. En términos simples:

- **RAG** significa que el agente responde preguntas basándose en documentos reales que tú subiste, no en su conocimiento de entrenamiento
- **Memoria** significa que el agente aprende hechos sobre ti durante las conversaciones y los recuerda en sesiones futuras

Hay cuatro capacidades principales:

1. **Subir PDFs** — El sistema extrae el texto del PDF, lo divide en fragmentos de ~500 tokens, y los convierte en vectores numéricos (embeddings) almacenados en Supabase
2. **Preguntas con citas** — Al hacer una pregunta, el sistema encuentra los fragmentos más similares semánticamente y el agente responde citando el documento y página de origen como `[archivo.pdf p.3]`
3. **Fallback a la web** — Si los documentos no cubren el tema, el agente usa Exa para buscar en internet automáticamente
4. **Memoria entre sesiones** — Al terminar cada conversación, un segundo modelo (claude-haiku-4.5) extrae hechos duraderos sobre el usuario. En la próxima sesión, el agente los recupera y los usa sin que tengas que repetirlos

---

## Tutorial paso a paso

### Paso 1: Sube un PDF

1. Abre [rag-agent-memory.vercel.app](https://rag-agent-memory.vercel.app)
2. En el panel izquierdo, haz clic en el área de upload o arrastra un PDF
3. Espera ~2-5 segundos (el tiempo que tarda la extracción, embedding y almacenamiento)
4. Verás el documento con un ✅ verde cuando esté listo

> **Ejemplo:** Sube un paper de investigación, un manual técnico, o cualquier documentación en PDF.

### Paso 2: Haz preguntas sobre el contenido

Una vez procesado el documento, escribe preguntas en el chat:

```
¿Cuál es la conclusión principal del paper?
```

```
¿Qué algoritmo usa el capítulo 3?
```

```
Resume los puntos clave de la sección de metodología
```

La respuesta aparecerá con citas como:
```
El paper concluye que los modelos de atención con mecanismos de memoria episódica
superan a los transformers estándar en tareas de razonamiento a largo plazo
[research-paper.pdf p.8]. Los autores proponen un mecanismo de compresión adaptativa
que reduce el uso de memoria en un 40% [research-paper.pdf p.12].
```

### Paso 3: Observa la memoria en acción

Cuéntale algo al agente:
```
Soy desarrollador de Python y estoy aprendiendo sobre embeddings para un proyecto de búsqueda semántica.
```

En conversaciones futuras (incluso después de recargar la página), el agente recordará:
- Que eres desarrollador de Python
- Que tu proyecto involucra embeddings
- Que te interesa la búsqueda semántica

Esto se muestra en la UI con un panel de "Memorias usadas" al inicio de la respuesta.

### Paso 4: Prueba el fallback a la web

Pregunta algo que no está en tus documentos:
```
¿Cuáles son las últimas novedades de Claude en 2025?
```

El agente detectará que los documentos no cubren el tema y usará automáticamente Exa para buscar en internet, indicándolo en la respuesta.

### Paso 5: Sube hasta 5 documentos

Puedes subir hasta 5 PDFs por sesión. El agente busca en todos simultáneamente y puede citar múltiples documentos en una sola respuesta:

```
¿En qué coinciden y difieren los dos papers sobre transformers que subí?
```

### Gestión de sesión

- **La sesión dura 24 horas** — los documentos y memorias se eliminan automáticamente
- **No hay login** — la sesión se gestiona con una cookie HttpOnly anónima
- Para **resetear la sesión** (limpiar todos los documentos y empezar de cero), ve a `/api/clear-session` en el navegador

---

## Demostración: flujo interno completo

### Flujo de Upload

```
Usuario arrastra "research.pdf"
         │
         ▼
┌──────────────────────────────────────────────────────────┐
│  document-uploader.tsx                                   │
│  POST /api/upload (FormData con el PDF)                  │
└─────────────────────┬────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────┐
│  /api/upload/route.ts                                    │
│                                                          │
│  1. Obtener/crear sessionId desde cookie HttpOnly        │
│  2. Verificar límite: ¿session tiene < 5 documentos?     │
│  3. Subir PDF a Vercel Blob (almacenamiento privado)     │
│  4. Crear registro en tabla 'documents' (status: proc.)  │
│  5. await processDocument(blob.url, ...)                 │
│     ← SINCRÓNICO: espera que termine antes de responder  │
│  6. Responder { document_id, status: 'ready' }           │
└─────────────────────┬────────────────────────────────────┘
                      │ (dentro de processDocument)
                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  lib/ingest.ts — processDocument()                                       │
│                                                                          │
│  1. Descargar PDF desde Vercel Blob                                      │
│  2. extractPdfText(buffer)                                               │
│     a. Leer bytes en latin1                                              │
│     b. Buscar streams con regex: /stream\r?\n([\s\S]*?)\r?\nendstream/g  │
│     c. Para cada stream, verificar si el dict anterior dice "FlateDecode" │
│     d. Si sí → inflateSync() para descomprimir (zlib built-in de Node)  │
│     e. Extraer texto de operadores Tj y TJ con regex                     │
│     f. Unir todo el texto extraído                                       │
│                                                                          │
│  3. chunkText(pages)                                                     │
│     - Dividir en párrafos (split en \n\n)                                │
│     - Acumular hasta ~500 tokens (≈2000 chars) por chunk                 │
│     - Añadir 50 tokens de overlap entre chunks consecutivos              │
│     → Resultado: [{ content: "...", pageNumber: 1 }, ...]                │
│                                                                          │
│  4. embedBatch(texts)                                                    │
│     POST https://api.voyageai.com/v1/embeddings                          │
│     { input: [chunk1, chunk2, ...], model: "voyage-3",                   │
│       input_type: "document" }                                           │
│     → Cada chunk → vector de 1024 dimensiones                            │
│                                                                          │
│  5. INSERT INTO chunks (document_id, session_id, content,               │
│                          embedding, chunk_index, page_number)            │
│     UPDATE documents SET status = 'ready', chunk_count = N              │
└──────────────────────────────────────────────────────────────────────────┘
```

### Flujo de Chat

```
Usuario escribe: "¿Cuál es el algoritmo principal del paper?"
         │
         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  chat-interface.tsx                                                      │
│  POST /api/chat { message, conversation_id }                             │
│  Abre EventSource → escucha eventos SSE                                  │
└─────────────────────┬────────────────────────────────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  /api/chat/route.ts                                                      │
│                                                                          │
│  1. getOrCreateSessionId() desde cookie                                  │
│  2. Si hay conversation_id, cargar historial desde 'conversations'       │
│                                                                          │
│  3. embed(message) — Voyage AI con input_type: "query"                   │
│     → queryEmbedding: número[] de 1024 dims                             │
│                                                                          │
│  4. Promise.all([                                                        │
│       supabase.rpc('match_chunks', {                                     │
│         query_embedding, match_threshold: 0.25, match_count: 5          │
│       }),                                                                │
│       supabase.rpc('match_memories', {                                   │
│         query_embedding, match_threshold: 0.3, match_count: 3           │
│       }),                                                                │
│     ])                                                                   │
│     → chunks: top-5 fragmentos más similares semánticamente              │
│     → memories: top-3 recuerdos más relevantes del usuario              │
│                                                                          │
│  5. buildSystemPrompt(chunks, memories)                                  │
│     "Eres un asistente personal. Cita documentos como [file p.N]."      │
│     + "## Lo que recuerdas del usuario:\n- Es dev de Python\n- ..."     │
│     + "## Contexto relevante:\n[paper.pdf p.3] El algoritmo Adagrad..." │
│                                                                          │
│  6. generateText({                                                       │
│       model: claude-sonnet-4.6,                                          │
│       system: buildSystemPrompt,                                         │
│       messages: historial + { role: 'user', content: message },         │
│       tools: { search_documents, search_web, save_memory },             │
│       stopWhen: stepCountIs(6),                                          │
│     })                                                                   │
│                                                                          │
│  7. Enviar texto en fragmentos vía SSE (streaming simulado)              │
│  8. Enviar { type: 'citations', citations } si encontró citas            │
│  9. Guardar conversación actualizada en 'conversations'                  │
│  10. extractMemories() en background (sin bloquear la respuesta)         │
└──────────────────────────────────────────────────────────────────────────┘
```

### Flujo de Extracción de Memoria

```
Después de cada respuesta del asistente (async, no bloquea al usuario):
         │
         ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  extractMemories(supabase, sessionId, conversationId, userMsg, aiResp)   │
│                                                                          │
│  generateObject({                                                        │
│    model: claude-haiku-4.5,    ← más barato, suficiente para esto       │
│    schema: z.object({                                                    │
│      facts: z.array(z.object({                                          │
│        content: z.string(),    ← "El usuario es desarrollador de Python"│
│        confidence: z.number(), ← 0.0–1.0                               │
│      }))                                                                 │
│    }),                                                                   │
│    prompt: `User: ${userMsg}\nAssistant: ${aiResp}\n                    │
│             Extract durable facts...`                                    │
│  })                                                                      │
│                                                                          │
│  Filtrar: solo facts con confidence > 0.7                               │
│                                                                          │
│  Para cada hecho:                                                        │
│    embed(fact.content)  ← vectorizar para búsqueda semántica futura     │
│    INSERT INTO memories (session_id, content, embedding, confidence)    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Arquitectura del código

### Estructura de carpetas

```
rag-agent-memory/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Shell del servidor (importa client components)
│   │   └── api/
│   │       ├── upload/route.ts         # POST — ingestión de PDF (extract + embed + store)
│   │       ├── chat/route.ts           # POST — SSE stream con RAG + memory tools
│   │       └── clear-session/route.ts  # GET — expira la cookie de sesión
│   ├── lib/
│   │   ├── ingest.ts                   # Extractor PDF + chunker + embedder (sin deps externos)
│   │   ├── embeddings.ts               # embed() para queries (Voyage AI, input_type:"query")
│   │   ├── supabase.ts                 # createServerClient() — cliente de Supabase
│   │   ├── session.ts                  # getOrCreateSessionId() — cookie HttpOnly
│   │   ├── exa.ts                      # searchWeb() — fallback a internet vía Exa
│   │   └── types.ts                    # Tipos TypeScript compartidos
│   └── components/rag/
│       ├── document-uploader.tsx       # Drag-and-drop de PDFs
│       └── chat-interface.tsx          # Consumidor SSE + mensajes + citas
├── supabase/
│   └── schema.sql                      # Tablas, índices pgvector, funciones RPC
└── api/
    └── ingest.py                       # Versión Python legacy (sustituida por ingest.ts)
```

### Archivo por archivo: qué hace cada uno

#### `src/lib/ingest.ts` — El parser PDF sin dependencias externas

Este es el archivo más técnico del proyecto. Los PDFs modernos comprimen su contenido con zlib (algoritmo FlateDecode). Las librerías populares como `pdf-parse` o `pdfjs-dist` requieren APIs del browser (`DOMMatrix`, `canvas`) que no existen en Node.js serverless. La solución: parsear el PDF directamente con herramientas built-in de Node.

```typescript
import { inflateSync } from 'zlib' // ← built-in de Node.js, sin npm install

function extractPdfText(buffer: Buffer): string {
  // Leer el PDF como texto latin1 (byte-a-byte, sin perder datos)
  const raw = buffer.toString('latin1')
  const texts: string[] = []

  // Un PDF está compuesto de "streams" — bloques de datos
  // Esta regex encuentra todos los streams del documento
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  let m: RegExpExecArray | null

  while ((m = streamRegex.exec(raw)) !== null) {
    const streamStart = m.index
    const streamData = m[1]  // El contenido crudo del stream

    // El diccionario antes del stream dice si está comprimido
    const preceding = raw.slice(Math.max(0, streamStart - 500), streamStart)
    const isFlate = preceding.includes('FlateDecode')  // ← ¿está comprimido con zlib?

    let content: string
    if (isFlate) {
      try {
        // Descomprimir con el módulo zlib built-in de Node
        const compressed = Buffer.from(streamData, 'latin1')
        const decompressed = inflateSync(compressed)
        content = decompressed.toString('utf8')
      } catch { continue } // stream corrupto → saltar
    } else {
      content = streamData // texto plano → usar directamente
    }

    // Solo procesar streams que contengan operadores de texto PDF
    if (!content.includes('Tj') && !content.includes('TJ')) continue

    // Extraer texto del operador Tj: (texto) Tj
    // El PDF usa notación PostScript: el texto está entre paréntesis
    for (const t of content.matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g)) {
      const s = t[1]
        .replace(/\\n/g, '\n')
        .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
      if (s.trim()) texts.push(s)
    }

    // Extraer texto del operador TJ: [(texto) offset ...] TJ
    // TJ permite ajustes de kerning entre fragmentos
    for (const t of content.matchAll(/\[([^\]]+)\]\s*TJ/g)) {
      for (const p of t[1].matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g)) {
        if (p[1].trim()) texts.push(p[1])
      }
    }
  }

  return texts.join(' ').replace(/\s+/g, ' ').trim()
}
```

**¿Qué son Tj y TJ?** Son operadores del lenguaje PostScript embebido en los PDFs. `Tj` muestra una cadena de texto: `(Hola mundo) Tj`. `TJ` muestra un array de cadenas con ajustes de espaciado: `[(Hola) 10 (mundo)] TJ`.

---

#### `src/lib/ingest.ts` — Chunking y embedding

```typescript
function chunkText(pages: { pageNum: number; text: string }[]): { content: string; pageNumber: number }[] {
  const chunks: { content: string; pageNumber: number }[] = []
  let buffer = ''
  let bufferPage = 1

  for (const { pageNum, text } of pages) {
    // Dividir por párrafos (\n\n)
    const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean)

    for (const para of paragraphs) {
      // Si añadir este párrafo supera los ~500 tokens, guarda el chunk actual
      if (roughTokenCount(buffer) + roughTokenCount(para) > 500 && buffer) {
        chunks.push({ content: buffer.trim(), pageNumber: bufferPage })

        // OVERLAP: conserva las últimas ~50 tokens del chunk anterior
        // Esto garantiza que el contexto al inicio de cada chunk no esté cortado abruptamente
        const words = buffer.split(/\s+/)
        const overlapWords = Math.floor((50 * 4) / 5) // ≈40 palabras de overlap
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
  // Voyage AI acepta hasta 100 textos por request
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: texts,
      model: 'voyage-3',
      input_type: 'document',  // ← crucial: diferente de 'query' para búsqueda
    }),
  })
  const data = await res.json()
  return data.data.map((d: { embedding: number[] }) => d.embedding)
  // Cada embedding es un vector de 1024 dimensiones (números float)
}
```

**¿Por qué overlap?** Imagina que un concepto importante está descrito en las últimas 2 líneas de un chunk y las primeras 2 del siguiente. Sin overlap, una búsqueda semántica sobre ese concepto podría recuperar fragmentos incompletos. Con overlap de 50 tokens, cada chunk "comparte" contexto con sus vecinos.

---

#### `src/lib/embeddings.ts` — Embeddings para queries

```typescript
export async function embed(text: string): Promise<number[]> {
  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    body: JSON.stringify({
      input: text,
      model: 'voyage-3',
      input_type: 'query',   // ← Diferente de 'document' intencionalmente
    }),
  })
  const data = await response.json()
  return data.data[0].embedding  // Vector de 1024 dimensiones
}
```

**¿Por qué `input_type` diferente?** Voyage AI tiene dos tipos de embeddings optimizados:
- `"document"` — optimizado para indexar: maximiza la información semántica del contenido
- `"query"` — optimizado para buscar: maximiza la similitud con documentos relevantes

Sin esta distinción, los scores de similitud coseno eran ~0.25 independientemente de si el fragmento era relevante o no. Con la distinción, los fragmentos relevantes puntúan 0.5–0.8 y los irrelevantes quedan por debajo del umbral de 0.25.

---

#### `src/app/api/chat/route.ts` — El cerebro del sistema

La función `buildSystemPrompt` construye el prompt del sistema dinámicamente para cada query:

```typescript
function buildSystemPrompt(chunks: ChunkSearchResult[], memories: MemorySearchResult[]): string {
  let prompt = `Eres un asistente personal de conocimiento. Responde basándote en los documentos del usuario.
Si los documentos no cubren el tema, usa la herramienta search_web.
Siempre cita los documentos como [filename p.N] al citar o parafrasear.`

  if (memories.length > 0) {
    // Inyectar memorias relevantes al principio del prompt
    prompt += `\n\n## Lo que recuerdas de este usuario:\n`
    prompt += memories.map(m => `- ${m.content}`).join('\n')
  }

  if (chunks.length > 0) {
    // Inyectar los fragmentos relevantes de los documentos
    prompt += `\n\n## Contexto relevante de sus documentos:\n`
    prompt += chunks.map(c => `[${c.filename} p.${c.page_number}] ${c.content}`).join('\n\n')
  }

  return prompt
}
```

Las tres herramientas disponibles para el agente:

```typescript
const tools = {
  // Busca fragmentos adicionales si los recuperados automáticamente no son suficientes
  search_documents: tool({
    description: "Search the user's uploaded documents for relevant information",
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      const qEmb = await embed(query)  // Vectorizar la query
      const { data } = await supabase.rpc('match_chunks', {
        query_embedding: qEmb,
        match_threshold: 0.2,  // Umbral más bajo para búsqueda activa
        match_count: 5,
        p_session_id: sessionId,
      })
      return results.map(r => `[${r.filename} p.${r.page_number}] ${r.content}`).join('\n\n')
    },
  }),

  // Fallback a internet cuando los documentos no cubren el tema
  search_web: tool({
    description: 'Search the web when document context is insufficient',
    inputSchema: z.object({ query: z.string() }),
    execute: async ({ query }) => {
      const results = await searchWeb(query)  // 3 resultados, 800 chars cada uno
      return results.map(r => `[${r.title}](${r.url})\n${r.snippet}`).join('\n\n')
    },
  }),

  // El agente puede guardar hechos importantes proactivamente
  save_memory: tool({
    description: 'Save an important fact about the user for future conversations',
    inputSchema: z.object({ fact: z.string() }),
    execute: async ({ fact }) => {
      const emb = await embed(fact)
      await supabase.from('memories').insert({
        session_id: sessionId,
        content: fact,
        embedding: emb,
        confidence: 0.9,  // Alta confianza cuando el agente lo guarda explícitamente
      })
      return `Saved memory: "${fact}"`
    },
  }),
}
```

---

#### `supabase/schema.sql` — La base de datos

```sql
-- Habilitar extensión de vectores
CREATE EXTENSION IF NOT EXISTS vector;

-- Tabla de documentos subidos
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  blob_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',  -- 'processing' | 'ready' | 'error'
  chunk_count INT DEFAULT 0,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de fragmentos con embeddings (el corazón del RAG)
CREATE TABLE chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1024),   -- ← pgvector: vector de 1024 dimensiones (Voyage AI)
  chunk_index INT NOT NULL,
  page_number INT NOT NULL
);

-- Índice para búsqueda vectorial eficiente (HNSW = Hierarchical Navigable Small World)
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);

-- Tabla de memorias del usuario
CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1024),   -- vectorizada para búsqueda semántica
  confidence FLOAT NOT NULL DEFAULT 0.9,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON memories USING hnsw (embedding vector_cosine_ops);

-- RPC para búsqueda semántica en chunks
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
         1 - (c.embedding <=> query_embedding) AS similarity   -- <=> es distancia coseno en pgvector
  FROM chunks c
  JOIN documents d ON c.document_id = d.id
  WHERE c.session_id = p_session_id
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

-- RPC para búsqueda semántica en memorias
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

**¿Qué es pgvector?** Es una extensión de PostgreSQL que añade un tipo de dato `VECTOR(n)` y operadores matemáticos para calcular similitud entre vectores. El operador `<=>` calcula la distancia coseno entre dos vectores. `1 - distancia coseno = similitud coseno`. Los índices HNSW permiten hacer estas búsquedas eficientemente incluso con millones de vectores.

---

#### `src/lib/session.ts` — Sesiones anónimas sin login

```typescript
const SESSION_COOKIE = 'rag_session'
const TTL_SECONDS = 24 * 60 * 60  // 24 horas

export async function getOrCreateSessionId(): Promise<string> {
  const cookieStore = await cookies()
  const existing = cookieStore.get(SESSION_COOKIE)
  if (existing?.value) return existing.value  // Sesión existente
  return randomUUID()                          // Nueva sesión
}

export function sessionCookieOptions() {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,    // ← JavaScript del cliente NO puede leer esta cookie
    sameSite: 'lax',  // Protección CSRF básica
    maxAge: TTL_SECONDS,
    path: '/',
  }
}
```

Cada usuario anónimo tiene un UUID como ID de sesión. Todos sus documentos, chunks y memorias están vinculados a ese `session_id`. La cookie es `HttpOnly` para prevenir que JavaScript malicioso la robe (protección XSS).

---

### Cómo funciona la similitud vectorial

Cuando buscas "algoritmo de backpropagation", esto es lo que pasa:

```
1. tu query → Voyage AI → vector de 1024 números
   "algoritmo de backpropagation" → [0.23, -0.45, 0.12, 0.89, ..., -0.33]

2. Cada chunk en la base de datos también es un vector:
   "La retropropagación calcula gradientes..." → [0.21, -0.43, 0.15, 0.87, ..., -0.31]
   "Historia de las redes neuronales..."      → [-0.12, 0.34, -0.56, 0.23, ..., 0.45]
   "Receta de pasta carbonara..."             → [-0.89, 0.12, 0.78, -0.34, ..., 0.67]

3. pgvector calcula la similitud coseno entre tu query y cada chunk:
   "La retropropagación calcula gradientes..." → similitud: 0.82  ← muy relevante
   "Historia de las redes neuronales..."       → similitud: 0.41  ← algo relevante
   "Receta de pasta carbonara..."              → similitud: 0.05  ← irrelevante

4. Solo los chunks con similitud > 0.25 se recuperan (top 5)
5. Esos fragmentos se inyectan en el prompt del sistema
```

La "similitud coseno" mide el ángulo entre dos vectores. Vectores que apuntan en la misma dirección (mismo significado semántico) tienen similitud cercana a 1. Vectores perpendiculares (significado diferente) tienen similitud cercana a 0.

---

## Stack tecnológico

| Capa | Tecnología | ¿Por qué? |
|------|-----------|-----------|
| Framework | Next.js 16 App Router | Server Components, Route Handlers, deploy en Vercel |
| AI SDK | Vercel AI SDK v6 | `generateText` con tools, `generateObject` para extracción de memoria |
| Modelo chat | `claude-sonnet-4.6` | Mejor en RAG y seguimiento de instrucciones de citación |
| Modelo memoria | `claude-haiku-4.5` | Extracción de hechos es tarea mecánica, Haiku es suficiente |
| Gateway | Vercel AI Gateway | Una sola API key para ambos modelos |
| Embeddings | Voyage AI `voyage-3` | 1024 dims, diferenciación `input_type` document/query, alta calidad |
| Vector DB | Supabase pgvector | Búsqueda vectorial con PostgreSQL, índices HNSW, RPCs SQL |
| Storage | Vercel Blob (private) | Almacenamiento de PDFs originales con acceso autenticado |
| Web search | Exa AI | Devuelve texto limpio directamente |
| Sesiones | Cookie HttpOnly | Sin login, aislamiento por session_id, 24h TTL |
| Styling | Tailwind v4 | |
| Deploy | Vercel Hobby | |

---

## Setup local

```bash
git clone https://github.com/NeryC/rag-agent-memory
cd rag-agent-memory
npm install
```

### 1. Crear proyecto en Supabase

1. Ve a [supabase.com](https://supabase.com) → crea un proyecto
2. En el dashboard: Database → Extensions → busca "vector" → actívala
3. Ve a SQL Editor y ejecuta todo el contenido de `supabase/schema.sql`

### 2. Configurar variables de entorno

Crea `.env.local`:

```env
AI_GATEWAY_API_KEY=tu_clave_de_vercel_ai_gateway
VOYAGE_API_KEY=tu_clave_de_voyage_ai
EXA_API_KEY=tu_clave_de_exa
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
BLOB_READ_WRITE_TOKEN=tu_token_de_vercel_blob
```

| Variable | Dónde conseguirla |
|----------|-------------------|
| `AI_GATEWAY_API_KEY` | Vercel dashboard → AI Gateway → API Keys |
| `VOYAGE_API_KEY` | [dash.voyageai.com](https://dash.voyageai.com) |
| `EXA_API_KEY` | [dashboard.exa.ai](https://dashboard.exa.ai) |
| `SUPABASE_URL` | Supabase dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Settings → API → service_role |
| `BLOB_READ_WRITE_TOKEN` | Vercel dashboard → Storage → Blob → tu store → Tokens |

### 3. Ejecutar

```bash
npm run dev    # → http://localhost:3000
npm test       # → unit tests
```

---

## Decisiones técnicas explicadas

### Parser PDF sin dependencias (`zlib` built-in)

Las librerías populares como `pdf-parse` (que usa `pdfjs-dist` internamente) fallan en Vercel serverless con el error `DOMMatrix is not defined`. Esto es porque `pdfjs-dist` fue diseñada para correr en el browser y usa APIs del DOM que no existen en Node.js.

La solución: escribir un extractor desde cero usando únicamente `zlib` (built-in de Node.js) para descomprimir los streams FlateDecode, y regex para extraer los operadores de texto PDF (`Tj`, `TJ`). Sin `npm install`, sin dependencias del browser, funciona en cualquier entorno Node.js.

### Ingestión sincrónica (solución al límite de 10s de Vercel Hobby)

El plan Hobby de Vercel tiene un límite duro de 10 segundos por función serverless. `maxDuration = 60` en el código simplemente se ignora. La solución original usaba `after()` para ejecutar la ingestión en background, pero también expiraba.

La solución: ejecutar toda la ingestión (download → extract → chunk → embed → store) de forma sincrónica dentro del route handler `/api/upload`. Para PDFs típicos de 1-10 páginas, esto completa en 2-5 segundos. El cliente recibe `status: 'ready'` directamente en la respuesta.

### Diferenciación `input_type` de Voyage AI

Sin especificar `input_type`, los scores de similitud coseno eran ~0.25 para cualquier par (query, chunk), independientemente de la relevancia real. Con `input_type: "document"` para ingestión e `input_type: "query"` para búsqueda, los pares relevantes puntúan 0.5-0.8 y los irrelevantes quedan por debajo del umbral de 0.25. Este cambio de una línea transformó el sistema de "siempre devuelve cualquier fragmento" a "solo devuelve fragmentos realmente relevantes".

### Sistema de memoria dual

**Memoria a corto plazo:** Los top-5 chunks más similares semánticamente se inyectan en el prompt del sistema para cada query. Desaparecen cuando termina la conversación.

**Memoria a largo plazo:** Después de cada respuesta, `claude-haiku-4.5` analiza la conversación y extrae hechos duraderos (`confidence > 0.7`). Estos hechos se vectorizan y se guardan en la tabla `memories`. En la próxima sesión, los top-3 recuerdos más relevantes para la query actual se inyectan en el prompt — el agente sabe quién eres sin que tengas que repetírtelo.

### Aislamiento de sesión sin autenticación

Cada usuario anónimo recibe un UUID de sesión en una cookie HttpOnly. No hay login, no hay registro. Todos los documentos, chunks y memorias están vinculados a ese `session_id`. Un cron diario elimina sesiones más antiguas de 24 horas. Esto proporciona aislamiento significativo (usuarios no pueden ver los documentos de otros) sin ninguna fricción de autenticación.

---

## Límites

| Límite | Valor | Razón |
|--------|-------|-------|
| Documentos por sesión | 5 | Proteger costos de embedding y storage |
| Duración de sesión | 24 horas | Datos borrados automáticamente |
| Tamaño de chunk | ~500 tokens | Balance entre contexto y precisión de búsqueda |
| Chunks recuperados | top-5 por query | Mantener prompts dentro del presupuesto |
| Memorias recuperadas | top-3 por query | Evitar "ruido" de memorias irrelevantes |
| Rate limit Voyage AI | Tier gratuito (limitado RPM) | Solo para demo |
| Tiempo máximo upload | 10s | Límite duro de Vercel Hobby |
