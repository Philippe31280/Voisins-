// Contrôle des saisies. Chaque fonction renvoie { value } ou { error }.

const clean = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

export function parseLieu(v) {
  const lieu = clean(v).toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(lieu)) return { error: "Lieu inconnu. Scannez à nouveau le QR code." };
  return { value: lieu };
}

function parsePrenom(v) {
  const prenom = clean(v);
  if (prenom.length < 1 || prenom.length > 30) return { error: "Indiquez votre prénom (30 caractères max)." };
  return { value: prenom };
}

// Une annonce présente 1 personne (seule) ou 2 (en couple).
export function parsePost(body) {
  const list = Array.isArray(body?.personnes) ? body.personnes : [];
  if (list.length < 1 || list.length > 2) return { error: "Présentez une ou deux personnes." };

  const personnes = [];
  for (const [i, p] of list.entries()) {
    const qui = list.length === 2 ? (i === 0 ? " de la 1re personne" : " de la 2e personne") : "";
    const prenom = clean(p?.prenom);
    if (prenom.length < 1 || prenom.length > 30) return { error: `Indiquez le prénom${qui} (30 caractères max).` };
    const age = Number(p?.age);
    if (!Number.isInteger(age) || age < 18 || age > 110) {
      return { error: `Âge${qui} : ce service est réservé aux personnes de 18 ans et plus.` };
    }
    personnes.push({ prenom, age });
  }

  const message = clean(body?.message);
  if (message.length < 1 || message.length > 280) return { error: "Écrivez un petit message (280 caractères max)." };

  return { value: { personnes, message } };
}

export function parseReply(body) {
  const prenom = parsePrenom(body?.prenom);
  if (prenom.error) return prenom;

  const message = clean(body?.message);
  if (message.length < 1 || message.length > 200) return { error: "Écrivez une réponse (200 caractères max)." };

  return { value: { prenom: prenom.value, message } };
}
