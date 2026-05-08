'use client'
import { useState, useCallback, useRef } from 'react'
import { Upload, FileText, CheckCircle, Loader2, AlertCircle } from 'lucide-react'
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
            // Reset value so the same file can be re-selected
            e.target.value = ''
          }
        }}
      />
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={handleClick}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/30 hover:border-primary/50'
        }`}
      >
        {uploading
          ? <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin" />
          : <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
        }
        <p className="mt-2 text-sm text-muted-foreground">
          {uploading ? 'Uploading…' : 'Drop a PDF here or click to browse'}
        </p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Max 5 documents · Deleted after 24h
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {documents.length > 0 && (
        <ul className="space-y-1.5">
          {documents.map(doc => (
            <li key={doc.id} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-muted/40">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-xs">{doc.filename}</span>
              {doc.status === 'processing' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              {doc.status === 'ready' && <CheckCircle className="h-3.5 w-3.5 text-green-500" />}
              {doc.status === 'error' && <AlertCircle className="h-3.5 w-3.5 text-destructive" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
