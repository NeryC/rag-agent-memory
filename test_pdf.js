const fs = require('fs');
const zlib = require('zlib');

function extractPdfText(buffer) {
  const raw = buffer.toString('latin1');
  const texts = [];

  // Find all objects with their content
  // Streams can be plain or compressed with FlateDecode
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;

  // Get positions of streams to find preceding filter declarations
  let m;
  while ((m = streamRegex.exec(raw)) !== null) {
    const streamStart = m.index;
    const streamData = m[1];

    // Look backwards in the raw PDF for the stream dictionary (within 500 chars)
    const preceding = raw.slice(Math.max(0, streamStart - 500), streamStart);
    const isFlate = preceding.includes('FlateDecode');

    let content: string;
    if (isFlate) {
      try {
        const compressed = Buffer.from(streamData, 'latin1');
        const decompressed = zlib.inflateSync(compressed);
        content = decompressed.toString('latin1');
      } catch {
        continue; // skip if decompression fails
      }
    } else {
      content = streamData;
    }

    if (!content.includes('Tj') && !content.includes('TJ')) continue;

    // Extract text from Tj: (text) Tj
    for (const t of content.matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g)) {
      const s = t[1]
        .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
        .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\');
      if (s.trim()) texts.push(s);
    }

    // Extract text from TJ array: [(text) offset ...] TJ
    for (const t of content.matchAll(/\[([^\]]+)\]\s*TJ/g)) {
      for (const p of t[1].matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g)) {
        const s = p[1].replace(/\\n/g, '\n');
        if (s.trim()) texts.push(s);
      }
    }
  }

  return texts.join(' ').replace(/\s+/g, ' ').trim();
}

const buf = fs.readFileSync('ai-overview-v2.pdf');
const text = extractPdfText(buf);
console.log('Text length:', text.length);
console.log('Text:', JSON.stringify(text.slice(0, 400)));
