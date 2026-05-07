'use client'

interface ToolCallIndicatorProps {
  activeTool: string | null
}

const TOOL_LABELS: Record<string, string> = {
  search_documents: 'Searching your documents…',
  search_web: 'Searching the web…',
  save_memory: 'Saving to memory…',
}

export function ToolCallIndicator({ activeTool }: ToolCallIndicatorProps) {
  if (!activeTool) return null
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground px-4 py-2">
      <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
      {TOOL_LABELS[activeTool] ?? `Using ${activeTool}…`}
    </div>
  )
}
