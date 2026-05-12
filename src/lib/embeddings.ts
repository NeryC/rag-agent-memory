export async function embed(text: string, attempt = 0): Promise<number[]> {
  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: text, model: 'voyage-3', input_type: 'query' }),
  })

  if (response.status === 429 && attempt < 4) {
    const retryAfter = Number(response.headers.get('retry-after') ?? 0)
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(2 ** attempt * 5000, 60000)
    await new Promise(r => setTimeout(r, waitMs))
    return embed(text, attempt + 1)
  }

  if (!response.ok) {
    throw new Error(`Voyage AI error: ${response.status}`)
  }
  const data = await response.json()
  return data.data[0].embedding
}
