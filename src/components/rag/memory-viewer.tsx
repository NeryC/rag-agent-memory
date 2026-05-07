'use client'
import { useState } from 'react'
import { Brain, ChevronDown, ChevronUp } from 'lucide-react'

interface Memory {
  content: string
  confidence: number
}

interface MemoryViewerProps {
  memories: Memory[]
}

export function MemoryViewer({ memories }: MemoryViewerProps) {
  const [open, setOpen] = useState(false)
  if (memories.length === 0) return null

  return (
    <div className="border rounded-lg bg-muted/30 text-sm mb-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
      >
        <Brain className="h-4 w-4" />
        <span>{memories.length} memor{memories.length !== 1 ? 'ies' : 'y'} recalled</span>
        {open ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
      </button>
      {open && (
        <ul className="px-3 pb-3 space-y-1">
          {memories.map((m, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
              <span className="shrink-0 mt-0.5 text-blue-400">•</span>
              <span className="flex-1">{m.content}</span>
              <span className="ml-auto shrink-0 text-green-400">{Math.round(m.confidence * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
