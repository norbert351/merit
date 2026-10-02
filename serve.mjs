// Zero-dep static server for the Merit hire-then-settle UI.
// Serves /public on a port; reads via MERIT_PORT env or 8120.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = join(process.cwd(), "public");
const MIME = {
  ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8",
  ".js":"text/javascript; charset=utf-8", ".mjs":"text/javascript",
  ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg", ".webp":"image/webp",
  ".json":"application/json", ".md":"text/plain; charset=utf-8", ".ico":"image/x-icon",
};
const PORT = process.env.MERIT_PORT || 8120;

createServer((req,res)=>{
  const url = new URL(req.url, `http://${req.headers.host}`);
  let p = decodeURIComponent(url.pathname);
  if(p==="/"||p==="/index.html") p="/index.html";
  const file = normalize(join(PUBLIC, p));
  if(!file.startsWith(PUBLIC) || !existsSync(file)){
    res.writeHead(404,{"content-type":"text/plain"}); res.end("404"); return;
  }
  const ct = MIME[extname(file)] || "application/octet-stream";
  res.writeHead(200,{"content-type":ct,"cache-control":"no-cache"});
  res.end(readFileSync(file));
}).listen(PORT, ()=>console.log(`Merit UI on http://127.0.0.1:${PORT}`));