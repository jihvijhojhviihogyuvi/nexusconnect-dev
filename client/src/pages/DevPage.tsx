import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, ShieldOff, Trash2 } from "lucide-react";

async function fetchJson(url: string, opts: RequestInit = {}) {
  const res = await fetch(url, { credentials: "include", ...opts });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function DevPage() {
  const queryClient = useQueryClient();

  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => fetchJson("/api/admin/users"),
    retry: false,
  });

  const { data: convs, isLoading: convsLoading } = useQuery({
    queryKey: ["admin-convs"],
    queryFn: () => fetchJson("/api/admin/conversations"),
    retry: false,
  });

  const toggleAdminMutation = useMutation({
    mutationFn: async ({ userId, isAdmin }: { userId: string; isAdmin: boolean }) => {
      const res = await fetch(`/api/admin/users/${userId}/admin`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isAdmin }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-convs"] });
    },
  });

  const handleDeleteUser = (id: string) => {
    if (!confirm("Delete user and anonymize their account? This cannot be undone via the UI.")) return;
    deleteUserMutation.mutate(id);
  };

  const handleToggleAdmin = (userId: string, currentStatus: boolean) => {
    toggleAdminMutation.mutate({ userId, isAdmin: !currentStatus });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6" data-testid="text-dev-console-title">Dev Console</h1>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3">Users</h2>
        {usersLoading ? (
          <p className="text-muted-foreground">Loading users...</p>
        ) : (
          <div className="space-y-2">
            {users?.length ? (
              users.map((u: any) => (
                <div 
                  key={u.id} 
                  className="flex items-center justify-between gap-4 p-3 border rounded-md"
                  data-testid={`row-user-${u.id}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium" data-testid={`text-username-${u.id}`}>{u.username}</span>
                        {u.isAdmin && (
                          <Badge variant="default" className="text-xs" data-testid={`badge-admin-${u.id}`}>
                            Admin
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground truncate" data-testid={`text-email-${u.id}`}>
                        {u.email || "No email"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant={u.isAdmin ? "outline" : "secondary"}
                      size="sm"
                      onClick={() => handleToggleAdmin(u.id, u.isAdmin)}
                      disabled={toggleAdminMutation.isPending}
                      data-testid={`button-toggle-admin-${u.id}`}
                    >
                      {u.isAdmin ? (
                        <>
                          <ShieldOff className="h-4 w-4 mr-1" />
                          Remove Admin
                        </>
                      ) : (
                        <>
                          <Shield className="h-4 w-4 mr-1" />
                          Make Admin
                        </>
                      )}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDeleteUser(u.id)}
                      disabled={deleteUserMutation.isPending}
                      data-testid={`button-delete-user-${u.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">No users found</p>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Conversations</h2>
        {convsLoading ? (
          <p className="text-muted-foreground">Loading conversations...</p>
        ) : (
          <div className="space-y-2">
            {convs?.length ? (
              convs.map((c: any) => (
                <div 
                  key={c.id} 
                  className="p-3 border rounded-md"
                  data-testid={`row-conversation-${c.id}`}
                >
                  <div className="flex justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-medium" data-testid={`text-conv-name-${c.id}`}>
                        {c.name || (c.type === "direct" ? "Direct Message" : "Group Chat")}
                      </div>
                      <div className="text-sm text-muted-foreground truncate" data-testid={`text-conv-id-${c.id}`}>
                        ID: {c.id}
                      </div>
                      <div className="text-sm mt-1" data-testid={`text-conv-participants-${c.id}`}>
                        Participants: {c.participants?.map((p: any) => p.user?.username).filter(Boolean).join(", ") || "None"}
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground shrink-0" data-testid={`text-conv-activity-${c.id}`}>
                      Last activity: {c.lastActivityAt ? new Date(c.lastActivityAt).toLocaleString() : "Never"}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">No conversations found</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
