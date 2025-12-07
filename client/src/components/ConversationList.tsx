import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Plus, MessageCircle, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "./UserAvatar";
import { TypingIndicator } from "./TypingIndicator";
import { useSocket } from "@/contexts/SocketContext";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { ConversationWithDetails, User } from "@shared/schema";
import { formatDistanceToNow } from "date-fns";

interface ConversationListProps {
  selectedConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
  onNewConversation: () => void;
  onNewGroup: () => void;
  currentUser: User;
}

export function ConversationList({
  selectedConversationId,
  onSelectConversation,
  onNewConversation,
  onNewGroup,
  currentUser,
}: ConversationListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const { onMessage } = useSocket();

  const { data: conversations, isLoading } = useQuery<ConversationWithDetails[]>({
    queryKey: ["/api/conversations"],
  });

  useEffect(() => {
    const unsubscribe = onMessage((type, payload) => {
      if (type === "new-message") {
        const conversationId = payload.conversationId;
        const senderId = payload.message?.senderId;

        if (senderId === currentUser.id) {
          return;
        }

        if (conversationId !== selectedConversationId) {
          queryClient.setQueryData(["/api/conversations"], (oldData: ConversationWithDetails[] | undefined) => {
            if (!oldData) return oldData;
            return oldData.map((conv) =>
              conv.id === conversationId
                ? {
                    ...conv,
                    lastMessage: payload.message,
                    unreadCount: (conv.unreadCount || 0) + 1,
                  }
                : conv
            );
          });
        }
      }
    });

    return unsubscribe;
  }, [onMessage, currentUser.id, selectedConversationId]);

  const formatUnreadCount = (count: number): string => {
    if (count > 99) return "99+";
    return count.toString();
  };

  const filteredConversations = conversations?.filter((conv) => {
    if (!searchQuery) return true;
    const searchLower = searchQuery.toLowerCase();
    
    if (conv.type === "group") {
      return conv.name?.toLowerCase().includes(searchLower);
    }
    
    const otherParticipant = conv.participants.find(
      (p) => p.user.id !== currentUser.id
    )?.user;
    const fullName = `${otherParticipant?.firstName || ""} ${otherParticipant?.lastName || ""}`.toLowerCase();
    return fullName.includes(searchLower);
  });

  const getConversationDisplay = (conversation: ConversationWithDetails) => {
    if (conversation.type === "group") {
      return {
        name: conversation.name || "Unnamed Group",
        avatar: null,
        isGroup: true,
      };
    }
    
    const otherParticipant = conversation.participants.find(
      (p) => p.user.id !== currentUser.id
    )?.user;
    
    return {
      name: otherParticipant
        ? `${otherParticipant.firstName || ""} ${otherParticipant.lastName || ""}`.trim() || "Unknown"
        : "Unknown",
      avatar: otherParticipant,
      isGroup: false,
    };
  };

  const isTyping = (conversation: ConversationWithDetails) => {
    return conversation.participants.some(
      (p) => p.userId !== currentUser.id && p.isTyping
    );
  };

  const getMessagePreview = (conversation: ConversationWithDetails) => {
    const currentParticipant = conversation.participants.find(
      (p) => p.userId === currentUser.id
    );
    const draftContent = currentParticipant?.draftContent;
    
    if (draftContent) {
      return {
        type: "draft" as const,
        content: draftContent,
      };
    }
    
    if (conversation.lastMessage) {
      return {
        type: "message" as const,
        content: conversation.lastMessage.content,
      };
    }
    
    return {
      type: "empty" as const,
      content: null,
    };
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-lg" data-testid="text-conversations-title">Messages</h2>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onNewConversation}
              data-testid="button-new-conversation"
            >
              <MessageCircle className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onNewGroup}
              data-testid="button-new-group"
            >
              <Users className="h-5 w-5" />
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search conversations..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="input-search-conversations"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            ))
          ) : filteredConversations?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm" data-testid="text-no-conversations">
                {searchQuery ? "No conversations found" : "No conversations yet"}
              </p>
              <Button
                variant="link"
                className="mt-2"
                onClick={onNewConversation}
                data-testid="button-start-conversation"
              >
                Start a conversation
              </Button>
            </div>
          ) : (
            filteredConversations?.map((conversation) => {
              const display = getConversationDisplay(conversation);
              const isSelected = selectedConversationId === conversation.id;
              const typing = isTyping(conversation);

              return (
                <button
                  key={conversation.id}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors hover-elevate",
                    isSelected && "bg-accent"
                  )}
                  onClick={() => onSelectConversation(conversation.id)}
                  data-testid={`conversation-item-${conversation.id}`}
                >
                  {display.isGroup ? (
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Users className="h-5 w-5 text-primary" />
                    </div>
                  ) : display.avatar ? (
                    <UserAvatar user={display.avatar} showStatus size="md" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-muted" />
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate" data-testid={`text-conversation-name-${conversation.id}`}>
                        {display.name}
                      </span>
                      {conversation.lastMessage && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {formatDistanceToNow(new Date(conversation.lastMessage.createdAt!), { addSuffix: false })}
                        </span>
                      )}
                    </div>
                    
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      {typing ? (
                        <div className="flex items-center gap-1.5">
                          <TypingIndicator />
                          <span className="text-xs text-muted-foreground">typing...</span>
                        </div>
                      ) : (() => {
                        const preview = getMessagePreview(conversation);
                        
                        if (preview.type === "draft") {
                          return (
                            <p 
                              className="text-sm truncate italic text-amber-600 dark:text-amber-500" 
                              data-testid={`text-draft-${conversation.id}`}
                            >
                              Draft: {preview.content}
                            </p>
                          );
                        }
                        
                        if (preview.type === "message") {
                          return (
                            <p className="text-sm text-muted-foreground truncate" data-testid={`text-last-message-${conversation.id}`}>
                              {preview.content}
                            </p>
                          );
                        }
                        
                        return <p className="text-sm text-muted-foreground italic">No messages yet</p>;
                      })()}
                      
                      {(conversation.unreadCount ?? 0) > 0 && (
                        <Badge 
                          variant="destructive" 
                          className="shrink-0 min-w-5 h-5 px-1.5 text-xs rounded-full flex items-center justify-center" 
                          data-testid={`badge-unread-${conversation.id}`}
                        >
                          {formatUnreadCount(conversation.unreadCount!)}
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
