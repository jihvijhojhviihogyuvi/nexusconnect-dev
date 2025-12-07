import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Share2, Users, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { UserAvatar } from "./UserAvatar";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { ConversationWithDetails, MessageWithSender, User } from "@shared/schema";

interface ForwardMessageDialogProps {
  isOpen: boolean;
  onClose: () => void;
  message: MessageWithSender | null;
  currentConversationId: string;
  currentUser: User;
}

export function ForwardMessageDialog({
  isOpen,
  onClose,
  message,
  currentConversationId,
  currentUser,
}: ForwardMessageDialogProps) {
  const { toast } = useToast();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

  const { data: conversations, isLoading } = useQuery<ConversationWithDetails[]>({
    queryKey: ["/api/conversations"],
    enabled: isOpen,
  });

  const forwardMutation = useMutation({
    mutationFn: async ({ messageId, toConversationId }: { messageId: string; toConversationId: string }) => {
      const response = await apiRequest("POST", `/api/messages/${messageId}/forward`, {
        toConversationId,
      });
      return response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", variables.toConversationId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({
        title: "Message forwarded",
        description: "The message has been forwarded successfully.",
      });
      onClose();
      setSelectedConversationId(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to forward message",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleForward = () => {
    if (!message || !selectedConversationId) return;
    forwardMutation.mutate({
      messageId: message.id,
      toConversationId: selectedConversationId,
    });
  };

  const handleClose = () => {
    onClose();
    setSelectedConversationId(null);
  };

  const filteredConversations = conversations?.filter(
    (conv) => conv.id !== currentConversationId
  );

  const getConversationDisplayInfo = (conversation: ConversationWithDetails) => {
    if (conversation.type === "group") {
      return {
        name: conversation.name || "Unnamed Group",
        isGroup: true,
        avatar: null,
      };
    }

    const otherParticipant = conversation.participants.find(
      (p) => p.user.id !== currentUser.id
    )?.user;

    return {
      name: otherParticipant
        ? `${otherParticipant.firstName || ""} ${otherParticipant.lastName || ""}`.trim() || otherParticipant.username
        : "Unknown",
      isGroup: false,
      avatar: otherParticipant || null,
    };
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Forward Message
          </DialogTitle>
          <DialogDescription>
            Select a conversation to forward this message to.
          </DialogDescription>
        </DialogHeader>

        {message && (
          <div className="bg-muted rounded-lg p-3 text-sm">
            <p className="text-muted-foreground text-xs mb-1">
              Original message from {message.sender.firstName} {message.sender.lastName}:
            </p>
            <p className="line-clamp-3">{message.content}</p>
          </div>
        )}

        <ScrollArea className="max-h-64">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredConversations?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm" data-testid="text-no-conversations">No other conversations available.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredConversations?.map((conversation) => {
                const displayInfo = getConversationDisplayInfo(conversation);
                const isSelected = selectedConversationId === conversation.id;

                return (
                  <button
                    key={conversation.id}
                    onClick={() => setSelectedConversationId(conversation.id)}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors",
                      isSelected
                        ? "bg-primary/10 border border-primary/20"
                        : "hover-elevate"
                    )}
                    data-testid={`button-forward-to-${conversation.id}`}
                  >
                    {displayInfo.isGroup ? (
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Users className="h-5 w-5 text-primary" />
                      </div>
                    ) : displayInfo.avatar ? (
                      <UserAvatar user={displayInfo.avatar} size="md" />
                    ) : (
                      <div className="h-10 w-10 rounded-full bg-muted shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate" data-testid={`text-conversation-name-${conversation.id}`}>
                        {displayInfo.name}
                      </p>
                      {displayInfo.isGroup && (
                        <p className="text-xs text-muted-foreground">
                          {conversation.participants.length} members
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose} data-testid="button-cancel-forward">
            Cancel
          </Button>
          <Button
            onClick={handleForward}
            disabled={!selectedConversationId || forwardMutation.isPending}
            data-testid="button-confirm-forward"
          >
            {forwardMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Forward
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
