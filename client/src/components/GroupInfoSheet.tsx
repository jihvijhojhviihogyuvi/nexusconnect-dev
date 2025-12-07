import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Users, Crown, Shield, MoreVertical, UserPlus, LogOut, Edit2, Link, Copy, Check, Trash2, X } from "lucide-react";
import { useSocket } from "@/contexts/SocketContext";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { UserAvatar } from "./UserAvatar";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ConversationWithDetails, User, ConversationInviteLink } from "@shared/schema";
import { format } from "date-fns";

interface GroupInfoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: ConversationWithDetails;
  currentUser: User;
}

export function GroupInfoSheet({
  open,
  onOpenChange,
  conversation,
  currentUser,
}: GroupInfoSheetProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(conversation.name || "");
  const [editDescription, setEditDescription] = useState(conversation.description || "");
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [showInviteLinks, setShowInviteLinks] = useState(false);
  const { toast } = useToast();

  const currentParticipant = conversation.participants.find(
    (p) => p.userId === currentUser.id
  );
  const isGroupAdmin = currentParticipant?.role === "owner" || currentParticipant?.role === "admin";
  const isAppAdmin = currentUser.isAdmin === true;
  const isAdmin = isGroupAdmin || isAppAdmin;

  const { data: inviteLinks = [], refetch: refetchInviteLinks } = useQuery<ConversationInviteLink[]>({
    queryKey: ["/api/conversations", conversation.id, "invite-links"],
    enabled: open && showInviteLinks && isAdmin,
  });

  const updateGroupMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/conversations/${conversation.id}`, {
        name: editName,
        description: editDescription,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversation.id] });
      setIsEditing(false);
    },
  });

  const leaveGroupMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/conversations/${conversation.id}/participants/${currentUser.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      onOpenChange(false);
    },
  });

  const removeParticipantMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("DELETE", `/api/conversations/${conversation.id}/participants/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversation.id] });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      await apiRequest("PATCH", `/api/conversations/${conversation.id}/participants/${userId}/role`, {
        role,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversation.id] });
    },
  });

  const createInviteLinkMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/conversations/${conversation.id}/invite-links`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversation.id, "invite-links"] });
      toast({
        title: "Invite link created",
        description: "The invite link has been created successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create invite link.",
        variant: "destructive",
      });
    },
  });

  const deactivateInviteLinkMutation = useMutation({
    mutationFn: async (linkId: string) => {
      await apiRequest("DELETE", `/api/invite-links/${linkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversation.id, "invite-links"] });
      toast({
        title: "Invite link deactivated",
        description: "The invite link has been deactivated.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to deactivate invite link.",
        variant: "destructive",
      });
    },
  });

  const { onMessage } = useSocket();

  useEffect(() => {
    const unsubscribe = onMessage((type, payload) => {
      if (type === "participant-role-changed" && payload.conversationId === conversation.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversation.id] });
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      }
      if (type === "participant-kicked" && payload.conversationId === conversation.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversation.id] });
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
        if (payload.userId === currentUser.id) {
          onOpenChange(false);
        }
      }
      if (type === "new-participant" && payload.conversationId === conversation.id) {
        queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversation.id] });
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      }
    });

    return unsubscribe;
  }, [onMessage, conversation.id, currentUser.id, onOpenChange]);

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "owner":
        return (
          <Badge variant="default" className="gap-1" data-testid="badge-owner">
            <Crown className="h-3 w-3" />
            Owner
          </Badge>
        );
      case "admin":
        return (
          <Badge variant="secondary" className="gap-1" data-testid="badge-admin">
            <Shield className="h-3 w-3" />
            Admin
          </Badge>
        );
      default:
        return null;
    }
  };

  const copyInviteLink = async (link: ConversationInviteLink) => {
    const url = `${window.location.origin}/join/${link.token}`;
    await navigator.clipboard.writeText(url);
    setCopiedLinkId(link.id);
    setTimeout(() => setCopiedLinkId(null), 2000);
    toast({
      title: "Link copied",
      description: "Invite link copied to clipboard.",
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent data-testid="group-info-sheet">
        <SheetHeader>
          <div className="flex items-center justify-between gap-2">
            <SheetTitle>Group Info</SheetTitle>
            {isAdmin && !isEditing && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsEditing(true)}
                data-testid="button-edit-group"
              >
                <Edit2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="flex flex-col items-center gap-4">
            <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
              <Users className="h-10 w-10 text-primary" />
            </div>

            {isEditing ? (
              <div className="w-full space-y-4">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Group name"
                  data-testid="input-edit-group-name"
                />
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Group description"
                  className="resize-none"
                  rows={2}
                  data-testid="input-edit-group-description"
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setIsEditing(false);
                      setEditName(conversation.name || "");
                      setEditDescription(conversation.description || "");
                    }}
                    data-testid="button-cancel-edit"
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => updateGroupMutation.mutate()}
                    disabled={updateGroupMutation.isPending}
                    data-testid="button-save-edit"
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <h3 className="text-xl font-semibold" data-testid="text-group-name">
                  {conversation.name || "Unnamed Group"}
                </h3>
                {conversation.description && (
                  <p className="text-sm text-muted-foreground text-center" data-testid="text-group-description">
                    {conversation.description}
                  </p>
                )}
              </>
            )}
          </div>

          {isAdmin && (
            <>
              <Separator />
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium flex items-center gap-2">
                    <Link className="h-4 w-4" />
                    Invite Links
                  </h4>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowInviteLinks(!showInviteLinks)}
                      data-testid="button-toggle-invite-links"
                    >
                      {showInviteLinks ? "Hide" : "Show"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => createInviteLinkMutation.mutate()}
                      disabled={createInviteLinkMutation.isPending}
                      data-testid="button-create-invite-link"
                    >
                      Create Link
                    </Button>
                  </div>
                </div>

                {showInviteLinks && (
                  <div className="space-y-2">
                    {inviteLinks.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-invite-links">
                        No active invite links
                      </p>
                    ) : (
                      inviteLinks.map((link) => (
                        <div
                          key={link.id}
                          className="flex items-center justify-between gap-2 p-2 rounded-lg bg-muted/50"
                          data-testid={`invite-link-item-${link.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-mono truncate" data-testid={`text-invite-token-${link.id}`}>
                              {link.token.slice(0, 8)}...
                            </p>
                            <div className="flex gap-2 text-xs text-muted-foreground">
                              {link.useCount !== null && (
                                <span data-testid={`text-use-count-${link.id}`}>
                                  Uses: {link.useCount}{link.maxUses ? `/${link.maxUses}` : ""}
                                </span>
                              )}
                              {link.expiresAt && (
                                <span data-testid={`text-expires-at-${link.id}`}>
                                  Expires: {format(new Date(link.expiresAt), "MMM d")}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => copyInviteLink(link)}
                              data-testid={`button-copy-link-${link.id}`}
                            >
                              {copiedLinkId === link.id ? (
                                <Check className="h-4 w-4 text-green-500" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => deactivateInviteLinkMutation.mutate(link.id)}
                              disabled={deactivateInviteLinkMutation.isPending}
                              data-testid={`button-deactivate-link-${link.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          <Separator />

          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium" data-testid="text-members-count">
                Members ({conversation.participants.length})
              </h4>
              {isAdmin && (
                <Button variant="ghost" size="sm" className="gap-1" data-testid="button-add-members">
                  <UserPlus className="h-4 w-4" />
                  Add
                </Button>
              )}
            </div>

            <ScrollArea className="h-48">
              <div className="space-y-2">
                {conversation.participants.map((participant) => (
                  <div
                    key={participant.id}
                    className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-muted"
                    data-testid={`member-item-${participant.userId}`}
                  >
                    <div className="flex items-center gap-3">
                      <UserAvatar user={participant.user} showStatus size="md" />
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">
                            {participant.user.firstName} {participant.user.lastName}
                          </span>
                          {participant.userId === currentUser.id && (
                            <span className="text-xs text-muted-foreground">(You)</span>
                          )}
                          {participant.user.isAdmin && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full" data-testid={`badge-system-admin-${participant.userId}`}>
                              <Shield className="h-2.5 w-2.5" />
                              System Admin
                            </span>
                          )}
                        </div>
                        {getRoleBadge(participant.role || "member")}
                      </div>
                    </div>

                    {(() => {
                      const isOwner = currentParticipant?.role === "owner";
                      const isCurrentGroupAdmin = currentParticipant?.role === "admin";
                      const isParticipantOwner = participant.role === "owner";
                      const isParticipantAdmin = participant.role === "admin";
                      const isParticipantMember = participant.role === "member" || !participant.role;
                      const isSelf = participant.userId === currentUser.id;

                      const ownerCanManage = isOwner && !isSelf && !isParticipantOwner;
                      const groupAdminCanKick = isCurrentGroupAdmin && !isSelf && isParticipantMember;
                      // App-level admins can kick anyone except owners
                      const appAdminCanKick = isAppAdmin && !isSelf && !isParticipantOwner;

                      const showMenu = ownerCanManage || groupAdminCanKick || appAdminCanKick;

                      if (!showMenu) return null;

                      return (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-member-menu-${participant.userId}`}>
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {isOwner && isParticipantMember && (
                              <DropdownMenuItem
                                onClick={() =>
                                  updateRoleMutation.mutate({
                                    userId: participant.userId,
                                    role: "admin",
                                  })
                                }
                                data-testid={`menu-make-admin-${participant.userId}`}
                              >
                                <Shield className="h-4 w-4 mr-2" />
                                Make admin
                              </DropdownMenuItem>
                            )}
                            {isOwner && isParticipantAdmin && (
                              <DropdownMenuItem
                                onClick={() =>
                                  updateRoleMutation.mutate({
                                    userId: participant.userId,
                                    role: "member",
                                  })
                                }
                                data-testid={`menu-remove-admin-${participant.userId}`}
                              >
                                Remove admin
                              </DropdownMenuItem>
                            )}
                            {isOwner && (isParticipantMember || isParticipantAdmin) && (
                              <DropdownMenuSeparator />
                            )}
                            <DropdownMenuItem
                              onClick={() => removeParticipantMutation.mutate(participant.userId)}
                              className="text-destructive focus:text-destructive"
                              data-testid={`menu-remove-member-${participant.userId}`}
                            >
                              Remove from group
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          <Button
            variant="outline"
            className="w-full text-destructive hover:text-destructive"
            onClick={() => leaveGroupMutation.mutate()}
            disabled={leaveGroupMutation.isPending}
            data-testid="button-leave-group"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Leave Group
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
