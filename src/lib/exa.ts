import Exa from 'exa-js'

let _exa: Exa | null = null

function getExa() {
  if (!_exa) _exa = new Exa(process.env.EXA_API_KEY!)
  return _exa
}

export async function searchWeb(query: string): Promise<{ url: string; title: string; snippet: string }[]> {
  const result = await getExa().searchAndContents(query, {
    numResults: 3,
    text: { maxCharacters: 800 },
  })
  return result.results.map(r => ({
    url: r.url,
    title: r.title ?? '',
    snippet: r.text ?? '',
  }))
}
