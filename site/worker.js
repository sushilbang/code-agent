// Serves the installer from R2; everything else is static assets.
export default {
  async fetch(request, env) {
    const key = decodeURIComponent(new URL(request.url).pathname.replace(/^\/download\//, ''));
    if (!/^Code-Agent-[\d.]+-win-x64\.exe$/.test(key)) return new Response('Not found', { status: 404 });
    const object = await env.DOWNLOADS.get(key);
    if (!object) return new Response('Not found', { status: 404 });
    return new Response(object.body, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(object.size),
        'content-disposition': `attachment; filename="${key}"`,
        'cache-control': 'public, max-age=3600',
        etag: object.httpEtag
      }
    });
  }
};
