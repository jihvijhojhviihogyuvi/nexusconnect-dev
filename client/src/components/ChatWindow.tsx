import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Phone, Video, MoreVertical, Users, Info, Search, Pin, ChevronDown, ChevronUp, X, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";
import { UserAvatar } from "./UserAvatar";
import { TypingIndicator } from "./TypingIndicator";
import { ForwardMessageDialog } from "./ForwardMessageDialog";
import { useSocket } from "@/contexts/SocketContext";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { ConversationWithDetails, MessageWithSender, User } from "@shared/schema";
import { format, isToday, isYesterday, isSameDay } from "date-fns";

interface ChatWindowProps {
  conversationId: string;
  currentUser: User;
  onStartCall: (type: "voice" | "video") => void;
  onViewGroupInfo?: () => void;
}

export function ChatWindow({
  conversationId,
  currentUser,
  onStartCall,
  onViewGroupInfo,
}: ChatWindowProps) {
  const [replyingTo, setReplyingTo] = useState<MessageWithSender | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<MessageWithSender | null>(null);
  const [showPinnedMessages, setShowPinnedMessages] = useState(false);
  const [editingMessage, setEditingMessage] = useState<MessageWithSender | null>(null);
  const [editContent, setEditContent] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const { sendMessage: sendSocketMessage, onMessage } = useSocket();

  const { data: conversation, isLoading: conversationLoading } = useQuery<ConversationWithDetails>({
    queryKey: ["/api/conversations", conversationId],
  });

  const { data: messages, isLoading: messagesLoading } = useQuery<MessageWithSender[]>({
    queryKey: ["/api/conversations", conversationId, "messages"],
  });

  const { data: pinnedMessages } = useQuery<MessageWithSender[]>({
    queryKey: ["/api/conversations", conversationId, "pinned"],
  });

  const sendMessageMutation = useMutation({
    mutationFn: async ({ content, attachments, replyToId }: { content: string; attachments?: File[]; replyToId?: string }) => {
      const formData = new FormData();
      formData.append("content", content);
      if (replyToId) formData.append("replyToId", replyToId);
      attachments?.forEach((file) => formData.append("attachments", file));

      const response = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      return response.json();
    },
    onMutate: async (variables) => {
      // Cancel ongoing queries
      await queryClient.cancelQueries({ queryKey: ["/api/conversations", conversationId, "messages"] });

      // Get previous data
      const previousMessages = queryClient.getQueryData<MessageWithSender[]>(["/api/conversations", conversationId, "messages"]);

      // Create optimistic message
      const optimisticMessage: MessageWithSender = {
        id: `temp-${Date.now()}`,
        conversationId,
        senderId: currentUser.id,
        content: variables.content,
        messageType: variables.attachments?.length ? "image" : "text",
        attachments: variables.attachments?.map((f) => ({ url: "", type: f.type, name: f.name, size: f.size })),
        replyToId: variables.replyToId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
        sender: currentUser,
        replyTo: null,
      };

      // Update cache optimistically
      if (previousMessages) {
        queryClient.setQueryData(["/api/conversations", conversationId, "messages"], [...previousMessages, optimisticMessage]);
      }

      return { previousMessages };
    },
    onSuccess: (data, variables, context) => {
      // Update cache with actual message
      const previousMessages = context?.previousMessages || [];
      const optimisticId = `temp-${Date.now()}`;
      const filtered = previousMessages.filter((m: any) => !m.id.startsWith("temp-"));
      queryClient.setQueryData(["/api/conversations", conversationId, "messages"], [...filtered, data]);
    },
    onError: (err, variables, context) => {
      // Restore previous messages on error
      if (context?.previousMessages) {
        queryClient.setQueryData(["/api/conversations", conversationId, "messages"], context.previousMessages);
      }
    },
  });

  const deleteMessageMutation = useMutation({
    mutationFn: async (messageId: string) => {
      await apiRequest("DELETE", `/api/messages/${messageId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId, "messages"] });
    },
  });

  const editMessageMutation = useMutation({
    mutationFn: async ({ messageId, content }: { messageId: string; content: string }) => {
      return await apiRequest("PATCH", `/api/messages/${messageId}`, { content });
    },
    onMutate: async ({ messageId, content }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/conversations", conversationId, "messages"] });
      const previousMessages = queryClient.getQueryData<MessageWithSender[]>(["/api/conversations", conversationId, "messages"]);

      queryClient.setQueryData(["/api/conversations", conversationId, "messages"], (oldData: MessageWithSender[] | undefined) => {
        if (!oldData) return oldData;
        return oldData.map((m) =>
          m.id === messageId
            ? { ...m, content, editedAt: new Date().toISOString() }
            : m
        );
      });

      return { previousMessages };
    },
    onError: (err, variables, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(["/api/conversations", conversationId, "messages"], context.previousMessages);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId, "messages"] });
    },
  });

  const pinMessageMutation = useMutation({
    mutationFn: async ({ messageId, isPinned }: { messageId: string; isPinned: boolean }) => {
      if (isPinned) {
        await apiRequest("DELETE", `/api/messages/${messageId}/pin`);
      } else {
        await apiRequest("POST", `/api/messages/${messageId}/pin`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId, "pinned"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId, "messages"] });
    },
  });

  const markMessageReadMutation = useMutation({
    mutationFn: async (messageId: string) => {
      await apiRequest("POST", `/api/messages/${messageId}/read`);
    },
  });

  const addReactionMutation = useMutation({
    mutationFn: async ({ messageId, emoji }: { messageId: string; emoji: string }) => {
      await apiRequest("POST", `/api/messages/${messageId}/reactions`, { emoji });
    },
    onMutate: async ({ messageId, emoji }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/conversations", conversationId, "messages"] });
      const previousMessages = queryClient.getQueryData<MessageWithSender[]>(["/api/conversations", conversationId, "messages"]);
      
      queryClient.setQueryData(["/api/conversations", conversationId, "messages"], (oldData: MessageWithSender[] | undefined) => {
        if (!oldData) return oldData;
        return oldData.map((m) => {
          if (m.id !== messageId) return m;
          const existingReactions = m.reactions || [];
          const existingReaction = existingReactions.find((r) => r.emoji === emoji);
          if (existingReaction) {
            return {
              ...m,
              reactions: existingReactions.map((r) =>
                r.emoji === emoji ? { ...r, count: r.count + 1, userReacted: true } : r
              ),
            };
          }
          return {
            ...m,
            reactions: [...existingReactions, { emoji, count: 1, userReacted: true }],
          };
        });
      });
      
      return { previousMessages };
    },
    onError: (err, variables, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(["/api/conversations", conversationId, "messages"], context.previousMessages);
      }
    },
  });

  const removeReactionMutation = useMutation({
    mutationFn: async ({ messageId, emoji }: { messageId: string; emoji: string }) => {
      await apiRequest("DELETE", `/api/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
    },
    onMutate: async ({ messageId, emoji }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/conversations", conversationId, "messages"] });
      const previousMessages = queryClient.getQueryData<MessageWithSender[]>(["/api/conversations", conversationId, "messages"]);
      
      queryClient.setQueryData(["/api/conversations", conversationId, "messages"], (oldData: MessageWithSender[] | undefined) => {
        if (!oldData) return oldData;
        return oldData.map((m) => {
          if (m.id !== messageId) return m;
          const existingReactions = m.reactions || [];
          return {
            ...m,
            reactions: existingReactions
              .map((r) =>
                r.emoji === emoji ? { ...r, count: r.count - 1, userReacted: false } : r
              )
              .filter((r) => r.count > 0),
          };
        });
      });
      
      return { previousMessages };
    },
    onError: (err, variables, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(["/api/conversations", conversationId, "messages"], context.previousMessages);
      }
    },
  });

  useEffect(() => {
    const unsubscribe = onMessage((type, payload) => {
      if (type === "new-message" && payload.conversationId === conversationId) {
        // Update cache directly instead of invalidating (fast path)
        queryClient.setQueryData(["/api/conversations", conversationId, "messages"], (oldData: MessageWithSender[] | undefined) => {
          if (!oldData) return oldData;
          // Prevent duplicates
          const exists = oldData.some((m) => m.id === payload.message.id);
          if (exists) return oldData;
          return [...oldData, payload.message];
        });
        
        // Update conversation last message
        queryClient.setQueryData(["/api/conversations"], (oldData: ConversationWithDetails[] | undefined) => {
          if (!oldData) return oldData;
          return oldData.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  lastMessage: payload.message,
                  updatedAt: new Date().toISOString(),
                }
              : conv
          );
        });
      }
      if (type === "typing-status" && payload.conversationId === conversationId) {
        queryClient.setQueryData(["/api/conversations", conversationId], (oldData: ConversationWithDetails | undefined) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            participants: oldData.participants.map((p) =>
              p.userId === payload.userId ? { ...p, isTyping: payload.isTyping } : p
            ),
          };
        });
      }
      if ((type === "message-pinned" || type === "message-unpinned") && payload.conversationId === conversationId) {
        queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId, "pinned"] });
        queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId, "messages"] });
      }
      if (type === "message-read" && payload.conversationId === conversationId) {
        queryClient.setQueryData(["/api/conversations", conversationId, "messages"], (oldData: MessageWithSender[] | undefined) => {
          if (!oldData) return oldData;
          return oldData.map((m) => {
            if (m.id === payload.messageId) {
              const existingReadBy = m.readBy || [];
              const alreadyRead = existingReadBy.some((r) => r.user.id === payload.userId);
              if (alreadyRead) return m;
              return {
                ...m,
                status: "read",
                readBy: [...existingReadBy, { user: payload.user, readAt: new Date(payload.readAt) }],
              };
            }
            return m;
          });
        });
      }
      if (type === "message-reactions-updated" && payload.conversationId === conversationId) {
        queryClient.setQueryData(["/api/conversations", conversationId, "messages"], (oldData: MessageWithSender[] | undefined) => {
          if (!oldData) return oldData;
          return oldData.map((m) => 
            m.id === payload.messageId ? { ...m, reactions: payload.reactions } : m
          );
        });
      }
    });

    return unsubscribe;
  }, [conversationId, onMessage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Clear unread count and mark messages as read when opening conversation
  useEffect(() => {
    queryClient.setQueryData(["/api/conversations"], (oldData: ConversationWithDetails[] | undefined) => {
      if (!oldData) return oldData;
      return oldData.map((conv) =>
        conv.id === conversationId ? { ...conv, unreadCount: 0 } : conv
      );
    });
  }, [conversationId]);

  // Mark unread messages as read when conversation is opened or new messages arrive
  useEffect(() => {
    if (!messages || messages.length === 0) return;
    
    const unreadMessages = messages.filter(
      (m) => m.senderId !== currentUser.id && 
             m.status !== "read" && 
             !m.readBy?.some((r) => r.user.id === currentUser.id)
    );

    unreadMessages.forEach((m) => {
      if (!m.id.startsWith("temp-")) {
        markMessageReadMutation.mutate(m.id);
      }
    });
  }, [messages, currentUser.id]);

  const handleSendMessage = useCallback(
    (content: string, attachments?: File[], replyToId?: string) => {
      sendMessageMutation.mutate({ content, attachments, replyToId });
    },
    [sendMessageMutation]
  );

  const handleTyping = useCallback(
    (isTyping: boolean) => {
      sendSocketMessage("typing", { conversationId, isTyping });
    },
    [conversationId, sendSocketMessage]
  );

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      deleteMessageMutation.mutate(messageId);
    },
    [deleteMessageMutation]
  );

  const handlePinMessage = useCallback(
    (message: MessageWithSender) => {
      pinMessageMutation.mutate({ messageId: message.id, isPinned: !!message.isPinned });
    },
    [pinMessageMutation]
  );

  const handleReaction = useCallback(
    (messageId: string, emoji: string, hasReacted: boolean) => {
      if (hasReacted) {
        removeReactionMutation.mutate({ messageId, emoji });
      } else {
        addReactionMutation.mutate({ messageId, emoji });
      }
    },
    [addReactionMutation, removeReactionMutation]
  );

  const handleEditMessage = useCallback((message: MessageWithSender) => {
    setEditingMessage(message);
    setEditContent(message.content || "");
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (editingMessage && editContent.trim()) {
      editMessageMutation.mutate(
        { messageId: editingMessage.id, content: editContent.trim() },
        {
          onSuccess: () => {
            setEditingMessage(null);
            setEditContent("");
          },
        }
      );
    }
  }, [editingMessage, editContent, editMessageMutation]);

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
    setEditContent("");
  }, []);

  const scrollToMessage = useCallback((messageId: string) => {
    const element = messageRefs.current.get(messageId);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.classList.add("bg-primary/10");
      setTimeout(() => {
        element.classList.remove("bg-primary/10");
      }, 2000);
    }
  }, []);

  const getConversationHeader = () => {
    if (!conversation) return { name: "", avatar: null, isGroup: false, participants: [] };

    if (conversation.type === "group") {
      return {
        name: conversation.name || "Unnamed Group",
        avatar: null,
        isGroup: true,
        participants: conversation.participants.map((p) => p.user),
      };
    }

    const otherParticipant = conversation.participants.find(
      (p) => p.user.id !== currentUser.id
    )?.user;

    return {
      name: otherParticipant
        ? `${otherParticipant.firstName || ""} ${otherParticipant.lastName || ""}`.trim() || "Unknown"
        : "Unknown",
      avatar: otherParticipant || null,
      isGroup: false,
      participants: otherParticipant ? [otherParticipant] : [],
    };
  };

  const typingUsers = conversation?.participants
    .filter((p) => p.userId !== currentUser.id && p.isTyping)
    .map((p) => p.user);

  const header = getConversationHeader();

  const formatDateDivider = (date: Date) => {
    if (isToday(date)) return "Today";
    if (isYesterday(date)) return "Yesterday";
    return format(date, "MMMM d, yyyy");
  };

  const groupedMessages = messages?.reduce((acc, message) => {
    const date = new Date(message.createdAt!);
    const dateKey = format(date, "yyyy-MM-dd");
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(message);
    return acc;
  }, {} as Record<string, MessageWithSender[]>);

  if (conversationLoading || messagesLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </div>
        <div className="flex-1 p-4 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={cn("flex gap-2", i % 2 === 0 ? "" : "flex-row-reverse")}>
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className={cn("h-16 rounded-2xl", i % 2 === 0 ? "w-48" : "w-64")} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-4 border-b shrink-0">
        <div className="flex items-center gap-3">
          {header.isGroup ? (
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Users className="h-5 w-5 text-primary" />
            </div>
          ) : header.avatar ? (
            <UserAvatar user={header.avatar} showStatus size="md" />
          ) : null}
          <div>
            <h2 className="font-semibold" data-testid="text-conversation-header-name">{header.name}</h2>
            {header.isGroup ? (
              <p className="text-xs text-muted-foreground" data-testid="text-participant-count">
                {conversation?.participants.length} members
              </p>
            ) : header.avatar?.status === "online" ? (
              <p className="text-xs text-status-online">Online</p>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onStartCall("voice")}
            data-testid="button-start-voice-call"
          >
            <Phone className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onStartCall("video")}
            data-testid="button-start-video-call"
          >
            <Video className="h-5 w-5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" data-testid="button-chat-menu">
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem data-testid="menu-search-messages">
                <Search className="h-4 w-4 mr-2" />
                Search messages
              </DropdownMenuItem>
              {header.isGroup && (
                <DropdownMenuItem onClick={onViewGroupInfo} data-testid="menu-group-info">
                  <Info className="h-4 w-4 mr-2" />
                  Group info
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" data-testid="menu-leave-conversation">
                Leave conversation
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {pinnedMessages && pinnedMessages.length > 0 && (
        <div className="border-b shrink-0">
          <button
            onClick={() => setShowPinnedMessages(!showPinnedMessages)}
            className="flex items-center justify-between w-full px-4 py-2 text-sm hover-elevate"
            data-testid="button-pinned-messages-toggle"
          >
            <div className="flex items-center gap-2">
              <Pin className="h-4 w-4 text-muted-foreground" />
              <span data-testid="text-pinned-count">{pinnedMessages.length} pinned message{pinnedMessages.length > 1 ? "s" : ""}</span>
            </div>
            {showPinnedMessages ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showPinnedMessages && (
            <div className="px-4 pb-3 space-y-2" data-testid="pinned-messages-list">
              {pinnedMessages.map((msg) => (
                <button
                  key={msg.id}
                  onClick={() => {
                    scrollToMessage(msg.id);
                    setShowPinnedMessages(false);
                  }}
                  className="flex items-start gap-2 w-full p-2 rounded-md text-left text-sm bg-muted/50 hover-elevate"
                  data-testid={`button-pinned-message-${msg.id}`}
                >
                  <Pin className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-xs">{msg.sender.firstName} {msg.sender.lastName}</p>
                    <p className="truncate text-muted-foreground">{msg.content}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="p-4 space-y-4">
          {!messages?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm" data-testid="text-no-messages">No messages yet. Start the conversation!</p>
            </div>
          ) : (
            Object.entries(groupedMessages || {}).map(([dateKey, dayMessages]) => (
              <div key={dateKey}>
                <div className="flex justify-center my-4">
                  <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                    {formatDateDivider(new Date(dateKey))}
                  </span>
                </div>
                <div className="space-y-3">
                  {dayMessages.map((message, index) => {
                    const prevMessage = dayMessages[index - 1];
                    const showAvatar =
                      !prevMessage ||
                      prevMessage.senderId !== message.senderId ||
                      new Date(message.createdAt!).getTime() - new Date(prevMessage.createdAt!).getTime() > 300000;

                    return (
                      <div
                        key={message.id}
                        ref={(el) => {
                          if (el) messageRefs.current.set(message.id, el);
                          else messageRefs.current.delete(message.id);
                        }}
                        className="transition-colors duration-500"
                      >
                        {editingMessage?.id === message.id ? (
                          <div
                            className={cn(
                              "flex gap-2",
                              message.senderId === currentUser.id ? "flex-row-reverse" : "flex-row"
                            )}
                            data-testid={`edit-message-container-${message.id}`}
                          >
                            <div className="w-8 shrink-0" />
                            <div className="flex-1 max-w-[70%] space-y-2">
                              <Input
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSaveEdit();
                                  }
                                  if (e.key === "Escape") {
                                    handleCancelEdit();
                                  }
                                }}
                                autoFocus
                                data-testid={`input-edit-message-${message.id}`}
                              />
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  onClick={handleSaveEdit}
                                  disabled={editMessageMutation.isPending || !editContent.trim()}
                                  data-testid={`button-save-edit-${message.id}`}
                                >
                                  <Check className="h-4 w-4 mr-1" />
                                  Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={handleCancelEdit}
                                  data-testid={`button-cancel-edit-${message.id}`}
                                >
                                  <X className="h-4 w-4 mr-1" />
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <MessageBubble
                            message={message}
                            isOwnMessage={message.senderId === currentUser.id}
                            showAvatar={showAvatar}
                            showSenderName={header.isGroup && showAvatar && message.senderId !== currentUser.id}
                            onReply={setReplyingTo}
                            onEdit={handleEditMessage}
                            onDelete={handleDeleteMessage}
                            onForward={setForwardingMessage}
                            onPin={handlePinMessage}
                            onReaction={handleReaction}
                            isAdmin={currentUser.isAdmin === true}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          {typingUsers && typingUsers.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TypingIndicator />
              <span>
                {typingUsers.length === 1
                  ? `${typingUsers[0].firstName} is typing...`
                  : `${typingUsers.length} people are typing...`}
              </span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <MessageInput
        conversationId={conversationId}
        onSend={handleSendMessage}
        onTyping={handleTyping}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        disabled={sendMessageMutation.isPending}
        participants={conversation?.participants.map((p) => p.user) || []}
      />

      <ForwardMessageDialog
        isOpen={!!forwardingMessage}
        onClose={() => setForwardingMessage(null)}
        message={forwardingMessage}
        currentConversationId={conversationId}
        currentUser={currentUser}
      />
    </div>
  );
}
