import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Paperclip, X, Image as ImageIcon, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmojiPicker } from "./EmojiPicker";
import { UserAvatar } from "./UserAvatar";
import { cn } from "@/lib/utils";
import type { MessageWithSender, User } from "@shared/schema";

interface MessageInputProps {
  conversationId: string;
  onSend: (content: string, attachments?: File[], replyToId?: string) => void;
  onTyping: (isTyping: boolean) => void;
  replyingTo?: MessageWithSender | null;
  onCancelReply?: () => void;
  disabled?: boolean;
  participants?: User[];
}

export function MessageInput({
  conversationId,
  onSend,
  onTyping,
  replyingTo,
  onCancelReply,
  disabled = false,
  participants = [],
}: MessageInputProps) {
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState<string[]>([]);
  const [draftSaved, setDraftSaved] = useState(false);
  const [showMentionPopup, setShowMentionPopup] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStartPos, setMentionStartPos] = useState(0);
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout>();
  const draftTimeoutRef = useRef<NodeJS.Timeout>();
  const lastConversationIdRef = useRef<string | null>(null);
  const mentionPopupRef = useRef<HTMLDivElement>(null);

  const loadDraft = useCallback(async (convId: string) => {
    try {
      const response = await fetch(`/api/conversations/${convId}/draft`, {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        if (data.content) {
          setContent(data.content);
        }
      }
    } catch (error) {
      console.error("Failed to load draft:", error);
    }
  }, []);

  const saveDraft = useCallback(async (convId: string, draftContent: string) => {
    try {
      await fetch(`/api/conversations/${convId}/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draftContent }),
        credentials: "include",
      });
      setDraftSaved(true);
      setTimeout(() => setDraftSaved(false), 2000);
    } catch (error) {
      console.error("Failed to save draft:", error);
    }
  }, []);

  const clearDraft = useCallback(async (convId: string) => {
    try {
      await fetch(`/api/conversations/${convId}/draft`, {
        method: "DELETE",
        credentials: "include",
      });
    } catch (error) {
      console.error("Failed to clear draft:", error);
    }
  }, []);

  useEffect(() => {
    if (conversationId && conversationId !== lastConversationIdRef.current) {
      lastConversationIdRef.current = conversationId;
      setContent("");
      setDraftSaved(false);
      loadDraft(conversationId);
    }
  }, [conversationId, loadDraft]);

  useEffect(() => {
    if (replyingTo && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [replyingTo]);

  useEffect(() => {
    return () => {
      attachmentPreviews.forEach((preview) => URL.revokeObjectURL(preview));
    };
  }, [attachmentPreviews]);

  const filteredParticipants = participants.filter((user) => {
    if (!mentionQuery) return true;
    const query = mentionQuery.toLowerCase();
    return (
      user.username?.toLowerCase().includes(query) ||
      user.firstName?.toLowerCase().includes(query) ||
      user.lastName?.toLowerCase().includes(query)
    );
  });

  useEffect(() => {
    setSelectedMentionIndex(0);
  }, [mentionQuery]);

  const handleContentChange = (value: string) => {
    setContent(value);

    const textarea = textareaRef.current;
    if (textarea) {
      const cursorPos = textarea.selectionStart;
      const textBeforeCursor = value.slice(0, cursorPos);
      const mentionMatch = textBeforeCursor.match(/@(\w*)$/);

      if (mentionMatch) {
        setShowMentionPopup(true);
        setMentionQuery(mentionMatch[1]);
        setMentionStartPos(cursorPos - mentionMatch[0].length);
      } else {
        setShowMentionPopup(false);
        setMentionQuery("");
      }
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    if (value.trim()) {
      onTyping(true);
      typingTimeoutRef.current = setTimeout(() => {
        onTyping(false);
      }, 2000);
    } else {
      onTyping(false);
    }

    if (draftTimeoutRef.current) {
      clearTimeout(draftTimeoutRef.current);
    }

    if (value.trim()) {
      draftTimeoutRef.current = setTimeout(() => {
        saveDraft(conversationId, value);
      }, 500);
    }
  };

  const insertMention = (user: User) => {
    const username = user.username || `${user.firstName}${user.lastName}`.replace(/\s/g, "");
    const beforeMention = content.slice(0, mentionStartPos);
    const afterMention = content.slice(textareaRef.current?.selectionStart || mentionStartPos);
    const newContent = `${beforeMention}@${username} ${afterMention}`;
    setContent(newContent);
    setShowMentionPopup(false);
    setMentionQuery("");

    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = mentionStartPos + username.length + 2;
        textareaRef.current.selectionStart = newPos;
        textareaRef.current.selectionEnd = newPos;
        textareaRef.current.focus();
      }
    }, 0);
  };

  const handleSubmit = () => {
    if (!content.trim() && attachments.length === 0) return;

    onSend(content.trim(), attachments, replyingTo?.id);
    setContent("");
    setAttachments([]);
    setAttachmentPreviews([]);
    onCancelReply?.();
    onTyping(false);
    setShowMentionPopup(false);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    if (draftTimeoutRef.current) {
      clearTimeout(draftTimeoutRef.current);
    }

    clearDraft(conversationId);
    setDraftSaved(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMentionPopup && filteredParticipants.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedMentionIndex((prev) =>
          prev < filteredParticipants.length - 1 ? prev + 1 : prev
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedMentionIndex((prev) => (prev > 0 ? prev - 1 : prev));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredParticipants[selectedMentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowMentionPopup(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    setAttachments((prev) => [...prev, ...imageFiles]);

    const previews = imageFiles.map((file) => URL.createObjectURL(file));
    setAttachmentPreviews((prev) => [...prev, ...previews]);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (index: number) => {
    URL.revokeObjectURL(attachmentPreviews[index]);
    setAttachments((prev) => prev.filter((_, i) => i !== index));
    setAttachmentPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleEmojiSelect = (emoji: string) => {
    const textarea = textareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = content.slice(0, start) + emoji + content.slice(end);
      setContent(newContent);
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
        textarea.focus();
      }, 0);
    } else {
      setContent((prev) => prev + emoji);
    }
  };

  return (
    <div className="border-t bg-background p-4">
      {replyingTo && (
        <div className="flex items-center justify-between gap-2 mb-2 p-2 bg-muted rounded-lg">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">
              Replying to {replyingTo.sender.firstName} {replyingTo.sender.lastName}
            </p>
            <p className="text-sm truncate">{replyingTo.content}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-7 w-7"
            onClick={onCancelReply}
            data-testid="button-cancel-reply"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {attachmentPreviews.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {attachmentPreviews.map((preview, index) => (
            <div key={index} className="relative group">
              <img
                src={preview}
                alt={`Attachment ${index + 1}`}
                className="h-16 w-16 object-cover rounded-lg"
              />
              <button
                className="absolute -top-1 -right-1 h-5 w-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => removeAttachment(index)}
                data-testid={`button-remove-attachment-${index}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
        />
        
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          data-testid="button-attach-file"
        >
          <ImageIcon className="h-5 w-5 text-muted-foreground" />
        </Button>

        <EmojiPicker onEmojiSelect={handleEmojiSelect} />

        <div className="flex-1 relative">
          {showMentionPopup && filteredParticipants.length > 0 && (
            <div
              ref={mentionPopupRef}
              className="absolute bottom-full left-0 mb-1 w-64 max-h-48 overflow-y-auto bg-popover border rounded-md shadow-lg z-50"
              data-testid="mention-autocomplete-popup"
            >
              {filteredParticipants.map((user, index) => (
                <button
                  key={user.id}
                  className={cn(
                    "flex items-center gap-2 w-full px-3 py-2 text-left text-sm",
                    index === selectedMentionIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  )}
                  onClick={() => insertMention(user)}
                  data-testid={`mention-option-${user.id}`}
                >
                  <UserAvatar user={user} size="xs" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {user.firstName} {user.lastName}
                    </p>
                    {user.username && (
                      <p className="text-xs text-muted-foreground truncate">
                        @{user.username}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
          <Textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="min-h-[44px] max-h-32 resize-none pr-12"
            disabled={disabled}
            rows={1}
            data-testid="input-message"
          />
        </div>

        <Button
          size="icon"
          onClick={handleSubmit}
          disabled={disabled || (!content.trim() && attachments.length === 0)}
          data-testid="button-send-message"
        >
          <Send className="h-5 w-5" />
        </Button>
      </div>

      {draftSaved && (
        <div 
          className="flex items-center gap-1 mt-1 text-xs text-muted-foreground"
          data-testid="text-draft-saved"
        >
          <Check className="h-3 w-3" />
          <span>Draft saved</span>
        </div>
      )}
    </div>
  );
}
