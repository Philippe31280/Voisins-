// GET    /api/posts?lieu=xxx            → annonces des dernières 48 h
// POST   /api/posts?lieu=xxx            → publier son annonce
// DELETE /api/posts?lieu=xxx&id=yyy     → retirer son annonce (en-tête X-Owner-Token)

import { createStore, hash } from "../lib/store.js";
import { parseLieu, parsePost } from "../lib/validate.js";
import { clientKey, handler } from "../lib/http.js";

const store = createStore();

export default handler(async (req, res) => {
  const lieu = parseLieu(req.query.lieu);
  if (lieu.error) return res.status(400).json({ error: lieu.error });

  if (req.method === "GET") {
    return res.status(200).json({ posts: await store.listPosts(lieu.value) });
  }

  if (req.method === "POST") {
    const input = parsePost(req.body);
    if (input.error) return res.status(400).json({ error: input.error });
    if (!(await store.rateLimit(`post:${clientKey(req, lieu.value)}`, 5))) {
      return res.status(429).json({ error: "Vous avez déjà publié plusieurs annonces. Réessayez dans une heure." });
    }
    const created = await store.createPost(lieu.value, input.value);
    return res.status(201).json(created);
  }

  if (req.method === "DELETE") {
    const post = await store.getPost(lieu.value, String(req.query.id ?? ""));
    if (!post) return res.status(404).json({ error: "Cette annonce a déjà disparu." });
    const ownerToken = String(req.headers["x-owner-token"] ?? "");
    if (!ownerToken || hash(ownerToken) !== post.ownerHash) {
      return res.status(403).json({ error: "Seule la personne qui a publié l'annonce peut la retirer." });
    }
    await store.deletePost(lieu.value, post.id);
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  res.status(405).json({ error: "Méthode non autorisée." });
});
