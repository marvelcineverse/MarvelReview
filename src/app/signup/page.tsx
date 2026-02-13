import Link from "next/link";
import { signUp } from "@/app/actions";

export default function SignupPage() {
  return (
    <section className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h1 className="text-xl font-bold">Inscription</h1>
      <p className="mt-1 text-sm text-slate-600">
        Crée ton profil média pour noter les films et séries Marvel.
      </p>
      <form action={signUp} className="mt-5 space-y-4">
        <div>
          <label htmlFor="username" className="mb-1 block text-sm font-medium text-slate-700">
            Pseudo
          </label>
          <input
            id="username"
            name="username"
            type="text"
            required
            minLength={2}
            maxLength={30}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
          />
        </div>
        <div>
          <label htmlFor="media_name" className="mb-1 block text-sm font-medium text-slate-700">
            Média
          </label>
          <input
            id="media_name"
            name="media_name"
            type="text"
            required
            placeholder="Marvel CinéVerse"
            minLength={2}
            maxLength={60}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
          />
        </div>
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
            Mot de passe
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
          />
        </div>
        <button type="submit" className="w-full rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white">
          Créer mon compte
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        Déjà inscrit ? <Link href="/login">Se connecter</Link>
      </p>
    </section>
  );
}
