'use client'
import { useState, useCallback, useRef } from 'react'
import { Upload, FileText, CheckCircle, Loader2, AlertCircle, Files } from 'lucide-react'
import type { Document } from '@/lib/types'

interface DocumentUploaderProps {
  documents: Document[]
  onUpload: (doc: Document) => void
}

export function DocumentUploader({ documents, onUpload }: DocumentUploaderProps) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are supported')
      return
    }
    setError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')
      onUpload({
        id: data.document_id,
        filename: file.name,
        status: data.status ?? 'processing',
        chunk_count: data.chunk_count ?? 0,
        uploaded_at: new Date().toISOString(),
        blob_url: '',
        session_id: '',
        metadata: {},
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [onUpload])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
        <Files className="h-4 w-4 text-muted-foreground" />
        <span>Your Documents</span>
      </div>

      {/* Hidden file input — triggered programmatically via ref */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) {
            handleFile(file)
            // Reset so the same file can be re-selected
            e.target.value = ''
          }
        }}
      />

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={handleClick}
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/20'
        }`}
      >
        {uploading ? (
          <>
            <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin" />
            <p className="mt-2 text-sm text-muted-foreground">Uploading…</p>
          </>
        ) : (
          <>
            <Upload className={`h-8 w-8 mx-auto transition-colors ${dragging ? 'text-primary' : 'text-muted-foreground'}`} />
            <p className="mt-2 text-sm font-medium text-muted-foreground">
              {dragging ? 'Drop your PDF here' : 'Drop a PDF or click to browse'}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Up to 5 documents · Auto-deleted after 24 h
            </p>
          </>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Document list — new items animate in via CSS transition on opacity/transform */}
      {documents.length > 0 && (
        <ul className="space-y-1.5">
          {documents.map(doc => (
            <li
              key={doc.id}
              className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg
                         transition-colors duration-300 ease-out
                         ${doc.status === 'processing' ? 'skeleton border border-white/5' : 'bg-muted/40'}`}
              style={{
                // Use shimmer for processing rows; slide-in for ready/error rows
                animation: doc.status === 'processing'
                  ? 'shimmer 1.5s ease-in-out infinite'
                  : 'doc-slide-in 0.25s ease-out',
              }}
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-xs">{doc.filename}</span>

              {/* Chunk count badge — shown once the document is ready */}
              {doc.status === 'ready' && doc.chunk_count > 0 && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {doc.chunk_count} chunk{doc.chunk_count !== 1 ? 's' : ''}
                </span>
              )}

              {doc.status === 'processing' && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
              {doc.status === 'ready' && <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-500" />}
              {doc.status === 'error' && <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
