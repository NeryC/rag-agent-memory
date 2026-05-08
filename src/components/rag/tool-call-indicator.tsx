'use client'
import { BookOpen, Globe, Brain } from 'lucide-react'

interface ToolCallIndicatorProps {
  activeTool: string | null
}

// Icon and descriptive label for each known tool
const TOOL_CONFIG: Record<string, { icon: React.ReactNode; label: string }> = {
  search_documents: {
    icon: <BookOpen className="h-4 w-4" />,
    label: 'Searching through your documents…',
  },
  search_web: {
    icon: <Globe className="h-4 w-4" />,
    label: 'Browsing the web for context…',
  },
  save_memory: {
    icon: <Brain className="h-4 w-4" />,
    label: 'Saving this to long-term memory…',
  },
}

export function ToolCallIndicator({ activeTool }: ToolCallIndicatorProps) {
  if (!activeTool) return null

  const config = TOOL_CONFIG[activeTool]
  const icon = config?.icon ?? null
  const label = config?.label ?? `Using ${activeTool}…`

  return (
    <div className="flex items-center gap-2.5 text-sm text-muted-foreground px-4 py-2">
      {/* Pulsing animated dot to signal activity */}
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
      </span>
      {icon && <span className="text-blue-400">{icon}</span>}
      <span>{label}</span>
    </div>
  )
}
