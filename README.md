# MarvelReview (HTML/CSS/JavaScript + Supabase)

Mini webapp de notation + mini-critiques de films Marvel.

## 1) Lancer le projet en local

1. Place-toi dans le dossier du projet.
2. Copie `config.example.js` en `config.js`.
3. Mets tes vraies valeurs Supabase dans `config.js`:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
4. Lance un serveur statique (exemple Python):
   - `python -m http.server 5500`
5. Ouvre: `http://localhost:5500/index.html`

## 2) Structure des fichiers

- `index.html`: liste des films
- `film.html?id=...`: detail film + moyenne + critiques + formulaire de note
- `ranking.html`: classement par moyenne
- `login.html`: connexion
- `forgot-password.html`: demande de reinitialisation du mot de passe
- `update-password.html`: definition du nouveau mot de passe via lien email
- `signup.html`: inscription
- `profile.html`: edition du profil
- `media.html`: fiche d'un media + classement de ses notes
- `admin.html`: outils d'administration (films, comptes, rattachements media)
- `styles.css`: styles globaux
- `supabaseClient.js`: creation du client Supabase (CDN)
- `app/*.js`: logique par page
- `supabase/schema.sql`: script SQL complet (tables + triggers + policies + seed)

## 3) Guide ultra simple dans l'interface Supabase

### A. Creer le projet et recuperer les cles

1. Dans Supabase: ouvre ton projet.
2. Va dans `Project Settings` > `API`.
3. Copie:
   - `Project URL` -> `SUPABASE_URL`
   - `anon public` -> `SUPABASE_ANON_KEY`
4. Colle-les dans `config.js`.

### B. Activer l'auth email/password

1. Va dans `Authentication` > `Providers`.
2. Active `Email`.
3. Laisse `Enable email confirmations` selon ton choix:
   - ON: l'utilisateur doit confirmer son email.
   - OFF: connexion immediate apres signup.
4. Dans `Authentication` > `URL Configuration`:
   - ajoute ton URL de site (ex: `https://ton-site.vercel.app`)
   - ajoute en redirect URL:
     - `https://ton-site.vercel.app/login.html?confirmed=1`
     - `https://ton-site.vercel.app/update-password.html`
     - pour local: `http://localhost:5500/login.html?confirmed=1` et `http://localhost:5500/update-password.html`

### B2. Personnaliser le mail de validation

1. Va dans `Authentication` > `Email Templates`.
2. Ouvre `Confirm signup`.
3. Tu peux modifier:
   - sujet
   - contenu HTML
   - style/branding
4. Garde le lien de confirmation avec la variable Supabase (ne remplace pas le token).

### C. Creer les tables rapidement

Option la plus simple (recommandee):
1. Va dans `SQL Editor`.
2. Clique `New query`.
3. Copie tout le contenu de `supabase/schema.sql`.
4. Clique `Run`.

### D. RLS minimal (si tu preferes verifier dans l'UI)

Apres execution du SQL, va dans `Database` > `Tables`:

1. `profiles`
   - RLS: active
   - Policies:
     - `SELECT`: `true`
     - `INSERT`: `auth.uid() = id`
     - `UPDATE`: `auth.uid() = id`

2. `films`
   - RLS: active
   - Policy:
     - `SELECT`: `true`

3. `ratings`
   - RLS: active
   - Policies:
     - `SELECT`: `true`
     - `INSERT`: `auth.uid() = user_id`
     - `UPDATE`: `auth.uid() = user_id`
     - `DELETE`: `auth.uid() = user_id`

## 4) Comportement MVP

- Auth email/password: signup/login/logout
- Mot de passe oublie: envoi d'email + page de nouveau mot de passe
- Profil: username + media obligatoires, avatar URL optionnelle
- Profil: demande de rattachement media soumise a validation
- Role admin: edition films, creation comptes, attribution de notes/reviews pour un utilisateur cible
- 1 note par utilisateur et par film (upsert sur `user_id,film_id`)
- Page film: moyenne + liste des notes (username, media, score, review, date)
- Classement: moyenne decroissante

## 5) Notes

- L'app utilise `@supabase/supabase-js` via CDN (pas de bundler).
- Le front est volontairement simple et pedagogique.
- Pour un deploiement public, pense a durcir la validation cote DB (longueur review, URL avatar, etc.).
