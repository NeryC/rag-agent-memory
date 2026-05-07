export async function embed(text: string): Promise<number[]> {
  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: text, model: 'voyage-3' }),
  })
  if (!response.ok) {
    throw new Error(`Voyage AI error: ${response.status}`)
  }
  const data = await response.json()
  return data.data[0].embedding
}
