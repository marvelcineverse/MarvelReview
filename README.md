# Marvel Review

MVP webapp de notation et mini-critiques de films/séries Marvel.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS
- Supabase (Auth + Postgres + Storage)

## Fonctionnalités MVP

- Auth email/password (Supabase Auth)
- Profil utilisateur: pseudo (obligatoire), média (obligatoire), avatar (optionnel)
- Une note unique par utilisateur et par film (update via upsert)
- Note sur 10 avec 1 décimale + mini-critique optionnelle (max 500)
- Page film: moyenne, nombre de notes, reviews triées
- Classement: tri par moyenne desc puis nombre de notes desc
- UI responsive mobile-first

## Démarrage

1. Installer Node.js 18+.
2. Installer les dépendances:

```bash
npm install
```

3. Copier `.env.example` vers `.env.local` et renseigner:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

4. Dans Supabase SQL Editor, exécuter:

- `supabase/schema.sql`
- `supabase/seed.sql`

5. Lancer le projet:

```bash
npm run dev
```

## Pages

- `/` : liste films/séries
- `/films/[id]` : détail film + reviews + formulaire de note
- `/ranking` : classement
- `/login` et `/signup`
- `/profile`
