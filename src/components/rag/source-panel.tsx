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
    <div className="fixed inset-y-0 right-0 w-80 bg-background border-l shadow-xl flex flex-col z-50">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2 text-sm font-medium truncate">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="truncate">{citation.filename}</span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground shrink-0 ml-2"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-4 flex-1 overflow-auto">
        <p className="text-sm font-medium mb-3">Page {citation.page_number}</p>
        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading source…</span>
          </div>
        )}
        {!loading && content && (
          <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
            {content}
          </p>
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
