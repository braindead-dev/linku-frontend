"use client";
import { FC, useState, useEffect, useCallback } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Database } from "@/types/database.types";
import { createClient } from "@/utils/supabase/client";
import Link from "next/link";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface UserCardProps {
  user: Profile;
  currentUserId?: string;
}

/**
 * UserCard – displays a user with follow/unfollow button.
 */
const UserCard: FC<UserCardProps> = ({ user, currentUserId }) => {
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const checkFollowing = useCallback(async () => {
    if (!currentUserId) return;

    const { data } = await supabase
      .from("following")
      .select("id")
      .eq("follower_id", currentUserId)
      .eq("following_id", user.id)
      .single();

    setIsFollowing(!!data);
  }, [currentUserId, user.id, supabase]);

  useEffect(() => {
    if (currentUserId && currentUserId !== user.id) {
      checkFollowing();
    }
  }, [currentUserId, user.id, checkFollowing]);

  const handleFollow = async () => {
    if (!currentUserId || loading) return;

    setLoading(true);
    try {
      if (isFollowing) {
        // Unfollow
        await supabase
          .from("following")
          .delete()
          .eq("follower_id", currentUserId)
          .eq("following_id", user.id);
      } else {
        // Follow
        await supabase.from("following").insert({
          follower_id: currentUserId,
          following_id: user.id,
        });
      }
      setIsFollowing(!isFollowing);
    } catch (error) {
      console.error("Error toggling follow:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-neutral-900/50">
      <Link
        href={`/${user.username}`}
        className="-m-2 flex flex-1 items-center gap-3 rounded-lg p-2 transition-colors hover:bg-gray-50 dark:hover:bg-neutral-900/50"
      >
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarImage
            src={user.avatar_url ?? undefined}
            alt={`${user.username} avatar`}
          />
          <AvatarFallback>
            {user.full_name?.charAt(0).toUpperCase() ||
              user.username.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div>
          <h3 className="font-semibold">{user.full_name || user.username}</h3>
          <p className="text-sm text-gray-500">@{user.username}</p>
        </div>
      </Link>

      {currentUserId && currentUserId !== user.id && (
        <button
          onClick={handleFollow}
          disabled={loading}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
            isFollowing
              ? "border border-gray-300 hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-gray-700"
              : "bg-black text-white hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
          } disabled:opacity-50`}
        >
          {loading ? "..." : isFollowing ? "Following" : "Follow"}
        </button>
      )}
    </div>
  );
};

export default UserCard;
