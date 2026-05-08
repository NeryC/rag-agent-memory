import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'RAG Memory Agent',
  description: 'Personal knowledge assistant with semantic memory — indexes your PDFs and remembers across sessions',
  openGraph: {
    title: 'RAG Memory Agent',
    description: 'Personal knowledge assistant with semantic memory — indexes your PDFs and remembers across sessions',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'RAG Memory Agent',
    description: 'Personal knowledge assistant with semantic memory — indexes your PDFs and remembers across sessions',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${geist.className} bg-background text-foreground antialiased overflow-hidden`}>
        {children}
      </body>
    </html>
  )
}
