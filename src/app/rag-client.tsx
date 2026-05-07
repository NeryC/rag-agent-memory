'use client'
import { useState } from 'react'
import { DocumentUploader } from '@/components/rag/document-uploader'
import { ChatInterface } from '@/components/rag/chat-interface'
import { SourcePanel } from '@/components/rag/source-panel'
import type { Document, Citation } from '@/lib/types'

export function RagClient() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null)

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-72 shrink-0 border-r flex flex-col">
        <div className="p-4 border-b shrink-0">
          <h1 className="font-semibold tracking-tight">RAG Memory Agent</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ask questions about your PDFs · Remembers across sessions
          </p>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <DocumentUploader
            documents={documents}
            onUpload={doc => setDocuments(prev => [...prev, doc])}
          />
        </div>
        <div className="shrink-0 p-3 border-t text-xs text-muted-foreground text-center">
          Demo · Documents deleted in 24h · Don't upload sensitive data
        </div>
      </aside>

      {/* Chat area */}
      <main className="flex-1 min-w-0 overflow-hidden">
        <ChatInterface onCitationClick={setActiveCitation} />
      </main>

      {/* Source panel (slides in when citation clicked) */}
      <SourcePanel citation={activeCitation} onClose={() => setActiveCitation(null)} />
    </div>
  )
}
