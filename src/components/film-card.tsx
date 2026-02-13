import Image from "next/image";
import Link from "next/link";
import type { FilmRanking } from "@/lib/database.types";
import { formatDate, formatRating } from "@/lib/format";

type Props = {
  film: FilmRanking;
};

export function FilmCard({ film }: Props) {
  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <Link href={`/films/${film.film_id}`} className="block">
        <div className="relative aspect-[2/3] w-full bg-slate-100">
          {film.poster_url ? (
            <Image src={film.poster_url} alt={film.title} fill className="object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              Affiche indisponible
            </div>
          )}
        </div>
      </Link>
      <div className="space-y-2 p-3">
        <h2 className="line-clamp-2 text-sm font-semibold text-slate-900">{film.title}</h2>
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span>{film.type === "movie" ? "Film" : "Série"}</span>
          <span>{formatDate(film.release_date)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="rounded-full bg-brand-100 px-2 py-1 text-xs font-bold text-brand-700">
            {formatRating(film.average_rating)}/10
          </span>
          <span className="text-xs text-slate-600">{film.rating_count} notes</span>
        </div>
      </div>
    </article>
  );
}
