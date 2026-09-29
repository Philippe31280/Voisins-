// POST /api/replies?lieu=xxx&id=yyy → répondre à une annonce

import { createStore } from "../lib/store.js";
import { parseLieu, parseReply } from "../lib/validate.js";
import { clientKey, handler } from "../lib/http.js";

const store = createStore();

export default handler(async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const lieu = parseLieu(req.query.lieu);
  if (lieu.error) return res.status(400).json({ error: lieu.error });

  const input = parseReply(req.body);
  if (input.error) return res.status(400).json({ error: input.error });

  const post = await store.getPost(lieu.value, String(req.query.id ?? ""));
  if (!post) return res.status(404).json({ error: "Cette annonce a disparu entre-temps." });

  if (!(await store.rateLimit(`reply:${clientKey(req, lieu.value)}`, 30))) {
    return res.status(429).json({ error: "Beaucoup de réponses d'un coup ! Réessayez dans une heure." });
  }

  if (!(await store.addReply(lieu.value, post, input.value))) {
    return res.status(409).json({ error: "Cette annonce a déjà reçu beaucoup de réponses." });
  }
  res.status(201).json({ ok: true });
});
