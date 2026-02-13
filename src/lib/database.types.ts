export type FilmType = "movie" | "series";

export type Profile = {
  id: string;
  username: string;
  media_name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

export type Film = {
  id: string;
  title: string;
  type: FilmType;
  release_date: string | null;
  poster_url: string | null;
  created_at: string;
};

export type Rating = {
  id: string;
  user_id: string;
  film_id: string;
  rating: number;
  review: string | null;
  created_at: string;
  updated_at: string;
};

export type FilmRanking = {
  film_id: string;
  title: string;
  type: FilmType;
  poster_url: string | null;
  release_date: string | null;
  average_rating: number | null;
  rating_count: number;
};
