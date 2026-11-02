// Serves the installer from R2; everything else is static assets (see wrangler.jsonc).
const FILE = /^Code-Agent-\d+\.\d+\.\d+-win-x64\.exe$/;

const baseHeaders = {
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
  'content-security-policy': "default-src 'none'; sandbox",
  'referrer-policy': 'no-referrer'
};

const reply = (status, body = '', extra = {}) =>
  new Response(body, { status, headers: { ...baseHeaders, 'content-type': 'text/plain; charset=utf-8', ...extra } });

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!match || (!match[1] && !match[2])) return null;
  let start, end;
  if (!match[1]) { start = Math.max(0, size - Number(match[2])); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
  return start <= end && start < size ? { offset: start, length: end - start + 1 } : 'invalid';
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply(405, 'Method not allowed', { allow: 'GET, HEAD' });

    const url = new URL(request.url);
    let key;
    try { key = decodeURIComponent(url.pathname.replace(/^\/download\//, '')); } catch { return reply(400, 'Bad request'); }
    if (!FILE.test(key)) return reply(404, 'Not found');

    // Per-IP limit on installer downloads. Static pages are unaffected.
    if (env.DOWNLOAD_LIMITER) {
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      const { success } = await env.DOWNLOAD_LIMITER.limit({ key: ip });
      if (!success) return reply(429, 'Too many downloads. Try again in a minute.', { 'retry-after': '60' });
    }

    const head = await env.DOWNLOADS.head(key);
    if (!head) return reply(404, 'Not found');

    const headers = {
      ...baseHeaders,
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${key}"`,
      'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=3600',
      etag: head.httpEtag
    };
    if (request.headers.get('if-none-match') === head.httpEtag) return new Response(null, { status: 304, headers });

    const range = parseRange(request.headers.get('range'), head.size);
    if (range === 'invalid') return reply(416, 'Range not satisfiable', { 'content-range': `bytes */${head.size}` });

    if (request.method === 'HEAD') return new Response(null, { headers: { ...headers, 'content-length': String(head.size) } });

    const object = await env.DOWNLOADS.get(key, range ? { range } : undefined);
    if (!object) return reply(404, 'Not found');
    if (range) {
      return new Response(object.body, { status: 206, headers: { ...headers, 'content-length': String(range.length), 'content-range': `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}` } });
    }
    return new Response(object.body, { headers: { ...headers, 'content-length': String(head.size) } });
  }
};
