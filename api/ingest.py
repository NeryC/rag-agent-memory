from http.server import BaseHTTPRequestHandler
import json, os, io, httpx
from pypdf import PdfReader
from openai import OpenAI
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]

CHUNK_TOKENS = 500
OVERLAP_TOKENS = 50


def rough_token_count(text: str) -> int:
    return max(1, len(text) // 4)


def chunk_text(pages: list[tuple[int, str]]) -> list[dict]:
    chunks: list[dict] = []
    buffer = ""
    buffer_page = 1

    for page_num, text in pages:
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        for para in paragraphs:
            if rough_token_count(buffer) + rough_token_count(para) > CHUNK_TOKENS and buffer:
                chunks.append({"content": buffer.strip(), "page_number": buffer_page})
                words = buffer.split()
                overlap_words = max(1, OVERLAP_TOKENS * 4 // 5)
                buffer = " ".join(words[-overlap_words:]) + " " if words else ""
                buffer_page = page_num
            buffer += para + "\n\n"
            if not buffer_page:
                buffer_page = page_num

    if buffer.strip():
        chunks.append({"content": buffer.strip(), "page_number": buffer_page})

    return chunks


def embed_batch(texts: list[str]) -> list[list[float]]:
    client = OpenAI(api_key=OPENAI_API_KEY)
    response = client.embeddings.create(model="text-embedding-3-small", input=texts)
    return [item.embedding for item in response.data]


def process_document(blob_url: str, filename: str, document_id: str, session_id: str) -> None:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    resp = httpx.get(blob_url, follow_redirects=True, timeout=60.0)
    resp.raise_for_status()

    reader = PdfReader(io.BytesIO(resp.content))
    pages = [(i + 1, page.extract_text() or "") for i, page in enumerate(reader.pages)]

    chunks = chunk_text(pages)
    if not chunks:
        supabase.table("documents").update({"status": "error"}).eq("id", document_id).execute()
        return

    texts = [c["content"] for c in chunks]
    all_embeddings: list[list[float]] = []
    for i in range(0, len(texts), 100):
        all_embeddings.extend(embed_batch(texts[i : i + 100]))

    rows = [
        {
            "document_id": document_id,
            "session_id": session_id,
            "content": chunk["content"],
            "embedding": embedding,
            "chunk_index": idx,
            "page_number": chunk["page_number"],
        }
        for idx, (chunk, embedding) in enumerate(zip(chunks, all_embeddings))
    ]
    supabase.table("chunks").insert(rows).execute()
    supabase.table("documents").update({"status": "ready", "chunk_count": len(rows)}).eq("id", document_id).execute()


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            process_document(body["blob_url"], body["filename"], body["document_id"], body["session_id"])
            self._send(200, {"status": "ok"})
        except Exception as e:
            self._send(500, {"error": str(e)})

    def _send(self, code: int, data: dict) -> None:
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        pass
