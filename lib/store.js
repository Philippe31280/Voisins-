// Stockage : Upstash Redis (API REST) en production, mémoire en local.
// Chaque clé porte une date d'expiration : Redis efface tout seul après 48 h.

import { createHash, randomBytes } from "node:crypto";

export const TTL_SECONDS = 48 * 60 * 60;
const MAX_POSTS = 100;
const MAX_REPLIES = 20;

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export class StoreNotConfiguredError extends Error {}

// ---------- Exécution des commandes ----------

async function redisPipeline(commands) {
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis HTTP ${res.status}`);
  const out = await res.json();
  return out.map((r) => {
    if (r.error) throw new Error(`Redis: ${r.error}`);
    return r.result;
  });
}

// Mini Redis en mémoire, pour le développement local et les tests.
export function createMemoryRedis(now = () => Date.now()) {
  const data = new Map(); // key -> { value, expiresAt }

  function live(key) {
    const e = data.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== null && e.expiresAt <= now()) {
      data.delete(key);
      return undefined;
    }
    return e;
  }
  function put(key, value, keepTtlFrom) {
    data.set(key, { value, expiresAt: keepTtlFrom?.expiresAt ?? null });
  }
  function score(s) {
    if (s === "-inf") return -Infinity;
    if (s === "+inf") return Infinity;
    return Number(s);
  }

  function run([cmd, ...a]) {
    switch (cmd.toUpperCase()) {
      case "SET":
        data.set(a[0], { value: a[1], expiresAt: a[2] === "EX" ? now() + Number(a[3]) * 1000 : null });
        return "OK";
      case "GET":
        return live(a[0])?.value ?? null;
      case "MGET":
        return a.map((k) => live(k)?.value ?? null);
      case "DEL":
        return a.filter((k) => data.delete(k)).length;
      case "INCR": {
        const e = live(a[0]);
        const v = Number(e?.value ?? 0) + 1;
        put(a[0], String(v), e);
        return v;
      }
      case "EXPIRE": {
        const e = live(a[0]);
        if (!e) return 0;
        e.expiresAt = now() + Number(a[1]) * 1000;
        return 1;
      }
      case "EXPIREAT": {
        const e = live(a[0]);
        if (!e) return 0;
        e.expiresAt = Number(a[1]) * 1000;
        return 1;
      }
      case "ZADD": {
        const e = live(a[0]);
        const z = e?.value ?? new Map();
        z.set(a[2], Number(a[1]));
        put(a[0], z, e);
        return 1;
      }
      case "ZREM": {
        const z = live(a[0])?.value;
        return z ? a.slice(1).filter((m) => z.delete(m)).length : 0;
      }
      case "ZRANGEBYSCORE": {
        const z = live(a[0])?.value;
        if (!z) return [];
        const [min, max] = [score(a[1]), score(a[2])];
        return [...z].filter(([, s]) => s >= min && s <= max).sort((x, y) => x[1] - y[1]).map(([m]) => m);
      }
      case "ZREMRANGEBYSCORE": {
        const z = live(a[0])?.value;
        if (!z) return 0;
        const max = a[2].startsWith("(") ? Number(a[2].slice(1)) : score(a[2]);
        const exclusive = a[2].startsWith("(");
        let n = 0;
        for (const [m, s] of z) {
          if (exclusive ? s < max : s <= max) {
            z.delete(m);
            n++;
          }
        }
        return n;
      }
      case "RPUSH": {
        const e = live(a[0]);
        const l = e?.value ?? [];
        l.push(...a.slice(1));
        put(a[0], l, e);
        return l.length;
      }
      case "LRANGE":
        return [...(live(a[0])?.value ?? [])];
      case "LLEN":
        return live(a[0])?.value.length ?? 0;
      default:
        throw new Error(`Commande non gérée : ${cmd}`);
    }
  }

  return async (commands) => commands.map(run);
}

let memory;
function defaultPipeline() {
  if (url && token) return redisPipeline;
  // Sur Vercel sans base configurée, on refuse plutôt que de perdre les données.
  if (process.env.VERCEL) throw new StoreNotConfiguredError();
  memory ??= createMemoryRedis();
  return memory;
}

// ---------- Logique métier ----------

const k = {
  index: (lieu) => `v:${lieu}:posts`,
  post: (lieu, id) => `v:${lieu}:post:${id}`,
  replies: (lieu, id) => `v:${lieu}:rep:${id}`,
};

export const hash = (s) => createHash("sha256").update(s).digest("hex");

// getPipeline est appelé à chaque requête : une base mal configurée
// donne une erreur claire au lieu de planter au démarrage.
export function createStore(getPipeline = defaultPipeline, now = () => Date.now()) {
  const exec = (commands) => getPipeline()(commands);

  return {
    async createPost(lieu, { personnes, message }) {
      const id = randomBytes(8).toString("hex");
      const ownerToken = randomBytes(24).toString("base64url");
      const createdAt = now();
      const post = { id, personnes, message, createdAt, ownerHash: hash(ownerToken) };
      await exec([
        ["SET", k.post(lieu, id), JSON.stringify(post), "EX", String(TTL_SECONDS)],
        ["ZADD", k.index(lieu), String(createdAt), id],
        ["EXPIRE", k.index(lieu), String(TTL_SECONDS)],
      ]);
      return { post: publicPost(post, []), ownerToken };
    },

    async listPosts(lieu) {
      const min = now() - TTL_SECONDS * 1000;
      const [, ids] = await exec([
        ["ZREMRANGEBYSCORE", k.index(lieu), "-inf", `(${min}`],
        ["ZRANGEBYSCORE", k.index(lieu), String(min), "+inf"],
      ]);
      const recent = ids.slice(-MAX_POSTS).reverse();
      if (recent.length === 0) return [];
      const results = await exec([
        ["MGET", ...recent.map((id) => k.post(lieu, id))],
        ...recent.map((id) => ["LRANGE", k.replies(lieu, id), "0", "-1"]),
      ]);
      const [raws, ...replyLists] = results;
      return recent
        .map((id, i) => {
          if (!raws[i]) return null;
          const replies = replyLists[i].map((r) => JSON.parse(r));
          return publicPost(JSON.parse(raws[i]), replies);
        })
        .filter(Boolean);
    },

    async getPost(lieu, id) {
      const [raw] = await exec([["GET", k.post(lieu, id)]]);
      return raw ? JSON.parse(raw) : null;
    },

    async deletePost(lieu, id) {
      await exec([
        ["DEL", k.post(lieu, id), k.replies(lieu, id)],
        ["ZREM", k.index(lieu), id],
      ]);
    },

    // Renvoie false si l'annonce n'existe plus ou a trop de réponses.
    async addReply(lieu, post, { prenom, message }) {
      const [count] = await exec([["LLEN", k.replies(lieu, post.id)]]);
      if (count >= MAX_REPLIES) return false;
      const reply = { prenom, message, createdAt: now() };
      const expireAt = Math.ceil((post.createdAt + TTL_SECONDS * 1000) / 1000);
      await exec([
        ["RPUSH", k.replies(lieu, post.id), JSON.stringify(reply)],
        ["EXPIREAT", k.replies(lieu, post.id), String(expireAt)],
      ]);
      return true;
    },

    // true si l'action est autorisée, false si la limite horaire est atteinte.
    async rateLimit(key, max) {
      const [n] = await exec([
        ["INCR", `v:rl:${key}`],
        ["EXPIRE", `v:rl:${key}`, "3600"],
      ]);
      return n <= max;
    },
  };
}

function publicPost(post, replies) {
  const { ownerHash, ...rest } = post;
  return { ...rest, expiresAt: post.createdAt + TTL_SECONDS * 1000, replies };
}
