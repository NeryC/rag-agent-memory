'use client'
import { X, FileText } from 'lucide-react'
import type { Citation } from '@/lib/types'

interface SourcePanelProps {
  citation: Citation | null
  onClose: () => void
}

export function SourcePanel({ citation, onClose }: SourcePanelProps) {
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
        <p className="text-sm font-medium mb-1">Page {citation.page_number}</p>
        <p className="text-xs text-muted-foreground">
          Click any <span className="font-mono text-blue-400">[filename p.N]</span> citation in the chat to preview its source context here.
        </p>
      </div>
    </div>
  )
}
