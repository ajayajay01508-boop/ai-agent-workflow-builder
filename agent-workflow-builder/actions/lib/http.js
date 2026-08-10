// actions/lib/http.js — generic external HTTP call for `http_request` steps.

async function callHttp({ url, method = 'GET', headers = {}, body }) {
  if (!url) throw new Error('http_request step is missing a url');

  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined,
  });

  const contentType = resp.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await resp.json() : await resp.text();

  if (!resp.ok) {
    const err = new Error(`http_request to ${url} failed with status ${resp.status}`);
    err.status = 502;
    throw err;
  }

  return { status: resp.status, data };
}

module.exports = { callHttp };
