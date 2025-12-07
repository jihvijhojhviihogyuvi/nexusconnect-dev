import { useState } from "react";
import { Check, CheckCheck, MoreHorizontal, Reply, Trash2, Edit2, Share2, Pin, Eye, ThumbsUp, Heart, Laugh, Meh, Frown, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { UserAvatar } from "./UserAvatar";
import { cn } from "@/lib/utils";
import type { MessageWithSender, User } from "@shared/schema";
import { format } from "date-fns";

const QUICK_REACTIONS = [
  { emoji: "👍", icon: ThumbsUp, label: "Like" },
  { emoji: "❤️", icon: Heart, label: "Love" },
  { emoji: "😂", icon: Laugh, label: "Haha" },
  { emoji: "😮", icon: Meh, label: "Wow" },
  { emoji: "😢", icon: Frown, label: "Sad" },
];

interface MessageBubbleProps {
  message: MessageWithSender;
  isOwnMessage: boolean;
  showAvatar?: boolean;
  showSenderName?: boolean;
  onReply?: (message: MessageWithSender) => void;
  onEdit?: (message: MessageWithSender) => void;
  onDelete?: (messageId: string) => void;
  onForward?: (message: MessageWithSender) => void;
  onPin?: (message: MessageWithSender) => void;
  onReaction?: (messageId: string, emoji: string, hasReacted: boolean) => void;
  canPin?: boolean;
  isAdmin?: boolean;
}

function renderContentWithMentions(content: string, isOwnMessage: boolean) {
  const mentionRegex = /@(\w+)/g;
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let match;

  while ((match = mentionRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    const username = match[1];
    parts.push(
      <span
        key={match.index}
        className={cn(
          "font-medium rounded px-0.5",
          isOwnMessage
            ? "bg-primary-foreground/20 text-primary-foreground"
            : "bg-primary/20 text-primary"
        )}
        data-testid={`mention-${username}`}
      >
        @{username}
      </span>
    );
    lastIndex = mentionRegex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts.length > 0 ? parts : content;
}

function getReactionIcon(emoji: string) {
  const reaction = QUICK_REACTIONS.find((r) => r.emoji === emoji);
  if (reaction) {
    const IconComponent = reaction.icon;
    return <IconComponent className="h-3 w-3" />;
  }
  return <span className="text-xs">{emoji}</span>;
}

export function MessageBubble({
  message,
  isOwnMessage,
  showAvatar = true,
  showSenderName = false,
  onReply,
  onEdit,
  onDelete,
  onForward,
  onPin,
  onReaction,
  canPin = true,
  isAdmin = false,
}: MessageBubbleProps) {
  const [showActions, setShowActions] = useState(false);

  const renderAttachments = () => {
    if (!message.attachments?.length) return null;

    return (
      <div className="mt-2 space-y-2">
        {message.attachments.map((attachment, index) => {
          if (attachment.type.startsWith("image/")) {
            return (
              <img
                key={index}
                src={attachment.url}
                alt={attachment.name}
                className="max-w-xs rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                data-testid={`image-attachment-${index}`}
              />
            );
          }
          return (
            <a
              key={index}
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 p-2 bg-background/50 rounded-lg hover:bg-background/80 transition-colors"
              data-testid={`file-attachment-${index}`}
            >
              <span className="text-sm truncate">{attachment.name}</span>
              {attachment.size && (
                <span className="text-xs text-muted-foreground">
                  ({(attachment.size / 1024).toFixed(1)} KB)
                </span>
              )}
            </a>
          );
        })}
      </div>
    );
  };

  const renderReplyPreview = () => {
    if (!message.replyTo) return null;

    return (
      <div className="mb-2 pl-3 border-l-2 border-primary/50 opacity-70">
        <p className="text-xs font-medium">
          {message.replyTo.sender.firstName} {message.replyTo.sender.lastName}
        </p>
        <p className="text-xs truncate max-w-48">{message.replyTo.content}</p>
      </div>
    );
  };

  const renderForwardedIndicator = () => {
    if (!message.forwardedFrom) return null;

    const forwardedSender = message.forwardedFrom.sender;
    const senderName = `${forwardedSender.firstName || ""} ${forwardedSender.lastName || ""}`.trim() || forwardedSender.username;

    return (
      <div 
        className={cn(
          "flex items-center gap-1.5 mb-1.5 text-[11px]",
          isOwnMessage ? "text-primary-foreground/70" : "text-muted-foreground"
        )}
        data-testid={`text-forwarded-indicator-${message.id}`}
      >
        <Share2 className="h-3 w-3" />
        <span>Forwarded from {senderName}</span>
      </div>
    );
  };

  const renderStatus = () => {
    if (!isOwnMessage) return null;

    const hasReadReceipts = message.readBy && message.readBy.length > 0;
    const readCount = message.readBy?.length || 0;

    if (hasReadReceipts) {
      return (
        <HoverCard openDelay={200} closeDelay={100}>
          <HoverCardTrigger asChild>
            <button 
              className="flex items-center gap-1 cursor-pointer"
              data-testid={`button-read-receipts-${message.id}`}
            >
              <CheckCheck className="h-3.5 w-3.5 text-primary" />
              {readCount > 0 && (
                <span className={cn(
                  "text-[10px]",
                  isOwnMessage ? "text-primary-foreground/70" : "text-muted-foreground"
                )}>
                  {readCount}
                </span>
              )}
            </button>
          </HoverCardTrigger>
          <HoverCardContent 
            className="w-64 p-3" 
            align="end"
            data-testid={`read-receipts-popup-${message.id}`}
          >
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Eye className="h-4 w-4 text-muted-foreground" />
                <span>Read by {readCount}</span>
              </div>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {message.readBy?.map((receipt) => (
                  <div 
                    key={receipt.user.id} 
                    className="flex items-center gap-2"
                    data-testid={`read-receipt-user-${receipt.user.id}`}
                  >
                    <UserAvatar user={receipt.user} size="xs" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">
                        {receipt.user.firstName} {receipt.user.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(receipt.readAt), "MMM d, HH:mm")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </HoverCardContent>
        </HoverCard>
      );
    }

    return (
      <span className="text-muted-foreground/70">
        {message.status === "delivered" ? (
          <CheckCheck className="h-3.5 w-3.5" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
      </span>
    );
  };

  const renderReactionsDisplay = () => {
    if (!message.reactions?.length) return null;

    return (
      <div 
        className="flex flex-wrap gap-1 mt-2"
        data-testid={`reactions-display-${message.id}`}
      >
        {message.reactions.map((reaction) => (
          <button
            key={reaction.emoji}
            onClick={() => onReaction?.(message.id, reaction.emoji, reaction.userReacted)}
            className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs hover-elevate transition-colors",
              isOwnMessage
                ? reaction.userReacted
                  ? "bg-primary-foreground/30"
                  : "bg-primary-foreground/15"
                : reaction.userReacted
                  ? "bg-primary/20"
                  : "bg-background/50"
            )}
            data-testid={`reaction-pill-${reaction.emoji}-${message.id}`}
          >
            {getReactionIcon(reaction.emoji)}
            <span className={cn(
              "text-[10px] font-medium",
              isOwnMessage ? "text-primary-foreground" : "text-foreground"
            )}>
              {reaction.count}
            </span>
          </button>
        ))}
      </div>
    );
  };

  if (message.messageType === "system") {
    return (
      <div className="flex justify-center py-2">
        <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full" data-testid={`system-message-${message.id}`}>
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex gap-2 group relative",
        isOwnMessage ? "flex-row-reverse" : "flex-row"
      )}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      data-testid={`message-bubble-${message.id}`}
    >
      {showAvatar && !isOwnMessage ? (
        <UserAvatar user={message.sender} size="sm" />
      ) : (
        <div className="w-8 shrink-0" />
      )}

      <div
        className={cn(
          "max-w-[70%] rounded-2xl px-4 py-2",
          isOwnMessage
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted rounded-tl-sm"
        )}
      >
        {showSenderName && !isOwnMessage && (
          <p className="text-xs font-medium mb-1 opacity-80 flex items-center gap-1" data-testid={`text-sender-name-${message.id}`}>
            {message.sender.firstName} {message.sender.lastName}
            {message.sender.isAdmin && (
              <span className="inline-flex items-center gap-0.5 text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full" data-testid={`badge-admin-${message.sender.id}`}>
                <Shield className="h-2.5 w-2.5" />
                Admin
              </span>
            )}
          </p>
        )}

        {renderForwardedIndicator()}
        {renderReplyPreview()}

        {message.content && (
          <p className="text-sm whitespace-pre-wrap break-words" data-testid={`text-message-content-${message.id}`}>
            {renderContentWithMentions(message.content, isOwnMessage)}
          </p>
        )}

        {renderAttachments()}

        <div className={cn(
          "flex items-center gap-1.5 mt-1",
          isOwnMessage ? "justify-end" : "justify-start"
        )}>
          {message.isPinned && (
            <Pin className={cn(
              "h-3 w-3",
              isOwnMessage ? "text-primary-foreground/70" : "text-muted-foreground"
            )} data-testid={`icon-pinned-${message.id}`} />
          )}
          <span className={cn(
            "text-[10px]",
            isOwnMessage ? "text-primary-foreground/70" : "text-muted-foreground"
          )} data-testid={`text-message-time-${message.id}`}>
            {format(new Date(message.createdAt!), "HH:mm")}
          </span>
          {message.editedAt && (
            <span className={cn(
              "text-[10px]",
              isOwnMessage ? "text-primary-foreground/70" : "text-muted-foreground"
            )}>
              (edited)
            </span>
          )}
          {renderStatus()}
        </div>

        {renderReactionsDisplay()}
      </div>

      <div
        className={cn(
          "absolute top-0 flex items-center gap-0.5 transition-opacity",
          isOwnMessage ? "left-0" : "right-0",
          showActions ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        style={{ visibility: showActions ? "visible" : "hidden" }}
      >
        {QUICK_REACTIONS.map((reaction) => {
          const IconComponent = reaction.icon;
          const existingReaction = message.reactions?.find((r) => r.emoji === reaction.emoji);
          const hasReacted = existingReaction?.userReacted || false;
          return (
            <Button
              key={reaction.emoji}
              variant="ghost"
              size="icon"
              className={cn("h-7 w-7", hasReacted && "text-primary")}
              onClick={() => onReaction?.(message.id, reaction.emoji, hasReacted)}
              data-testid={`button-reaction-${reaction.emoji}`}
            >
              <IconComponent className="h-3.5 w-3.5" />
            </Button>
          );
        })}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onReply?.(message)}
          data-testid={`button-reply-${message.id}`}
        >
          <Reply className="h-3.5 w-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-message-actions-${message.id}`}>
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={isOwnMessage ? "start" : "end"}>
            <DropdownMenuItem onClick={() => onReply?.(message)} data-testid={`menu-reply-${message.id}`}>
              <Reply className="h-4 w-4 mr-2" />
              Reply
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onForward?.(message)} data-testid={`menu-forward-${message.id}`}>
              <Share2 className="h-4 w-4 mr-2" />
              Forward
            </DropdownMenuItem>
            {(canPin || isAdmin) && (
              <DropdownMenuItem onClick={() => onPin?.(message)} data-testid={`menu-pin-${message.id}`}>
                <Pin className="h-4 w-4 mr-2" />
                {message.isPinned ? "Unpin" : "Pin"}
              </DropdownMenuItem>
            )}
            {(isOwnMessage || isAdmin) && (
              <>
                <DropdownMenuItem onClick={() => onEdit?.(message)} data-testid={`menu-edit-${message.id}`}>
                  <Edit2 className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDelete?.(message.id)}
                  className="text-destructive focus:text-destructive"
                  data-testid={`menu-delete-${message.id}`}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
