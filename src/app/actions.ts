"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const REVIEW_MAX_LENGTH = 500;

function toRatingValue(raw: FormDataEntryValue | null): number {
  const value = typeof raw === "string" ? Number.parseFloat(raw) : Number.NaN;
  if (Number.isNaN(value) || value < 0 || value > 10) {
    throw new Error("Note invalide: elle doit être entre 0 et 10.");
  }
  return Math.round(value * 10) / 10;
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim();
  const mediaName = String(formData.get("media_name") ?? "").trim();

  if (!email || !password || !username || !mediaName) {
    throw new Error("Tous les champs obligatoires doivent être remplis.");
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username,
        media_name: mediaName
      }
    }
  });

  if (error) {
    throw new Error(error.message);
  }

  redirect("/");
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  const supabase = createClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(error.message);
  }

  redirect("/");
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function saveRating(formData: FormData) {
  const supabase = createClient();
  const filmId = String(formData.get("film_id") ?? "");
  const reviewText = String(formData.get("review") ?? "").trim();

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const rating = toRatingValue(formData.get("rating"));
  const review = reviewText.length > 0 ? reviewText.slice(0, REVIEW_MAX_LENGTH) : null;

  const { error } = await supabase.from("ratings").upsert(
    {
      user_id: user.id,
      film_id: filmId,
      rating,
      review
    },
    { onConflict: "user_id,film_id" }
  );

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath(`/films/${filmId}`);
  revalidatePath("/ranking");
  revalidatePath("/");
  redirect(`/films/${filmId}`);
}

export async function updateProfile(formData: FormData) {
  const supabase = createClient();

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const username = String(formData.get("username") ?? "").trim();
  const mediaName = String(formData.get("media_name") ?? "").trim();
  const avatar = formData.get("avatar");

  if (!username || !mediaName) {
    throw new Error("Le pseudo et le média sont obligatoires.");
  }

  let avatarUrl: string | null = null;

  if (avatar instanceof File && avatar.size > 0) {
    const extension = avatar.name.split(".").pop() || "jpg";
    const filePath = `${user.id}/avatar.${extension}`;
    const arrayBuffer = await avatar.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    const upload = await supabase.storage.from("avatars").upload(filePath, bytes, {
      contentType: avatar.type || "image/jpeg",
      upsert: true
    });

    if (upload.error) {
      throw new Error(upload.error.message);
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(filePath);
    avatarUrl = data.publicUrl;
  }

  const payload: Record<string, string> = {
    username,
    media_name: mediaName
  };

  if (avatarUrl) {
    payload.avatar_url = avatarUrl;
  }

  const { error } = await supabase.from("profiles").update(payload).eq("id", user.id);
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/profile");
  redirect("/profile");
}
