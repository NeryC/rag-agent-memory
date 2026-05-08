'use client'
import { useEffect, useState } from 'react'
import { X, FileText, Loader2 } from 'lucide-react'
import type { Citation } from '@/lib/types'

interface SourcePanelProps {
  citation: Citation | null
  onClose: () => void
}

export function SourcePanel({ citation, onClose }: SourcePanelProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Close the panel when the user presses Escape
  useEffect(() => {
    if (!citation) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [citation, onClose])

  useEffect(() => {
    if (!citation) {
      setContent(null)
      return
    }

    let cancelled = false
    setContent(null)
    setLoading(true)

    fetch(`/api/chunk/${citation.chunk_id}`)
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then((data: { content: string }) => {
        if (!cancelled) setContent(data.content)
      })
      .catch(() => {
        if (!cancelled) setContent(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [citation])

  if (!citation) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Source context panel"
      className="fixed inset-y-0 right-0 w-80 bg-background border-l shadow-xl flex flex-col z-50"
    >
      {/* Header: filename + page badge + close button */}
      <div className="flex items-center justify-between px-4 py-3 border-b gap-2">
        <div className="flex items-center gap-2 text-sm font-medium min-w-0">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="truncate">{citation.filename}</span>
          {/* Page badge */}
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground font-normal">
            p.{citation.page_number}
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close source panel"
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content area */}
      <div className="p-4 flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading source…</span>
          </div>
        )}

        {!loading && content && (
          /* Scrollable blockquote with left border accent for the extracted chunk */
          <blockquote
            className="border-l-2 border-blue-500/60 pl-3 text-sm text-foreground/80 leading-relaxed
                       whitespace-pre-wrap overflow-auto max-h-full"
          >
            {content}
          </blockquote>
        )}

        {!loading && !content && (
          <p className="text-xs text-muted-foreground">
            Source text could not be loaded.
          </p>
        )}
      </div>
    </div>
  )
}
