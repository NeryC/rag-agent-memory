-- Documents table (one row per uploaded PDF)
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  filename text NOT NULL,
  blob_url text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  chunk_count int DEFAULT 0,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  chunk_index int NOT NULL,
  page_number int NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS chunks_session_idx ON chunks (session_id);
CREATE INDEX IF NOT EXISTS chunks_document_idx ON chunks (document_id);

CREATE TABLE IF NOT EXISTS memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  source_conversation_id uuid,
  confidence float NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memories_embedding_idx ON memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS memories_session_idx ON memories (session_id);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_session_idx ON conversations (session_id);

CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_session_id text
)
RETURNS TABLE (
  id uuid,
  content text,
  document_id uuid,
  filename text,
  page_number int,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT c.id, c.content, c.document_id, d.filename, c.page_number,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM chunks c
  JOIN documents d ON d.id = c.document_id
  WHERE c.session_id = p_session_id
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_session_id text
)
RETURNS TABLE (
  id uuid,
  content text,
  confidence float,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT m.id, m.content, m.confidence,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM memories m
  WHERE m.session_id = p_session_id
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
$$;
