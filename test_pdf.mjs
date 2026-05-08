import { readFileSync } from 'fs';
import { inflateSync } from 'zlib';

function extractPdfText(buffer) {
  const raw = buffer.toString('latin1');
  const texts = [];

  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;

  let m;
  while ((m = streamRegex.exec(raw)) !== null) {
    const streamStart = m.index;
    const streamData = m[1];

    const preceding = raw.slice(Math.max(0, streamStart - 500), streamStart);
    const isFlate = preceding.includes('FlateDecode');

    let content;
    if (isFlate) {
      try {
        const compressed = Buffer.from(streamData, 'latin1');
        const decompressed = inflateSync(compressed);
        content = decompressed.toString('utf8');
      } catch {
        continue;
      }
    } else {
      content = streamData;
    }

    if (!content.includes('Tj') && !content.includes('TJ')) continue;

    for (const t of content.matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g)) {
      const s = t[1]
        .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
        .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\');
      if (s.trim()) texts.push(s);
    }

    for (const t of content.matchAll(/\[([^\]]+)\]\s*TJ/g)) {
      for (const p of t[1].matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g)) {
        const s = p[1].replace(/\\n/g, '\n');
        if (s.trim()) texts.push(s);
      }
    }
  }

  return texts.join(' ').replace(/\s+/g, ' ').trim();
}

const buf = readFileSync('ai-overview-v2.pdf');
const text = extractPdfText(buf);
console.log('Text length:', text.length);
console.log('Text:', JSON.stringify(text.slice(0, 400)));
