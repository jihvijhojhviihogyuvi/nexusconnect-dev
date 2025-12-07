import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertMessageSchema, insertConversationSchema, signupSchema, signinSchema } from "@shared/schema";
import multer from "multer";
import path from "path";
import fs from "fs";
import passport from "passport";

// File upload configuration
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

// WebSocket clients map
const clients = new Map<string, WebSocket>();

// Broadcast to specific users
function broadcastToUsers(userIds: string[], type: string, payload: any) {
  userIds.forEach((userId) => {
    const client = clients.get(userId);
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type, payload }));
    }
  });
}

// Broadcast to conversation participants
async function broadcastToConversation(conversationId: string, type: string, payload: any, excludeUserId?: string) {
  const participants = await storage.getParticipants(conversationId);
  const userIds = participants
    .map((p) => p.userId)
    .filter((id) => id !== excludeUserId);
  broadcastToUsers(userIds, type, payload);
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Setup authentication
  await setupAuth(app);

  // Serve uploaded files
  app.use("/uploads", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    next();
  }, express.static(uploadDir));

  // Public auth routes
  app.post("/api/auth/signup", async (req: any, res) => {
    try {
      const { username, password } = signupSchema.parse(req.body);
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already taken" });
      }
      const user = await storage.createUser(username, password);
      req.login({ id: user.id, username: user.username }, (err: Error | null) => {
        if (err) {
          return res.status(500).json({ message: "Login failed" });
        }
        res.status(201).json(user);
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Signup failed" });
    }
  });

  app.post("/api/auth/signin", (req, res, next) => {
    try {
      signinSchema.parse(req.body);
    } catch (error: any) {
      return res.status(400).json({ message: error.message || "Invalid input" });
    }
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) {
        return res.status(500).json({ message: "Authentication error" });
      }
      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid credentials" });
      }
      req.login(user, (err) => {
        if (err) {
          return res.status(500).json({ message: "Login failed" });
        }
        res.json(user);
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logged out" });
    });
  });

  // Protected auth routes
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.patch("/api/auth/user", isAuthenticated, upload.single("avatar"), async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const updates: any = {};

      if (req.body.firstName !== undefined) updates.firstName = req.body.firstName;
      if (req.body.lastName !== undefined) updates.lastName = req.body.lastName;
      if (req.body.username !== undefined) updates.username = req.body.username;
      if (req.body.bio !== undefined) updates.bio = req.body.bio;
      if (req.body.statusMessage !== undefined) updates.statusMessage = req.body.statusMessage;
      if (req.body.status !== undefined) updates.status = req.body.status;
      if (req.body.notificationsEnabled !== undefined) updates.notificationsEnabled = req.body.notificationsEnabled === "true";
      if (req.body.soundEnabled !== undefined) updates.soundEnabled = req.body.soundEnabled === "true";

      if (req.file) {
        updates.profileImageUrl = `/uploads/${req.file.filename}`;
      }

      const user = await storage.updateUser(userId, updates);
      res.json(user);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // User search
  app.get("/api/users", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const query = req.query.query as string || req.query["0"] as string || "";
      
      let users;
      if (query && query.length > 0) {
        users = await storage.searchUsers(query, userId);
      } else {
        users = await storage.getAllUsers(userId);
      }
      res.json(users);
    } catch (error) {
      console.error("Error searching users:", error);
      res.status(500).json({ message: "Failed to search users" });
    }
  });

  // Get messages where current user was mentioned
  app.get("/api/users/mentions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const limit = parseInt(req.query.limit as string) || 50;
      const mentions = await storage.getMentionsForUser(userId, limit);
      res.json(mentions);
    } catch (error) {
      console.error("Error fetching mentions:", error);
      res.status(500).json({ message: "Failed to fetch mentions" });
    }
  });

  // Admin endpoints for dev tools (only allowed in non-production)
  app.get("/api/admin/users", isAuthenticated, async (req: any, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ message: "Not allowed in production" });
    }
    try {
      const users = await storage.getAllUsersAdmin();
      res.json(users);
    } catch (error) {
      console.error("Error fetching admin users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.get("/api/admin/conversations", isAuthenticated, async (req: any, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ message: "Not allowed in production" });
    }
    try {
      const convs = await storage.getAllConversations();
      res.json(convs);
    } catch (error) {
      console.error("Error fetching admin conversations:", error);
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  // Toggle admin status for a user (dev only)
  app.patch("/api/admin/users/:id/admin", isAuthenticated, async (req: any, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ message: "Not allowed in production" });
    }
    try {
      const userId = req.params.id as string;
      const { isAdmin } = req.body;
      
      const updatedUser = await storage.updateUser(userId, { isAdmin });
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating admin status:", error);
      res.status(500).json({ message: "Failed to update admin status" });
    }
  });

  app.delete("/api/admin/users/:id", isAuthenticated, async (req: any, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ message: "Not allowed in production" });
    }
    try {
      const userId = req.params.id as string;

      // Gather conversation ids and remaining participant ids to notify after deletion
      const convs = await storage.getUserConversations(userId);
      const notifyList: { conversationId: string; otherUserIds: string[] }[] = convs.map((c) => ({
        conversationId: c.id,
        otherUserIds: c.participants.map((p) => p.userId).filter((id) => id !== userId),
      }));

      // If user is connected via websocket, close their connection to 'kick' them
      const client = clients.get(userId);
      if (client) {
        try {
          client.close();
        } catch (e) {
          try {
            client.terminate?.();
          } catch {}
        }
        clients.delete(userId);
      }

      // Perform DB deletion (handles dependent rows)
      await storage.deleteUser(userId);

      // Notify remaining participants that conversations were removed/changed
      for (const n of notifyList) {
        if (n.otherUserIds.length > 0) {
          broadcastToUsers(n.otherUserIds, "conversation.deleted", { id: n.conversationId });
        }
      }

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  // Conversation routes
  app.get("/api/conversations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const conversations = await storage.getUserConversations(userId);
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  app.get("/api/conversations/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const conversation = await storage.getConversationWithDetails(req.params.id, userId);
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      res.json(conversation);
    } catch (error) {
      console.error("Error fetching conversation:", error);
      res.status(500).json({ message: "Failed to fetch conversation" });
    }
  });

  app.post("/api/conversations", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const { type, name, description, participantIds } = req.body;

      // For direct conversations, check if one already exists
      if (type === "direct" && participantIds.length === 1) {
        const existingConv = await storage.findDirectConversation(userId, participantIds[0]);
        if (existingConv) {
          const details = await storage.getConversationWithDetails(existingConv.id, userId);
          return res.json(details);
        }
      }

      const conversation = await storage.createConversation(
        { type, name, description },
        participantIds,
        userId
      );

      const details = await storage.getConversationWithDetails(conversation.id, userId);

      // Notify participants
      broadcastToUsers(participantIds, "new-conversation", { conversation: details });

      res.status(201).json(details);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ message: "Failed to create conversation" });
    }
  });

  app.patch("/api/conversations/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const conversationId = req.params.id;
      const { name, description, iconImageUrl } = req.body;

      // Check if user is app-level admin
      const currentUser = await storage.getUser(userId);
      const isAppAdmin = currentUser?.isAdmin === true;

      // Check user has permission to edit (participant with admin/owner role, or app-level admin)
      const isInConv = await storage.isUserInConversation(conversationId, userId);
      if (!isInConv && !isAppAdmin) {
        return res.status(403).json({ message: "Not authorized to edit this conversation" });
      }

      // For group conversations, only group admins/owners or app-level admins can edit
      if (!isAppAdmin) {
        const role = await storage.getParticipantRole(conversationId, userId);
        if (role !== "admin" && role !== "owner") {
          return res.status(403).json({ message: "Only admins can edit conversation details" });
        }
      }

      const conversation = await storage.updateConversation(conversationId, {
        name,
        description,
        iconImageUrl,
      });
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      // Notify participants
      await broadcastToConversation(conversationId, "conversation-updated", { conversation });

      res.json(conversation);
    } catch (error) {
      console.error("Error updating conversation:", error);
      res.status(500).json({ message: "Failed to update conversation" });
    }
  });

  // Participant routes
  app.delete("/api/conversations/:conversationId/participants/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const requesterId = req.user?.id || req.user?.claims?.sub;
      const { conversationId, userId: targetUserId } = req.params;

      // Check if it's a self-leave (user leaving the group themselves)
      if (requesterId === targetUserId) {
        await storage.removeParticipant(conversationId, targetUserId);
        await broadcastToConversation(conversationId, "participant-left", {
          conversationId,
          userId: targetUserId,
        });
        return res.status(204).send();
      }

      // For kicking another user, check permissions
      const requesterRole = await storage.getParticipantRole(conversationId, requesterId);
      const targetRole = await storage.getParticipantRole(conversationId, targetUserId);
      
      // Check if requester is an app-level admin
      const requester = await storage.getUser(requesterId);
      const isAppAdmin = requester?.isAdmin === true;

      if (!requesterRole && !isAppAdmin) {
        return res.status(403).json({ message: "You are not a participant of this conversation" });
      }

      if (!targetRole) {
        return res.status(404).json({ message: "Target user is not a participant" });
      }

      // Owner cannot be kicked (even by app admins)
      if (targetRole === "owner") {
        return res.status(403).json({ message: "Cannot kick the group owner" });
      }

      // Only owner, group admin, or app-level admin can kick members
      if (requesterRole !== "owner" && requesterRole !== "admin" && !isAppAdmin) {
        return res.status(403).json({ message: "Only owners and admins can remove participants" });
      }

      // Group admins can only kick members (not other admins), but app-level admins can kick anyone except owner
      if (requesterRole === "admin" && !isAppAdmin && targetRole === "admin") {
        return res.status(403).json({ message: "Admins cannot kick other admins" });
      }

      await storage.kickParticipant(conversationId, targetUserId);

      // Notify participants about the kick
      await broadcastToConversation(conversationId, "participant-kicked", {
        conversationId,
        userId: targetUserId,
        kickedBy: requesterId,
      });

      // Also notify the kicked user directly
      broadcastToUsers([targetUserId], "participant-kicked", {
        conversationId,
        userId: targetUserId,
        kickedBy: requesterId,
      });

      res.status(204).send();
    } catch (error) {
      console.error("Error removing participant:", error);
      res.status(500).json({ message: "Failed to remove participant" });
    }
  });

  app.patch("/api/conversations/:conversationId/participants/:userId", isAuthenticated, async (req: any, res) => {
    try {
      await storage.updateParticipant(req.params.conversationId, req.params.userId, req.body);
      res.status(204).send();
    } catch (error) {
      console.error("Error updating participant:", error);
      res.status(500).json({ message: "Failed to update participant" });
    }
  });

  // Update participant role (promote/demote)
  app.patch("/api/conversations/:conversationId/participants/:userId/role", isAuthenticated, async (req: any, res) => {
    try {
      const requesterId = req.user?.id || req.user?.claims?.sub;
      const { conversationId, userId: targetUserId } = req.params;
      const { role } = req.body;

      // Validate role
      if (!role || !["admin", "member"].includes(role)) {
        return res.status(400).json({ message: "Invalid role. Must be 'admin' or 'member'" });
      }

      const requesterRole = await storage.getParticipantRole(conversationId, requesterId);
      const targetRole = await storage.getParticipantRole(conversationId, targetUserId);

      if (!requesterRole) {
        return res.status(403).json({ message: "You are not a participant of this conversation" });
      }

      if (!targetRole) {
        return res.status(404).json({ message: "Target user is not a participant" });
      }

      // Cannot change owner's role
      if (targetRole === "owner") {
        return res.status(403).json({ message: "Cannot change the owner's role" });
      }

      // Only owner can promote/demote users
      if (requesterRole !== "owner") {
        return res.status(403).json({ message: "Only the group owner can change roles" });
      }

      await storage.updateParticipantRole(conversationId, targetUserId, role);

      // Get the updated user info for the broadcast
      const targetUser = await storage.getUser(targetUserId);

      // Broadcast role change to all participants
      await broadcastToConversation(conversationId, "participant-role-changed", {
        conversationId,
        userId: targetUserId,
        newRole: role,
        changedBy: requesterId,
        user: targetUser,
      });

      res.status(200).json({ success: true, role });
    } catch (error) {
      console.error("Error updating participant role:", error);
      res.status(500).json({ message: "Failed to update participant role" });
    }
  });

  // Message routes
  app.get("/api/conversations/:id/messages", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const messages = await storage.getConversationMessages(req.params.id, limit, offset);

      // Mark messages as read async (don't await - send response first)
      storage.markMessagesAsRead(req.params.id, userId).catch((err) => console.error("Mark read error:", err));

      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.post("/api/conversations/:id/messages", isAuthenticated, upload.array("attachments", 5), async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const conversationId = req.params.id;
      const { content, replyToId } = req.body;

      const attachments = (req.files as Express.Multer.File[])?.map((file) => ({
        url: `/uploads/${file.filename}`,
        type: file.mimetype,
        name: file.originalname,
        size: file.size,
      }));

      const message = await storage.createMessage({
        conversationId,
        senderId: userId,
        content,
        replyToId,
        attachments: attachments?.length ? attachments : undefined,
        messageType: attachments?.length ? "image" : "text",
      });

      const messageWithSender = await storage.getMessageWithSender(message.id);

      // Extract and store @mentions from content
      if (content) {
        const mentionMatches = content.match(/@(\w+)/g);
        if (mentionMatches) {
          const uniqueUsernames = [...new Set(mentionMatches.map((m: string) => m.slice(1).toLowerCase()))];
          for (const username of uniqueUsernames) {
            const mentionedUser = await storage.getUserByUsername(username);
            if (mentionedUser && mentionedUser.id !== userId) {
              await storage.createMention(message.id, mentionedUser.id);
            }
          }
        }
      }

      // Send response immediately
      res.status(201).json(messageWithSender);

      // Broadcast to conversation participants async (don't wait)
      broadcastToConversation(conversationId, "new-message", {
        conversationId,
        message: messageWithSender,
      }).catch((err) => console.error("Broadcast error:", err));
    } catch (error) {
      console.error("Error creating message:", error);
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  app.patch("/api/messages/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const message = await storage.getMessage(req.params.id);

      if (!message) {
        return res.status(404).json({ message: "Message not found" });
      }

      // Check if user is admin or message owner
      const currentUser = await storage.getUser(userId);
      const isAdmin = currentUser?.isAdmin === true;
      
      if (message.senderId !== userId && !isAdmin) {
        return res.status(403).json({ message: "Not authorized to edit this message" });
      }

      const updated = await storage.updateMessage(req.params.id, { 
        content: req.body.content,
        editedAt: new Date()
      });
      
      // Get the full message with sender for broadcasting
      const updatedWithSender = await storage.getMessageWithSender(req.params.id);

      // Broadcast update
      await broadcastToConversation(message.conversationId, "message-updated", {
        conversationId: message.conversationId,
        message: updatedWithSender,
      });

      res.json(updatedWithSender);
    } catch (error) {
      console.error("Error updating message:", error);
      res.status(500).json({ message: "Failed to update message" });
    }
  });

  app.delete("/api/messages/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const message = await storage.getMessage(req.params.id);

      if (!message) {
        return res.status(404).json({ message: "Message not found" });
      }

      // Check if user is admin or message owner
      const currentUser = await storage.getUser(userId);
      const isAdmin = currentUser?.isAdmin === true;
      
      if (message.senderId !== userId && !isAdmin) {
        return res.status(403).json({ message: "Not authorized to delete this message" });
      }

      await storage.deleteMessage(req.params.id);

      // Broadcast deletion
      await broadcastToConversation(message.conversationId, "message-deleted", {
        conversationId: message.conversationId,
        messageId: req.params.id,
      });

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting message:", error);
      res.status(500).json({ message: "Failed to delete message" });
    }
  });

  // Message reactions
  app.post("/api/messages/:id/reactions", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const { emoji } = req.body;
      const messageId = req.params.id;

      if (!emoji || emoji.length === 0) {
        return res.status(400).json({ message: "Emoji is required" });
      }

      const message = await storage.getMessage(messageId);
      if (!message) {
        return res.status(404).json({ message: "Message not found" });
      }

      await storage.addReaction(messageId, userId, emoji);

      // Broadcast reaction update
      const reactions = await storage.getMessageReactions(messageId);
      await broadcastToConversation(message.conversationId, "message-reactions-updated", {
        messageId,
        reactions,
      });

      res.status(200).json({ emoji, added: true });
    } catch (error) {
      console.error("Error adding reaction:", error);
      res.status(500).json({ message: "Failed to add reaction" });
    }
  });

  app.delete("/api/messages/:id/reactions/:emoji", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const { emoji } = req.params;
      const messageId = req.params.id;

      const message = await storage.getMessage(messageId);
      if (!message) {
        return res.status(404).json({ message: "Message not found" });
      }

      await storage.removeReaction(messageId, userId, emoji);

      // Broadcast reaction update
      const reactions = await storage.getMessageReactions(messageId);
      await broadcastToConversation(message.conversationId, "message-reactions-updated", {
        messageId,
        reactions,
      });

      res.status(204).send();
    } catch (error) {
      console.error("Error removing reaction:", error);
      res.status(500).json({ message: "Failed to remove reaction" });
    }
  });

  // Message forwarding
  app.post("/api/messages/:id/forward", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const messageId = req.params.id;
      const { toConversationId } = req.body;

      if (!toConversationId) {
        return res.status(400).json({ message: "toConversationId is required" });
      }

      // Get the original message to check source conversation
      const originalMessage = await storage.getMessage(messageId);
      if (!originalMessage) {
        return res.status(404).json({ message: "Message not found" });
      }

      // Validate user is participant in source conversation
      const isInSource = await storage.isUserInConversation(originalMessage.conversationId, userId);
      if (!isInSource) {
        return res.status(403).json({ message: "Not authorized to forward this message" });
      }

      // Validate user is participant in destination conversation
      const isInDest = await storage.isUserInConversation(toConversationId, userId);
      if (!isInDest) {
        return res.status(403).json({ message: "Not authorized to forward to this conversation" });
      }

      // Forward the message
      const forwardedMessage = await storage.forwardMessage(messageId, toConversationId, userId);
      const messageWithSender = await storage.getMessageWithSender(forwardedMessage.id);

      // Send response immediately
      res.status(201).json(messageWithSender);

      // Broadcast to destination conversation participants
      broadcastToConversation(toConversationId, "new-message", {
        conversationId: toConversationId,
        message: messageWithSender,
      }).catch((err) => console.error("Broadcast error:", err));
    } catch (error) {
      console.error("Error forwarding message:", error);
      res.status(500).json({ message: "Failed to forward message" });
    }
  });

  // Message pinning routes
  app.post("/api/messages/:id/pin", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const messageId = req.params.id;

      const message = await storage.getMessage(messageId);
      if (!message) {
        return res.status(404).json({ message: "Message not found" });
      }

      // Check if user is app-level admin
      const currentUser = await storage.getUser(userId);
      const isAppAdmin = currentUser?.isAdmin === true;

      // Check user is in conversation (app admins can access any conversation)
      const isInConv = await storage.isUserInConversation(message.conversationId, userId);
      if (!isInConv && !isAppAdmin) {
        return res.status(403).json({ message: "Not authorized to pin this message" });
      }

      // Get conversation to check type
      const conversation = await storage.getConversation(message.conversationId);
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      // For group conversations, only group admins/owners or app-level admins can pin
      if (conversation.type === "group" && !isAppAdmin) {
        const role = await storage.getParticipantRole(message.conversationId, userId);
        if (role !== "admin" && role !== "owner") {
          return res.status(403).json({ message: "Only admins can pin messages in groups" });
        }
      }

      const pinnedMessage = await storage.pinMessage(messageId, userId);
      const messageWithSender = await storage.getMessageWithSender(messageId);

      // Broadcast pin event
      await broadcastToConversation(message.conversationId, "message-pinned", {
        conversationId: message.conversationId,
        message: messageWithSender,
      });

      res.json(messageWithSender);
    } catch (error) {
      console.error("Error pinning message:", error);
      res.status(500).json({ message: "Failed to pin message" });
    }
  });

  app.delete("/api/messages/:id/pin", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const messageId = req.params.id;

      const message = await storage.getMessage(messageId);
      if (!message) {
        return res.status(404).json({ message: "Message not found" });
      }

      // Check if user is app-level admin
      const currentUser = await storage.getUser(userId);
      const isAppAdmin = currentUser?.isAdmin === true;

      // Check user is in conversation (app admins can access any conversation)
      const isInConv = await storage.isUserInConversation(message.conversationId, userId);
      if (!isInConv && !isAppAdmin) {
        return res.status(403).json({ message: "Not authorized to unpin this message" });
      }

      // Get conversation to check type
      const conversation = await storage.getConversation(message.conversationId);
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      // For group conversations, only group admins/owners or app-level admins can unpin
      if (conversation.type === "group" && !isAppAdmin) {
        const role = await storage.getParticipantRole(message.conversationId, userId);
        if (role !== "admin" && role !== "owner") {
          return res.status(403).json({ message: "Only admins can unpin messages in groups" });
        }
      }

      await storage.unpinMessage(messageId);
      const messageWithSender = await storage.getMessageWithSender(messageId);

      // Broadcast unpin event
      await broadcastToConversation(message.conversationId, "message-unpinned", {
        conversationId: message.conversationId,
        message: messageWithSender,
      });

      res.status(204).send();
    } catch (error) {
      console.error("Error unpinning message:", error);
      res.status(500).json({ message: "Failed to unpin message" });
    }
  });

  app.get("/api/conversations/:id/pinned", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const conversationId = req.params.id;

      // Check user is in conversation
      const isInConv = await storage.isUserInConversation(conversationId, userId);
      if (!isInConv) {
        return res.status(403).json({ message: "Not authorized to view pinned messages" });
      }

      const pinnedMessages = await storage.getPinnedMessages(conversationId);
      res.json(pinnedMessages);
    } catch (error) {
      console.error("Error fetching pinned messages:", error);
      res.status(500).json({ message: "Failed to fetch pinned messages" });
    }
  });

  // Read receipts routes
  app.post("/api/messages/:id/read", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const messageId = req.params.id;

      const message = await storage.getMessage(messageId);
      if (!message) {
        return res.status(404).json({ message: "Message not found" });
      }

      // Check user is in conversation
      const isInConv = await storage.isUserInConversation(message.conversationId, userId);
      if (!isInConv) {
        return res.status(403).json({ message: "Not authorized to mark this message as read" });
      }

      // Don't mark own messages as read
      if (message.senderId === userId) {
        return res.status(200).json({ message: "Own message" });
      }

      await storage.markMessageRead(messageId, userId);

      // Get the user who read the message
      const reader = await storage.getUser(userId);

      // Broadcast to conversation participants that message was read
      await broadcastToConversation(message.conversationId, "message-read", {
        messageId,
        conversationId: message.conversationId,
        userId,
        user: reader,
        readAt: new Date(),
      });

      res.status(200).json({ success: true });
    } catch (error) {
      console.error("Error marking message as read:", error);
      res.status(500).json({ message: "Failed to mark message as read" });
    }
  });

  app.get("/api/messages/:id/receipts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const messageId = req.params.id;

      const message = await storage.getMessage(messageId);
      if (!message) {
        return res.status(404).json({ message: "Message not found" });
      }

      // Check user is in conversation
      const isInConv = await storage.isUserInConversation(message.conversationId, userId);
      if (!isInConv) {
        return res.status(403).json({ message: "Not authorized to view receipts" });
      }

      const readBy = await storage.getMessageReadBy(messageId);
      res.json(readBy);
    } catch (error) {
      console.error("Error fetching read receipts:", error);
      res.status(500).json({ message: "Failed to fetch read receipts" });
    }
  });

  // Draft routes
  app.put("/api/conversations/:id/draft", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const conversationId = req.params.id;
      const { content } = req.body;

      // Verify user is a participant
      const isInConv = await storage.isUserInConversation(conversationId, userId);
      if (!isInConv) {
        return res.status(403).json({ message: "Not authorized" });
      }

      await storage.saveDraft(conversationId, userId, content || "");
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving draft:", error);
      res.status(500).json({ message: "Failed to save draft" });
    }
  });

  app.get("/api/conversations/:id/draft", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const conversationId = req.params.id;

      // Verify user is a participant
      const isInConv = await storage.isUserInConversation(conversationId, userId);
      if (!isInConv) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const content = await storage.getDraft(conversationId, userId);
      res.json({ content });
    } catch (error) {
      console.error("Error fetching draft:", error);
      res.status(500).json({ message: "Failed to fetch draft" });
    }
  });

  app.delete("/api/conversations/:id/draft", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const conversationId = req.params.id;

      // Verify user is a participant
      const isInConv = await storage.isUserInConversation(conversationId, userId);
      if (!isInConv) {
        return res.status(403).json({ message: "Not authorized" });
      }

      await storage.clearDraft(conversationId, userId);
      res.status(204).send();
    } catch (error) {
      console.error("Error clearing draft:", error);
      res.status(500).json({ message: "Failed to clear draft" });
    }
  });

  // Delete conversation (app-level admins or owners only)
  app.delete("/api/conversations/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const conversationId = req.params.id;

      // Check if user is app-level admin
      const currentUser = await storage.getUser(userId);
      const isAppAdmin = currentUser?.isAdmin === true;

      // Get conversation to check it exists
      const conversation = await storage.getConversation(conversationId);
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      // Only app-level admins or conversation owners can delete
      if (!isAppAdmin) {
        const role = await storage.getParticipantRole(conversationId, userId);
        if (role !== "owner") {
          return res.status(403).json({ message: "Only owners or system admins can delete conversations" });
        }
      }

      // Get participants before deletion to notify them
      const participants = await storage.getParticipants(conversationId);
      const participantIds = participants.map(p => p.userId);

      // Delete the conversation
      await storage.deleteConversation(conversationId);

      // Notify all participants
      broadcastToUsers(participantIds, "conversation-deleted", { conversationId });

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ message: "Failed to delete conversation" });
    }
  });

  // Call routes
  app.post("/api/calls", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const { conversationId, type } = req.body;

      const call = await storage.createCall({
        conversationId,
        initiatorId: userId,
        type,
        status: "initiated",
      });

      // Add initiator as participant
      await storage.addCallParticipant(call.id, userId);

      // Notify conversation participants
      await broadcastToConversation(conversationId, "incoming-call", {
        call,
        initiator: await storage.getUser(userId),
      }, userId);

      res.status(201).json(call);
    } catch (error) {
      console.error("Error creating call:", error);
      res.status(500).json({ message: "Failed to create call" });
    }
  });

  app.patch("/api/calls/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const callId = req.params.id;
      const { status } = req.body;

      // Get the call to check permissions
      const existingCall = await storage.getCall(callId);
      if (!existingCall || !existingCall.conversationId) {
        return res.status(404).json({ message: "Call not found" });
      }

      const callConversationId = existingCall.conversationId;

      // Check if user is app-level admin
      const currentUser = await storage.getUser(userId);
      const isAppAdmin = currentUser?.isAdmin === true;

      // For force-ending calls (status = "ended"), allow app-level admins
      if (status === "ended" && !isAppAdmin) {
        // Non-admins can only end their own calls or calls they're in
        const isInConv = await storage.isUserInConversation(callConversationId, userId);
        if (!isInConv) {
          return res.status(403).json({ message: "Not authorized to end this call" });
        }
      }

      const call = await storage.updateCall(callId, req.body);

      // Broadcast call ended to conversation if status changed to ended
      if (status === "ended") {
        await broadcastToConversation(callConversationId, "call-ended", {
          callId,
          endedBy: userId,
          forcedByAdmin: isAppAdmin,
        });
      }

      res.json(call);
    } catch (error) {
      console.error("Error updating call:", error);
      res.status(500).json({ message: "Failed to update call" });
    }
  });

  // Invite link routes
  app.post("/api/conversations/:id/invite-links", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const conversationId = req.params.id;
      const { expiresAt, maxUses } = req.body;

      const conversation = await storage.getConversation(conversationId);
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      if (conversation.type === "group") {
        const role = await storage.getParticipantRole(conversationId, userId);
        if (role !== "owner" && role !== "admin") {
          return res.status(403).json({ message: "Only admins and owners can create invite links" });
        }
      }

      const inviteLink = await storage.createInviteLink(
        conversationId,
        userId,
        expiresAt ? new Date(expiresAt) : undefined,
        maxUses
      );

      res.status(201).json(inviteLink);
    } catch (error) {
      console.error("Error creating invite link:", error);
      res.status(500).json({ message: "Failed to create invite link" });
    }
  });

  app.get("/api/conversations/:id/invite-links", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const conversationId = req.params.id;

      const isInConv = await storage.isUserInConversation(conversationId, userId);
      if (!isInConv) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const inviteLinks = await storage.getConversationInviteLinks(conversationId);
      res.json(inviteLinks);
    } catch (error) {
      console.error("Error fetching invite links:", error);
      res.status(500).json({ message: "Failed to fetch invite links" });
    }
  });

  app.delete("/api/invite-links/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      
      // Check if user is app-level admin
      const currentUser = await storage.getUser(userId);
      const isAppAdmin = currentUser?.isAdmin === true;

      // Get the invite link to check permissions
      const inviteLink = await storage.getInviteLink(req.params.id);
      if (!inviteLink) {
        return res.status(404).json({ message: "Invite link not found" });
      }

      // Non-admins must be admin/owner of the conversation
      if (!isAppAdmin) {
        const role = await storage.getParticipantRole(inviteLink.conversationId, userId);
        if (role !== "owner" && role !== "admin") {
          return res.status(403).json({ message: "Only admins can deactivate invite links" });
        }
      }

      await storage.deactivateInviteLink(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deactivating invite link:", error);
      res.status(500).json({ message: "Failed to deactivate invite link" });
    }
  });

  app.post("/api/invite-links/:token/join", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id || req.user?.claims?.sub;
      const { token } = req.params;

      const conversation = await storage.useInviteLink(token, userId);
      if (!conversation) {
        return res.status(400).json({ message: "Invalid or expired invite link" });
      }

      const details = await storage.getConversationWithDetails(conversation.id, userId);
      const newUser = await storage.getUser(userId);

      await broadcastToConversation(conversation.id, "new-participant", {
        conversationId: conversation.id,
        participant: {
          id: newUser?.id,
          userId: newUser?.id,
          user: newUser,
          role: "member",
        },
      }, userId);

      res.json(details);
    } catch (error) {
      console.error("Error joining via invite link:", error);
      res.status(500).json({ message: "Failed to join conversation" });
    }
  });

  app.get("/api/invite-links/:token", async (req: any, res) => {
    try {
      const { token } = req.params;
      const inviteLink = await storage.getInviteLinkByToken(token);

      if (!inviteLink || !inviteLink.isActive) {
        return res.status(404).json({ message: "Invite link not found or inactive" });
      }

      if (inviteLink.expiresAt && new Date(inviteLink.expiresAt) < new Date()) {
        return res.status(400).json({ message: "Invite link has expired" });
      }

      if (inviteLink.maxUses && inviteLink.useCount && inviteLink.useCount >= inviteLink.maxUses) {
        return res.status(400).json({ message: "Invite link has reached maximum uses" });
      }

      const conversation = await storage.getConversation(inviteLink.conversationId);
      res.json({
        conversationName: conversation?.name || "Group Chat",
        conversationType: conversation?.type,
        memberCount: (await storage.getParticipants(inviteLink.conversationId)).length,
      });
    } catch (error) {
      console.error("Error fetching invite link info:", error);
      res.status(500).json({ message: "Failed to fetch invite link info" });
    }
  });

  // WebSocket server for real-time communication
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    let userId: string | null = null;

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        const { type, payload } = message;

        switch (type) {
          case "user-online":
            userId = payload.userId;
            if (userId) {
              clients.set(userId, ws);
              await storage.updateUserStatus(userId, "online");
              
              // Notify contacts about online status
              const conversations = await storage.getUserConversations(userId);
              const contactIds = new Set<string>();
              conversations.forEach((conv) => {
                conv.participants.forEach((p) => {
                  if (p.userId !== userId) contactIds.add(p.userId);
                });
              });
              broadcastToUsers(Array.from(contactIds), "user-status-changed", {
                userId,
                status: "online",
              });
            }
            break;

          case "typing":
            if (userId && payload.conversationId) {
              await storage.updateTypingStatus(payload.conversationId, userId, payload.isTyping);
              await broadcastToConversation(payload.conversationId, "typing-status", {
                conversationId: payload.conversationId,
                userId,
                isTyping: payload.isTyping,
              }, userId);
            }
            break;

          case "start-call":
            if (userId && payload.conversationId) {
              const call = await storage.createCall({
                conversationId: payload.conversationId,
                initiatorId: userId,
                type: payload.type,
                status: "initiated",
              });
              
              await storage.addCallParticipant(call.id, userId);
              
              const initiator = await storage.getUser(userId);
              await broadcastToConversation(payload.conversationId, "incoming-call", {
                call,
                initiator,
              }, userId);
            }
            break;

          case "accept-call":
            if (userId && payload.callId) {
              const call = await storage.getCall(payload.callId);
              if (call) {
                await storage.addCallParticipant(call.id, userId);
                await storage.updateCall(call.id, { status: "active", startedAt: new Date() });
                
                // Notify call participants
                if (call.conversationId) {
                  await broadcastToConversation(call.conversationId, "call-accepted", {
                    callId: call.id,
                    userId,
                  });
                }
              }
            }
            break;

          case "decline-call":
            if (userId && payload.callId) {
              const call = await storage.getCall(payload.callId);
              if (call) {
                await storage.updateCall(call.id, { status: "declined" });
                
                if (call.conversationId) {
                  await broadcastToConversation(call.conversationId, "call-declined", {
                    callId: call.id,
                    userId,
                  });
                }
              }
            }
            break;

          case "end-call":
            if (userId && payload.callId) {
              const call = await storage.getCall(payload.callId);
              if (call) {
                const endedAt = new Date();
                const duration = call.startedAt 
                  ? Math.floor((endedAt.getTime() - new Date(call.startedAt).getTime()) / 1000)
                  : 0;
                
                await storage.updateCall(call.id, { 
                  status: "ended", 
                  endedAt,
                  duration,
                });
                
                if (call.conversationId) {
                  await broadcastToConversation(call.conversationId, "call-ended", {
                    callId: call.id,
                    endedBy: userId,
                    duration,
                  });
                }
              }
            }
            break;

          case "toggle-mute":
          case "toggle-video":
          case "toggle-screen-share":
            if (userId && payload.callId) {
              await storage.updateCallParticipant(payload.callId, userId, {
                isMuted: type === "toggle-mute" ? payload.isMuted : undefined,
                isVideoOff: type === "toggle-video" ? payload.isVideoOff : undefined,
                isScreenSharing: type === "toggle-screen-share" ? payload.isScreenSharing : undefined,
              });
              
              const call = await storage.getCall(payload.callId);
              if (call?.conversationId) {
                await broadcastToConversation(call.conversationId, "participant-media-changed", {
                  callId: payload.callId,
                  userId,
                  ...payload,
                }, userId);
              }
            }
            break;

          case "typing":
            if (userId && payload.conversationId) {
              const isTyping = payload.isTyping === true;
              await storage.updateTypingStatus(payload.conversationId, userId, isTyping);
              
              await broadcastToConversation(payload.conversationId, "user-typing", {
                userId,
                isTyping,
              }, userId);
            }
            break;

          case "ice-candidate":
            if (userId && payload.targetUserId && payload.candidate) {
              broadcastToUsers([payload.targetUserId], "ice-candidate", {
                fromUserId: userId,
                candidate: payload.candidate,
              });
            }
            break;

          case "webrtc-offer":
            if (userId && payload.targetUserId && payload.offer) {
              broadcastToUsers([payload.targetUserId], "webrtc-offer", {
                fromUserId: userId,
                offer: payload.offer,
              });
            }
            break;

          case "webrtc-answer":
            if (userId && payload.targetUserId && payload.answer) {
              broadcastToUsers([payload.targetUserId], "webrtc-answer", {
                fromUserId: userId,
                answer: payload.answer,
              });
            }
            break;
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    });

    ws.on("close", async () => {
      if (userId) {
        clients.delete(userId);
        await storage.updateUserStatus(userId, "offline");
        
        // Notify contacts about offline status
        const conversations = await storage.getUserConversations(userId);
        const contactIds = new Set<string>();
        conversations.forEach((conv) => {
          conv.participants.forEach((p) => {
            if (p.userId !== userId) contactIds.add(p.userId);
          });
        });
        broadcastToUsers(Array.from(contactIds), "user-status-changed", {
          userId,
          status: "offline",
        });
      }
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });
  });

  return httpServer;
}
