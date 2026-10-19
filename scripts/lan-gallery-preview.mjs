// Public, read-only preview for phones on the same Wi-Fi. No login/payment forwarding.
import http from 'node:http';
import { networkInterfaces } from 'node:os';
const host = process.env.LAN_PREVIEW_HOST;
if (!host || !Object.values(networkInterfaces()).flat().some(a => a?.address === host && !a.internal))
  throw Error('LAN_PREVIEW_HOST must be an address assigned to this computer');
const port = 3001;
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://preview');
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end();
  }
  if (url.pathname === '/api/auth/session') {
    res.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store'});
    return res.end('{}');
  }
  const allowed = url.pathname === '/' || url.pathname === '/photo-credits' ||
    /^\/vehicles\/[a-zA-Z0-9-]+$/.test(url.pathname) ||
    /^\/api\/market(?:\/[a-zA-Z0-9-]+)?$/.test(url.pathname) ||
    ['/samples/', '/_next/', '/images/'].some(prefix => url.pathname.startsWith(prefix)) ||
    ['/favicon.ico','/icon.svg'].includes(url.pathname);
  if (!allowed) { res.writeHead(404); return res.end('Gallery preview: open / to browse vehicles.'); }
  const headers = { ...req.headers, host: 'localhost:3000' };
  delete headers.cookie; delete headers.authorization;
  const upstream = http.request({hostname:'127.0.0.1',port:3000,path:req.url,method:req.method,headers}, response => {
    const responseHeaders = {...response.headers,'cache-control':'no-store'};
    delete responseHeaders['set-cookie'];
    res.writeHead(response.statusCode ?? 502,responseHeaders);
    response.pipe(res);
  });
  upstream.on('error',()=>{ if (!res.headersSent) res.writeHead(502); res.end('Local preview server unavailable.'); });
  upstream.setTimeout(30000,()=>upstream.destroy());
  req.on('aborted',()=>upstream.destroy());
  upstream.end();
});
server.listen(port,host,()=>console.log(`Phone gallery preview: http://${host}:${port}`));
