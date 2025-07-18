"use client";

import { FC, useState, useEffect, useRef } from "react";
import { Database } from "@/types/database.types";
import { createClient } from "@/utils/supabase/client";
import { User } from "@supabase/supabase-js";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Send, Bot } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import NewMessageDialog from "@/components/NewMessageDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Message = Database["public"]["Tables"]["user_messages"]["Row"] & {
  sender: Profile;
  recipient: Profile;
};

interface MessagesViewProps {
  currentUser: User;
}

interface Conversation {
  profile: Profile;
  lastMessage: Message | null;
  unreadCount: number;
}

const MessagesView: FC<MessagesViewProps> = ({ currentUser }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] =
    useState<Profile | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [newMessageDialogOpen, setNewMessageDialogOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Load conversations
  useEffect(() => {
    loadConversations();

    // Check for user in query params
    const username = searchParams.get("user");
    if (username) {
      loadUserFromUsername(username);
    }

    // Subscribe to new messages
    const channel = supabase
      .channel("messages")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_messages",
          filter: `recipient_id=eq.${currentUser.id}`,
        },
        (payload) => {
          handleNewMessage(payload.new as Message);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser.id, searchParams]);

  // Load messages when conversation is selected
  useEffect(() => {
    if (selectedConversation) {
      loadMessages(selectedConversation.id);
    }
  }, [selectedConversation]);

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const loadConversations = async () => {
    try {
      // Get all messages involving the current user
      const { data: allMessages, error } = await supabase
        .from("user_messages")
        .select(
          "*, sender:profiles!sender_id(*), recipient:profiles!recipient_id(*)",
        )
        .or(`sender_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Group messages by conversation
      const conversationMap = new Map<string, Conversation>();

      allMessages?.forEach((message) => {
        const otherUser =
          message.sender_id === currentUser.id
            ? message.recipient
            : message.sender;
        const existing = conversationMap.get(otherUser.id);

        if (
          !existing ||
          new Date(message.created_at) >
            new Date(existing.lastMessage!.created_at)
        ) {
          conversationMap.set(otherUser.id, {
            profile: otherUser,
            lastMessage: message,
            unreadCount:
              !message.read && message.recipient_id === currentUser.id ? 1 : 0,
          });
        } else if (!message.read && message.recipient_id === currentUser.id) {
          existing.unreadCount += 1;
        }
      });

      setConversations(Array.from(conversationMap.values()));
      setLoading(false);
    } catch (error) {
      console.error("Error loading conversations:", error);
      setLoading(false);
    }
  };

  const loadMessages = async (otherUserId: string) => {
    try {
      const { data, error } = await supabase
        .from("user_messages")
        .select(
          "*, sender:profiles!sender_id(*), recipient:profiles!recipient_id(*)",
        )
        .or(
          `and(sender_id.eq.${currentUser.id},recipient_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},recipient_id.eq.${currentUser.id})`,
        )
        .order("created_at", { ascending: true });

      if (error) throw error;

      setMessages(data || []);

      // Mark messages as read - only messages sent BY the other user TO the current user
      const { data: updatedMessages, error: updateError } = await supabase
        .from("user_messages")
        .update({ read: true })
        .eq("sender_id", otherUserId)
        .eq("recipient_id", currentUser.id)
        .eq("read", false)
        .select();

      if (!updateError && updatedMessages && updatedMessages.length > 0) {
        // Reload conversations to update the unread count
        await loadConversations();
      }
    } catch (error) {
      console.error("Error loading messages:", error);
    }
  };

  const handleNewMessage = async (message: Message) => {
    // Reload conversations to update the list
    await loadConversations();

    // If the message is in the current conversation, add it
    if (
      selectedConversation &&
      (message.sender_id === selectedConversation.id ||
        message.recipient_id === selectedConversation.id)
    ) {
      loadMessages(selectedConversation.id);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedConversation || sendingMessage) return;

    setSendingMessage(true);
    try {
      const { error } = await supabase.from("user_messages").insert({
        sender_id: currentUser.id,
        recipient_id: selectedConversation.id,
        content: newMessage.trim(),
      });

      if (error) throw error;

      setNewMessage("");
      await loadMessages(selectedConversation.id);
      await loadConversations();
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setSendingMessage(false);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "now";
    if (diffMins < 60) return `${diffMins}m`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h`;
    if (diffMins < 10080) return `${Math.floor(diffMins / 1440)}d`;
    return date.toLocaleDateString();
  };

  const loadUserFromUsername = async (username: string) => {
    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("username", username)
        .single();

      if (error) throw error;

      if (profile) {
        setSelectedConversation(profile);
        // Clear the query parameter
        router.replace("/messages");
      }
    } catch (error) {
      console.error("Error loading user:", error);
    }
  };

  return (
    <>
      <main className="flex h-screen flex-1">
        {/* Conversations list */}
        <div className="w-80 border-r border-gray-200 dark:border-neutral-800">
          <header className="border-b border-gray-200 p-4 dark:border-neutral-800">
            <h1 className="text-xl font-bold">Messages</h1>
          </header>
          <div className="overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-gray-500">
                Loading conversations...
              </div>
            ) : conversations.length === 0 ? (
              <div className="p-4 text-center text-gray-500">
                No conversations yet
              </div>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.profile.id}
                  onClick={() => setSelectedConversation(conversation.profile)}
                  className={`flex w-full items-center gap-3 p-4 transition-colors hover:bg-gray-50 dark:hover:bg-neutral-900 ${
                    selectedConversation?.id === conversation.profile.id
                      ? "bg-gray-50 dark:bg-neutral-900"
                      : ""
                  }`}
                >
                  <Avatar className="h-12 w-12">
                    <AvatarImage
                      src={conversation.profile.avatar_url ?? undefined}
                    />
                    <AvatarFallback>
                      {conversation.profile.full_name?.charAt(0) ||
                        conversation.profile.username.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 text-left">
                    <div className="flex items-baseline justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">
                          {conversation.profile.full_name ||
                            conversation.profile.username}
                        </span>
                        {conversation.unreadCount > 0 && (
                          <div className="h-2 w-2 rounded-full bg-blue-500" />
                        )}
                      </div>
                      {conversation.lastMessage && (
                        <span className="text-xs text-gray-500">
                          {formatTime(conversation.lastMessage.created_at)}
                        </span>
                      )}
                    </div>
                    {conversation.lastMessage && (
                      <p className="max-w-[200px] truncate overflow-hidden text-sm whitespace-nowrap text-gray-500">
                        {conversation.lastMessage.sender_id ===
                          currentUser.id && "You: "}
                        {conversation.lastMessage.content}
                      </p>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Messages thread */}
        {selectedConversation ? (
          <div className="flex flex-1 flex-col">
            <header className="flex items-center border-b border-gray-200 p-4 dark:border-neutral-800">
              <button
                onClick={() => router.push(`/${selectedConversation.username}`)}
                className="flex items-center gap-3 hover:cursor-pointer"
              >
                <Avatar className="h-10 w-10">
                  <AvatarImage
                    src={selectedConversation.avatar_url ?? undefined}
                  />
                  <AvatarFallback>
                    {selectedConversation.full_name?.charAt(0) ||
                      selectedConversation.username.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <div className="text-left">
                  <h2 className="font-semibold">
                    {selectedConversation.full_name ||
                      selectedConversation.username}
                  </h2>
                  <p className="text-xs text-neutral-600">
                    {selectedConversation.username}
                  </p>
                </div>
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-4">
              {messages.map((message, index) => {
                const nextMessage = messages[index + 1];
                const currentTime = new Date(message.created_at).getTime();
                const nextTime = nextMessage
                  ? new Date(nextMessage.created_at).getTime()
                  : null;
                const isWithinHour =
                  nextTime && nextTime - currentTime < 60 * 60 * 1000;

                return (
                  <div
                    key={message.id}
                    className={`mb-1 flex ${
                      message.sender_id === currentUser.id
                        ? "justify-end"
                        : "justify-start"
                    } transition-all`}
                  >
                    <div className="group flex items-center gap-3">
                      {message.is_ai_generated &&
                        message.sender_id === currentUser.id && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Bot className="h-5 w-5 flex-shrink-0 translate-y-1.5 text-gray-500" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>AI generated content</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      <div className="flex flex-col">
                        <div
                          className={`max-w-xs cursor-default px-4 py-1.5 ${
                            message.sender_id === currentUser.id
                              ? "bg-blue-500 text-white"
                              : "bg-gray-100 dark:bg-neutral-800"
                          } ${
                            message.content.includes(" ") ||
                            message.content.length > 40
                              ? "rounded-xl"
                              : "rounded-full"
                          }`}
                        >
                          <p className="break-words">{message.content}</p>
                        </div>
                        <p
                          className={`cursor-default text-xs transition-all ${
                            message.sender_id === currentUser.id
                              ? "text-right text-gray-500"
                              : "text-gray-500"
                          } ${
                            isWithinHour
                              ? "h-0 opacity-0 group-hover:mt-1 group-hover:h-auto group-hover:opacity-100"
                              : "mt-1 h-auto opacity-100"
                          }`}
                        >
                          {formatTime(message.created_at)}
                        </p>
                      </div>
                      {message.is_ai_generated &&
                        message.sender_id !== currentUser.id && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Bot className="h-5 w-5 flex-shrink-0 text-gray-500" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>AI generated content</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              className="flex items-center gap-2 border-t border-gray-200 p-4 dark:border-neutral-800"
            >
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 rounded-full border border-gray-300 px-4 py-2 focus:border-gray-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
              />
              <button
                type="submit"
                disabled={!newMessage.trim() || sendingMessage}
                className="rounded-full bg-blue-500 p-2 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                <Send className="h-5 w-5" />
              </button>
            </form>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-gray-500">
            <Image
              src="/square_logo.png"
              alt="Logo"
              width={80}
              height={80}
              className="mb-3 h-auto"
            />
            <h2 className="mb-1 text-xl font-medium text-gray-900 dark:text-gray-100">
              Your messages
            </h2>
            <p className="mb-6 text-sm text-gray-600">
              Send a message to start a chat.
            </p>
            <button
              onClick={() => setNewMessageDialogOpen(true)}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Send message
            </button>
          </div>
        )}
      </main>
      <NewMessageDialog
        open={newMessageDialogOpen}
        onOpenChange={setNewMessageDialogOpen}
        currentUserId={currentUser.id}
      />
    </>
  );
};

export default MessagesView;
