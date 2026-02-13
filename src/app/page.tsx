import { FilmCard } from "@/components/film-card";
import type { FilmRanking } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("film_rankings")
    .select("*")
    .order("release_date", { ascending: false, nullsFirst: false });

  if (error) {
    throw new Error(error.message);
  }

  const films = (data ?? []) as FilmRanking[];

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Films et séries Marvel</h1>
        <p className="text-sm text-slate-600">
          Note sur 10, publie une mini-critique, et compare les avis de ta communauté média.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {films.map((film) => (
          <FilmCard key={film.film_id} film={film} />
        ))}
      </div>
      {films.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          Aucun contenu chargé pour le moment. Ajoute des films dans la table <code>films</code>.
        </p>
      )}
    </section>
  );
}
