import Image from "next/image";
import { redirect } from "next/navigation";
import { updateProfile } from "@/app/actions";
import type { Profile } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export default async function ProfilePage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();

  let profile = (data ?? null) as Profile | null;
  if (error) {
    throw new Error(error.message);
  }

  if (!profile) {
    const fallbackUsername = String(user.user_metadata.username ?? `user_${user.id.slice(0, 8)}`);
    const fallbackMedia = String(user.user_metadata.media_name ?? "Media");
    const { data: inserted, error: insertError } = await supabase
      .from("profiles")
      .upsert({ id: user.id, username: fallbackUsername, media_name: fallbackMedia })
      .select("*")
      .single();
    if (insertError) {
      throw new Error(insertError.message);
    }
    profile = inserted as Profile;
  }

  return (
    <section className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h1 className="text-xl font-bold">Mon profil</h1>
      <p className="mt-1 text-sm text-slate-600">
        Le pseudo et le média sont utilisés dans la liste des critiques.
      </p>

      <form action={updateProfile} className="mt-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative h-16 w-16 overflow-hidden rounded-full bg-slate-200">
            {profile?.avatar_url ? (
              <Image src={profile.avatar_url} alt={profile.username} fill className="object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-xs font-semibold text-slate-500">
                Aucun
              </div>
            )}
          </div>
          <div className="flex-1">
            <label htmlFor="avatar" className="mb-1 block text-sm font-medium text-slate-700">
              Avatar (optionnel)
            </label>
            <input
              id="avatar"
              name="avatar"
              type="file"
              accept="image/*"
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-slate-700"
            />
          </div>
        </div>
        <div>
          <label htmlFor="username" className="mb-1 block text-sm font-medium text-slate-700">
            Pseudo
          </label>
          <input
            id="username"
            name="username"
            type="text"
            required
            defaultValue={profile?.username}
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
            defaultValue={profile?.media_name}
            minLength={2}
            maxLength={60}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none ring-brand-300 focus:ring"
          />
        </div>
        <button type="submit" className="w-full rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white">
          Mettre à jour
        </button>
      </form>
    </section>
  );
}
