from http.server import BaseHTTPRequestHandler
import json, os, io, httpx
from pypdf import PdfReader
from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
VOYAGE_API_KEY = os.environ["VOYAGE_API_KEY"]
BLOB_READ_WRITE_TOKEN = os.environ.get("BLOB_READ_WRITE_TOKEN", "")

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
    resp = httpx.post(
        "https://api.voyageai.com/v1/embeddings",
        headers={"Authorization": f"Bearer {VOYAGE_API_KEY}", "Content-Type": "application/json"},
        json={"input": texts, "model": "voyage-3", "input_type": "document"},
        timeout=60.0,
    )
    resp.raise_for_status()
    return [d["embedding"] for d in resp.json()["data"]]


def process_document(blob_url: str, filename: str, document_id: str, session_id: str) -> None:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    headers = {"Authorization": f"Bearer {BLOB_READ_WRITE_TOKEN}"} if BLOB_READ_WRITE_TOKEN else {}
    resp = httpx.get(blob_url, headers=headers, follow_redirects=True, timeout=60.0)
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
        body: dict = {}
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            process_document(body["blob_url"], body["filename"], body["document_id"], body["session_id"])
            self._send(200, {"status": "ok"})
        except Exception as e:
            error_msg = str(e)
            # Mark document as errored so callers don't wait forever
            if body.get("document_id"):
                try:
                    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
                    supabase.table("documents").update({"status": "error"}).eq("id", body["document_id"]).execute()
                except Exception:
                    pass
            self._send(500, {"error": error_msg})

    def _send(self, code: int, data: dict) -> None:
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        pass
