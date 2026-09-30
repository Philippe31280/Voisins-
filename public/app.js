const POLL_MS = 15000;

const $ = (sel, root = document) => root.querySelector(sel);
const lieu = (new URLSearchParams(location.search).get("lieu") || "").trim().toLowerCase();

// ---------- Mémoire locale (ce téléphone uniquement) ----------
const storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* navigation privée : tant pis, ça marche quand même */
    }
  },
};
const MINE_KEY = `voisins:${lieu}:mine`;
const mine = () => storage.get(MINE_KEY, {}); // { postId: ownerToken }

// ---------- Écrans ----------
const screens = ["sans-lieu", "accueil", "form", "tableau"];
function show(name) {
  for (const s of screens) $(`#ecran-${s}`).hidden = s !== name;
  window.scrollTo(0, 0);
  if (name === "tableau") refresh();
}
document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) show(go.dataset.go);
});

// ---------- API ----------
async function api(path, options = {}) {
  const res = await fetch(`/api/${path}${path.includes("?") ? "&" : "?"}lieu=${encodeURIComponent(lieu)}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Connexion impossible. Vérifiez votre réseau.");
  return data;
}

// ---------- Temps ----------
function ago(ts) {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  return `il y a ${Math.round(min / 60)} h`;
}
function remaining(ts) {
  const h = Math.max(0, Math.round((ts - Date.now()) / 3600000));
  return h < 1 ? "s'efface bientôt" : `s'efface dans ${h} h`;
}

// ---------- Tableau ----------
let posts = [];
let lastJson = "";

async function refresh() {
  try {
    const data = await api("posts");
    posts = data.posts;
    // Oublie les annonces de ce téléphone qui ont expiré.
    const t = mine();
    const live = Object.fromEntries(Object.entries(t).filter(([id]) => posts.some((p) => p.id === id)));
    if (Object.keys(live).length !== Object.keys(t).length) storage.set(MINE_KEY, live);
    $("#count-accueil").textContent = posts.length ? String(posts.length) : "";
    const json = JSON.stringify(posts);
    // Pas de re-rendu si rien n'a changé ou si quelqu'un est en train d'écrire.
    const typing = document.activeElement?.closest?.(".post");
    if (json !== lastJson && !typing) {
      lastJson = json;
      render();
    } else {
      updateTimes();
    }
  } catch (err) {
    if (!$("#ecran-tableau").hidden) notice(err.message);
  }
}

function notice(text) {
  const n = $("#notice");
  n.textContent = text;
  n.hidden = !text;
}

function render() {
  const liste = $("#liste");
  const tokens = mine();
  liste.replaceChildren(...posts.map((p) => renderPost(p, tokens[p.id])));
  $("#vide").hidden = posts.length > 0;
}

function updateTimes() {
  for (const el of document.querySelectorAll(".post")) {
    const p = posts.find((x) => x.id === el.dataset.id);
    if (!p) continue;
    $(".p-ago", el).textContent = ago(p.createdAt);
    $(".p-exp", el).textContent = remaining(p.expiresAt);
  }
}

function renderPost(p, ownerToken) {
  const el = $("#tpl-post").content.firstElementChild.cloneNode(true);
  el.dataset.id = p.id;
  // « Camille, 34 ans & Julien, 37 ans »
  const who = $(".p-who", el);
  p.personnes.forEach((pers, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "&";
      who.append(sep);
    }
    const name = document.createElement("strong");
    name.textContent = pers.prenom;
    who.append(name, `, ${pers.age} ans`);
  });
  $(".p-ago", el).textContent = ago(p.createdAt);
  $(".p-exp", el).textContent = remaining(p.expiresAt);
  $(".p-message", el).textContent = p.message;

  $(".replies", el).replaceChildren(
    ...p.replies.map((r) => {
      const li = document.createElement("li");
      const who = document.createElement("strong");
      who.textContent = `${r.prenom} : `;
      const when = document.createElement("span");
      when.className = "r-when";
      when.textContent = ago(r.createdAt);
      li.append(who, r.message, when);
      return li;
    }),
  );

  if (ownerToken) {
    el.classList.add("mine");
    $(".badge", el).hidden = false;
    $(".js-retirer", el).hidden = false;
  }

  const form = $(".reply-form", el);
  $(".js-repondre", el).addEventListener("click", () => {
    form.hidden = !form.hidden;
    if (!form.hidden) {
      $(".r-prenom", form).value ||= storage.get("voisins:prenom", "");
      ($(".r-prenom", form).value ? $(".r-message", form) : $(".r-prenom", form)).focus();
    }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("button", form);
    const err = $(".r-error", form);
    err.hidden = true;
    btn.disabled = true;
    const prenom = $(".r-prenom", form).value;
    try {
      await api(`replies?id=${p.id}`, {
        method: "POST",
        body: JSON.stringify({ prenom, message: $(".r-message", form).value }),
      });
      storage.set("voisins:prenom", prenom.trim());
      document.activeElement?.blur();
      lastJson = "";
      await refresh();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  const confirm = $(".confirm", el);
  $(".js-retirer", el).addEventListener("click", () => (confirm.hidden = false));
  $(".js-annuler", el).addEventListener("click", () => (confirm.hidden = true));
  $(".js-confirm", el).addEventListener("click", async () => {
    try {
      await api(`posts?id=${p.id}`, { method: "DELETE", headers: { "X-Owner-Token": ownerToken } });
      const t = mine();
      delete t[p.id];
      storage.set(MINE_KEY, t);
      lastJson = "";
      await refresh();
    } catch (ex) {
      notice(ex.message);
    }
  });

  return el;
}

// ---------- Formulaire ----------
function initForm() {
  const msg = $("#f-message");
  const count = () => ($("#f-count").textContent = `${msg.value.length}/280`);
  msg.addEventListener("input", count);
  count();
  $("#f-prenom").value = storage.get("voisins:prenom", "");

  const couple = () => $("#f-qui input:checked").value === "2";
  // Idées de message, au « nous » (couple) ou au « je » (seul).
  const IDEES = [
    {
      label: "🍷 Un verre",
      couple: "Bonjour, nous venons d'arriver pour quelques jours. Si vous êtes disponibles pour prendre un verre, ce serait avec plaisir !",
      seul: "Bonjour, je viens d'arriver pour quelques jours. Si vous êtes disponibles pour prendre un verre, ce serait avec plaisir !",
    },
    {
      label: "🌅 Apéro ce soir",
      couple: "Bonsoir les voisins ! Nous prenons l'apéro vers 19 h, vous êtes les bienvenus. Répondez-nous ici !",
      seul: "Bonsoir les voisins ! Je prends l'apéro vers 19 h, vous êtes les bienvenus. Répondez-moi ici !",
    },
    {
      label: "💬 Discuter",
      couple: "Bonjour ! Nous sommes de passage et serions ravis de discuter un moment avec vous.",
      seul: "Bonjour ! Je suis de passage et serais ravi(e) de discuter un moment avec vous.",
    },
    {
      label: "📍 Bons plans",
      couple: "Bonjour ! Nous découvrons le coin. Si vous avez des bons plans (restos, balades), parlons-en autour d'un verre !",
      seul: "Bonjour ! Je découvre le coin. Si vous avez des bons plans (restos, balades), parlons-en autour d'un verre !",
    },
    {
      label: "☕ Café demain",
      couple: "Bonjour ! Partants pour un café demain matin ? Répondez-nous ici, on s'organise.",
      seul: "Bonjour ! Partants pour un café demain matin ? Répondez-moi ici, on s'organise.",
    },
  ];
  const texte = (idee) => (couple() ? idee.couple : idee.seul);
  // L'idée dont le texte est encore intact (non modifié), sinon null.
  const ideeIntacte = () => IDEES.find((i) => msg.value === i.couple || msg.value === i.seul) ?? null;
  const marquerIdee = () => {
    const actuelle = ideeIntacte();
    for (const [n, b] of [...$("#f-idees").children].entries()) b.setAttribute("aria-pressed", String(IDEES[n] === actuelle));
  };
  $("#f-idees").replaceChildren(
    ...IDEES.map((idee) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "idee";
      b.textContent = idee.label;
      b.addEventListener("click", () => {
        msg.value = texte(idee);
        count();
        marquerIdee();
      });
      return b;
    }),
  );
  msg.addEventListener("input", marquerIdee);
  $("#btn-effacer").addEventListener("click", () => {
    msg.value = "";
    count();
    marquerIdee();
    msg.focus();
  });

  const syncQui = () => {
    // On passe du « je » au « nous » tant que l'idée choisie n'a pas été modifiée.
    const idee = ideeIntacte();
    if (idee) {
      msg.value = texte(idee);
      count();
    }
    marquerIdee();
    $("#personne2").hidden = !couple();
    $("#l-prenom1").textContent = couple() ? "Prénom 1" : "Prénom";
    $("#l-ok").textContent = couple()
      ? "Nous avons 18 ans ou plus. Nous acceptons que nos prénoms, nos âges et notre message soient visibles par les voisins pendant 48 h."
      : "J'ai 18 ans ou plus. J'accepte que mon prénom, mon âge et mon message soient visibles par les voisins pendant 48 h.";
  };
  $("#f-qui").addEventListener("change", syncQui);
  msg.value = texte(IDEES[0]);
  syncQui();

  $("#form-post").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#form-error");
    err.hidden = true;
    if (!$("#f-ok").checked) {
      err.textContent = "Cochez la case pour confirmer l'âge (18 ans ou plus).";
      err.hidden = false;
      return;
    }
    const btn = $("#btn-publier");
    btn.disabled = true;
    try {
      const prenom = $("#f-prenom").value;
      const data = await api("posts", {
        method: "POST",
        body: JSON.stringify({
          personnes: [
            { prenom, age: Number($("#f-age").value) },
            ...(couple() ? [{ prenom: $("#f-prenom2").value, age: Number($("#f-age2").value) }] : []),
          ],
          message: msg.value,
        }),
      });
      storage.set(MINE_KEY, { ...mine(), [data.post.id]: data.ownerToken });
      storage.set("voisins:prenom", prenom.trim());
      lastJson = "";
      show("tableau");
      notice("C'est publié ! Revenez voir de temps en temps : les réponses de vos voisins s'affichent sous votre annonce.");
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- Démarrage ----------
function prettyLieu(slug) {
  return slug.replace(/-/g, " ").replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

if (!/^[a-z0-9-]{2,40}$/.test(lieu)) {
  show("sans-lieu");
} else {
  $("#lieu-nom").textContent = prettyLieu(lieu);
  initForm();
  $("#btn-presenter").addEventListener("click", () => show("form"));
  $("#btn-me-presenter").addEventListener("click", () => show("form"));
  $("#btn-voir").addEventListener("click", () => show("tableau"));
  // Déjà une annonce sur ce téléphone ? On va droit au tableau.
  show(Object.keys(mine()).length ? "tableau" : "accueil");
  refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, POLL_MS);
}
