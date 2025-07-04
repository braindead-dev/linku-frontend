import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TimelineTabs from "@/components/TimelineTabs";
import SearchBar from "@/components/SearchBar";
import SuggestedUsers from "@/components/SuggestedUsers";
import { getUnreadConversationsCount } from "@/utils/unreadCount";

export default async function Home() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (!user || userError) {
    redirect("/login");
  }

  // Fetch user profile
  let { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  // If profile doesn't exist, create one
  if (!profile && user.email) {
    const baseUsername =
      user.user_metadata?.username || user.email.split("@")[0];
    const fullName = user.user_metadata?.full_name || "";

    // Try to create profile with base username
    const { data: newProfile, error: createError } = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        username: baseUsername,
        full_name: fullName,
      })
      .select()
      .single();

    // If username already exists, try with a random suffix
    if (createError?.code === "23505") {
      // Unique violation
      const uniqueUsername = `${baseUsername}_${Math.floor(Math.random() * 10000)}`;
      const { data: retryProfile, error: retryError } = await supabase
        .from("profiles")
        .insert({
          id: user.id,
          username: uniqueUsername,
          full_name: fullName,
        })
        .select()
        .single();

      if (!retryError) {
        profile = retryProfile;
      } else {
        console.error(
          "Error creating profile with unique username:",
          retryError,
        );
      }
    } else if (!createError) {
      profile = newProfile;
    } else {
      console.error("Error creating profile:", createError);
    }
  }

  if (profile && !profile.agent_id) {
    redirect(`/calibration?userId=${profile.id}`);
  }

  // Get unread conversations count
  const unreadCount = await getUnreadConversationsCount(user.id);

  return (
    <div className="mx-auto flex max-w-7xl">
      <Sidebar profile={profile} unreadCount={unreadCount} />

      {/* Feed */}
      <main className="min-h-screen flex-1 border-x border-gray-100 pb-24 dark:border-neutral-800">
        <TimelineTabs profile={profile} />
      </main>

      {/* Right column */}
      <aside className="hidden w-96 space-y-4 xl:block">
        <SearchBar />
        <div className="px-4">
          <SuggestedUsers currentUserId={user.id} currentProfile={profile} />
        </div>
      </aside>
    </div>
  );
}
