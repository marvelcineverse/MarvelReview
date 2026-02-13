import Image from "next/image";
import Link from "next/link";
import type { FilmRanking } from "@/lib/database.types";
import { formatRating } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function RankingPage() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("film_rankings")
    .select("*")
    .order("average_rating", { ascending: false, nullsFirst: false })
    .order("rating_count", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const films = (data ?? []) as FilmRanking[];

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-extrabold tracking-tight">Classement films et séries</h1>
      <div className="space-y-3">
        {films.map((film, index) => (
          <article
            key={film.film_id}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
          >
            <p className="w-7 text-center text-lg font-black text-brand-700">{index + 1}</p>
            <div className="relative h-16 w-12 overflow-hidden rounded bg-slate-100">
              {film.poster_url ? (
                <Image src={film.poster_url} alt={film.title} fill className="object-cover" />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <Link href={`/films/${film.film_id}`} className="line-clamp-1 text-sm font-semibold text-slate-900">
                {film.title}
              </Link>
              <p className="text-xs text-slate-600">{film.type === "movie" ? "Film" : "Série"}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-brand-700">{formatRating(film.average_rating)}/10</p>
              <p className="text-xs text-slate-600">{film.rating_count} notes</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
