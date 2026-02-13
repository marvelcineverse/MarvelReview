import Link from "next/link";
import { signIn } from "@/app/actions";

export default function LoginPage() {
  return (
    <section className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h1 className="text-xl font-bold">Connexion</h1>
      <p className="mt-1 text-sm text-slate-600">Connecte-toi pour noter et publier tes mini-critiques.</p>
      <form action={signIn} className="mt-5 space-y-4">
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
          Se connecter
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        Pas de compte ? <Link href="/signup">Créer un compte</Link>
      </p>
    </section>
  );
}
