import { StoreNotConfiguredError, hash } from "./store.js";

export function clientKey(req, lieu) {
  const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || "local";
  // On ne garde jamais l'adresse IP en clair.
  return hash(`${lieu}:${ip}`).slice(0, 32);
}

// Enveloppe commune : erreurs lisibles, pas de cache.
export function handler(fn) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof StoreNotConfiguredError) {
        return res.status(503).json({ error: "La base de données n'est pas encore branchée (voir le README)." });
      }
      console.error(err);
      res.status(500).json({ error: "Oups, un problème technique. Réessayez dans un instant." });
    }
  };
}
