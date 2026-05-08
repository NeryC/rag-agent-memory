'use client'
import { useState, useEffect } from 'react'
import { Menu, X } from 'lucide-react'
import { DocumentUploader } from '@/components/rag/document-uploader'
import { ChatInterface } from '@/components/rag/chat-interface'
import { SourcePanel } from '@/components/rag/source-panel'
import type { Document, Citation } from '@/lib/types'

export function RagClient() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null)
  // Sidebar is open by default on desktop, closed on mobile
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // On mount, open the sidebar if the viewport is at least the md breakpoint (768px)
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)')
    setSidebarOpen(mql.matches)
    const handler = (e: MediaQueryListEvent) => setSidebarOpen(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile backdrop overlay — shown when sidebar is open on small screens */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — fixed on mobile, static on desktop */}
      <aside
        className={`
          shrink-0 border-r flex flex-col bg-background
          fixed inset-y-0 left-0 z-40 w-72 transition-transform duration-300
          md:static md:translate-x-0 md:z-auto
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
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
          Demo · Documents deleted in 24h · Don&apos;t upload sensitive data
        </div>
      </aside>

      {/* Chat area — full width on mobile when sidebar is closed */}
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {/* Mobile header row with hamburger button */}
        <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b shrink-0">
          <button
            onClick={() => setSidebarOpen(o => !o)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <span className="text-sm font-medium">RAG Memory Agent</span>
        </div>

        <ChatInterface onCitationClick={setActiveCitation} />
      </main>

      {/* Source panel (slides in from right when a citation is clicked) */}
      <SourcePanel citation={activeCitation} onClose={() => setActiveCitation(null)} />
    </div>
  )
}
