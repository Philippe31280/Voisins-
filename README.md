# Voisins d'à côté

Un QR code affiché dans chaque logement. Les voyageurs le scannent et laissent un petit mot : seuls ou en couple, avec prénom(s), âge(s) et message. Leurs voisins peuvent répondre. **Tout s'efface automatiquement 48 h après la publication.**

- Pas de compte, pas d'e-mail, pas de numéro de téléphone.
- Réservé aux 18 ans et plus.
- Tous les logements qui affichent le même nom de lieu partagent le même tableau.

## Pages

| Adresse | Pour qui | Rôle |
|---|---|---|
| `/?lieu=residence-les-pins` | Voyageurs | Le tableau des voisins (c'est l'adresse du QR code) |
| `/qr.html` | Propriétaire | Crée et imprime l'affiche avec le QR code |

## Mise en ligne (15 min, gratuit)

1. **Vercel** : sur https://vercel.com, connectez-vous avec GitHub, puis **Add New… → Project** et importez ce dépôt. Laissez les réglages par défaut et cliquez sur **Deploy**.
2. **Base de données** : dans le projet Vercel, onglet **Storage → Create Database → Upstash (Redis)**, offre gratuite, puis **Connect** au projet. Les variables d'accès sont ajoutées toutes seules.
3. **Redéployez** (onglet **Deployments → ⋯ → Redeploy**) pour que la base soit prise en compte.
4. Ouvrez `https://votre-projet.vercel.app/qr.html`, tapez le nom de votre résidence, imprimez l'affiche.

Tant que la base n'est pas branchée, l'appli affiche : « La base de données n'est pas encore branchée ».

## Comment les données s'effacent

Chaque annonce et ses réponses sont enregistrées dans Redis avec une durée de vie de 48 h. Redis les supprime lui-même : aucune tâche planifiée, rien à nettoyer à la main. Les adresses IP ne sont jamais stockées en clair (seulement une empreinte, gardée 1 h, pour limiter les abus : 5 annonces et 30 réponses par heure maximum).

## Développement local

```bash
npm run dev    # http://localhost:3000/?lieu=test (données en mémoire)
npm test
```

Aucune dépendance à installer. Le générateur de QR code (`public/qrcode.js`, licence MIT, Kazuhiko Arase) est inclus dans le dépôt.
