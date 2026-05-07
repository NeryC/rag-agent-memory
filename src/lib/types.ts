export interface Document {
  id: string
  session_id: string
  filename: string
  blob_url: string
  status: 'processing' | 'ready' | 'error'
  chunk_count: number
  uploaded_at: string
  metadata: Record<string, unknown>
}

export interface Chunk {
  id: string
  document_id: string
  session_id: string
  content: string
  chunk_index: number
  page_number: number
}

export interface Memory {
  id: string
  session_id: string
  content: string
  confidence: number
  created_at: string
}

export interface ChunkSearchResult {
  id: string
  content: string
  document_id: string
  filename: string
  page_number: number
  similarity: number
}

export interface MemorySearchResult {
  id: string
  content: string
  confidence: number
  similarity: number
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  citations?: Citation[]
}

export interface Citation {
  document_id: string
  filename: string
  page_number: number
  chunk_id: string
}

export type SSEEvent =
  | { type: 'tool_start'; name: string }
  | { type: 'tool_done'; name: string; result_count?: number }
  | { type: 'text'; content: string }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'memories_used'; memories: { content: string; confidence: number }[] }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'conversation_id'; id: string }