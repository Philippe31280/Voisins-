// Serveur local pour tester sans Vercel : `npm run dev` puis http://localhost:3000/?lieu=test
// Sans variables Upstash, les données restent en mémoire.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT) || 3000;
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };
const routes = {
  "/api/posts": (await import("./api/posts.js")).default,
  "/api/replies": (await import("./api/replies.js")).default,
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = routes[url.pathname];

  if (route) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    req.query = Object.fromEntries(url.searchParams);
    try {
      req.body = raw ? JSON.parse(raw) : undefined;
    } catch {
      req.body = undefined;
    }
    res.status = (code) => ((res.statusCode = code), res);
    res.json = (data) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
    };
    return route(req, res);
  }

  const file = normalize(join("public", url.pathname === "/" ? "index.html" : url.pathname));
  if (!file.startsWith("public")) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("Introuvable");
  }
}).listen(PORT, () => console.log(`Voisins : http://localhost:${PORT}/?lieu=test`));
