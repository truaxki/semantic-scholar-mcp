const BASE_URL = 'https://api.semanticscholar.org/graph/v1';

function headers(apiKey: string): Record<string, string> {
  const h: Record<string, string> = { 'Accept': 'application/json' };
  if (apiKey) h['x-api-key'] = apiKey;
  return h;
}

export async function searchPapers(
  apiKey: string,
  query: string,
  opts: { year?: string; limit?: number; openAccessOnly?: boolean } = {}
) {
  const params = new URLSearchParams({
    query,
    fields: 'title,authors,year,citationCount,url,openAccessPdf',
    limit: String(opts.limit || 10),
  });
  if (opts.year) params.set('year', opts.year);
  if (opts.openAccessOnly) params.set('openAccessPdf', '');

  const res = await fetch(`${BASE_URL}/paper/search?${params}`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(`S2 API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function getPaper(apiKey: string, paperId: string, fields: string) {
  const res = await fetch(`${BASE_URL}/paper/${encodeURIComponent(paperId)}?fields=${fields}`, {
    headers: headers(apiKey),
  });
  if (!res.ok) throw new Error(`S2 API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function getAuthors(apiKey: string, paperId: string, limit: number) {
  const res = await fetch(
    `${BASE_URL}/paper/${encodeURIComponent(paperId)}/authors?fields=name,affiliations,citationCount,hIndex&limit=${limit}`,
    { headers: headers(apiKey) }
  );
  if (!res.ok) throw new Error(`S2 API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function getCitations(apiKey: string, paperId: string, limit: number) {
  const res = await fetch(
    `${BASE_URL}/paper/${encodeURIComponent(paperId)}/citations?fields=title,authors,year,citationCount&limit=${limit}`,
    { headers: headers(apiKey) }
  );
  if (!res.ok) throw new Error(`S2 API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function getReferences(apiKey: string, paperId: string, limit: number) {
  const res = await fetch(
    `${BASE_URL}/paper/${encodeURIComponent(paperId)}/references?fields=title,authors,year,citationCount&limit=${limit}`,
    { headers: headers(apiKey) }
  );
  if (!res.ok) throw new Error(`S2 API ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function batchFetchPapers(apiKey: string, paperIds: string[], fields: string) {
  const res = await fetch(`${BASE_URL}/paper/batch?fields=${fields}`, {
    method: 'POST',
    headers: { ...headers(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: paperIds }),
  });
  if (!res.ok) throw new Error(`S2 API ${res.status}: ${await res.text()}`);
  return res.json();
}
