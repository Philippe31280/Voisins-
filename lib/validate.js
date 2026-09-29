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

export function parsePost(body) {
  const prenom = parsePrenom(body?.prenom);
  if (prenom.error) return prenom;

  const age = Number(body?.age);
  if (!Number.isInteger(age) || age < 18 || age > 110) {
    return { error: "Ce service est réservé aux personnes de 18 ans et plus." };
  }

  const message = clean(body?.message);
  if (message.length < 1 || message.length > 280) return { error: "Écrivez un petit message (280 caractères max)." };

  return { value: { prenom: prenom.value, age, message } };
}

export function parseReply(body) {
  const prenom = parsePrenom(body?.prenom);
  if (prenom.error) return prenom;

  const message = clean(body?.message);
  if (message.length < 1 || message.length > 200) return { error: "Écrivez une réponse (200 caractères max)." };

  return { value: { prenom: prenom.value, message } };
}
