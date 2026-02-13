import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { saveRating } from "@/app/actions";
import type { Film, FilmRanking, Rating } from "@/lib/database.types";
import { formatDate, formatRating } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type PageProps = {
  params: { id: string };
  searchParams: { sort?: string };
};

type ReviewRow = Pick<Rating, "id" | "rating" | "review" | "created_at" | "user_id"> & {
  profiles: { username: string; media_name: string; avatar_url: string | null } | null;
};

export default async function FilmPage({ params, searchParams }: PageProps) {
  const supabase = createClient();
  const sort = searchParams.sort === "top" ? "top" : "recent";

  const { data: filmData, error: filmError } = await supabase
    .from("films")
    .select("*")
    .eq("id", params.id)
    .single();

  if (filmError) {
    redirect("/");
  }

  const film = filmData as Film;

  const { data: rankingData } = await supabase
    .from("film_rankings")
    .select("*")
    .eq("film_id", params.id)
    .single();
  const ranking = (rankingData ?? null) as FilmRanking | null;

  let reviewsQuery = supabase
    .from("ratings")
    .select("id,rating,review,created_at,user_id,profiles!ratings_user_id_fkey(username,media_name,avatar_url)")
    .eq("film_id", params.id);

  if (sort === "top") {
    reviewsQuery = reviewsQuery.order("rating", { ascending: false }).order("created_at", { ascending: false });
  } else {
    reviewsQuery = reviewsQuery.order("created_at", { ascending: false });
  }

  const { data: reviewsData, error: reviewsError } = await reviewsQuery;
  if (reviewsError) {
    throw new Error(reviewsError.message);
  }

  const reviews = (reviewsData ?? []) as ReviewRow[];

  const {
    data: { user }
  } = await supabase.auth.getUser();

  let myRating: Rating | null = null;
  if (user) {
    const { data } = await supabase
      .from("ratings")
      .select("*")
      .eq("film_id", params.id)
      .eq("user_id", user.id)
      .maybeSingle();

    myRating = (data ?? null) as Rating | null;
  }

  return (
    <section className="space-y-5">
      <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[140px,1fr]">
        <div className="relative mx-auto aspect-[2/3] w-36 overflow-hidden rounded-lg bg-slate-100 sm:mx-0">
          {film.poster_url ? (
            <Image src={film.poster_url} alt={film.title} fill className="object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-500">Pas d'affiche</div>
          )}
        </div>
        <div className="space-y-3">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{film.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-brand-100 px-2 py-1 font-bold text-brand-700">
              {formatRating(ranking?.average_rating ?? null)}/10
            </span>
            <span className="text-slate-600">{ranking?.rating_count ?? 0} notes</span>
            <span className="text-slate-500">Sortie: {formatDate(film.release_date)}</span>
          </div>
          <p className="text-sm text-slate-600">
            {film.type === "movie" ? "Film Marvel" : "Série Marvel"} noté par la communauté.
          </p>
        </div>
      </div>

      {user ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold">Ta note et ta mini-critique</h2>
          <form action={saveRating} className="mt-4 space-y-3">
            <input type="hidden" name="film_id" value={film.id} />
            <div>
              <label htmlFor="rating" className="mb-1 block text-sm font-medium text-slate-700">
                Note (/10, 1 décimale)
              </label>
              <input
                id="rating"
                name="rating"
                type="number"
                required
                min={0}
                max={10}
                step={0.1}
                defaultValue={myRating?.rating ?? ""}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring sm:w-40"
              />
            </div>
            <div>
              <label htmlFor="review" className="mb-1 block text-sm font-medium text-slate-700">
                Mini-critique (optionnel, 500 caractères max)
              </label>
              <textarea
                id="review"
                name="review"
                rows={4}
                maxLength={500}
                defaultValue={myRating?.review ?? ""}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
              />
            </div>
            <button type="submit" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
              Enregistrer
            </button>
          </form>
        </section>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
          <Link href="/login">Connecte-toi</Link> pour noter ce contenu et publier ta review.
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Reviews</h2>
          <div className="flex gap-2 text-sm">
            <Link
              href={`/films/${film.id}?sort=recent`}
              className={`rounded-md px-2 py-1 ${sort === "recent" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              Plus récent
            </Link>
            <Link
              href={`/films/${film.id}?sort=top`}
              className={`rounded-md px-2 py-1 ${sort === "top" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              Meilleure note
            </Link>
          </div>
        </div>

        <div className="space-y-3">
          {reviews.map((review) => (
            <article key={review.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">
                  {review.profiles?.username ?? "Utilisateur"} · {review.profiles?.media_name ?? "Média inconnu"}
                </p>
                <p className="rounded-full bg-brand-100 px-2 py-1 text-xs font-bold text-brand-700">
                  {formatRating(review.rating)}/10
                </p>
              </div>
              <p className="mt-1 text-xs text-slate-500">{formatDate(review.created_at)}</p>
              {review.review ? <p className="mt-2 text-sm leading-relaxed text-slate-700">{review.review}</p> : null}
            </article>
          ))}
          {reviews.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
              Aucune review pour le moment.
            </p>
          )}
        </div>
      </section>
    </section>
  );
}
