import { sql, relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  text,
  boolean,
  integer,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const userStatusEnum = pgEnum("user_status", ["online", "away", "busy", "offline"]);
export const conversationTypeEnum = pgEnum("conversation_type", ["direct", "group"]);
export const participantRoleEnum = pgEnum("participant_role", ["owner", "admin", "member"]);
export const messageTypeEnum = pgEnum("message_type", ["text", "image", "system", "voice", "file", "gif"]);
export const messageStatusEnum = pgEnum("message_status", ["sent", "delivered", "read"]);
export const callTypeEnum = pgEnum("call_type", ["voice", "video"]);
export const callStatusEnum = pgEnum("call_status", ["initiated", "ringing", "active", "ended", "missed", "declined"]);

// Session storage table (required for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Users table (with local auth + app-specific fields)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: varchar("username").unique().notNull(),
  password: varchar("password").notNull(),
  email: varchar("email"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  status: userStatusEnum("status").default("offline"),
  statusMessage: varchar("status_message"),
  bio: text("bio"),
  lastSeenAt: timestamp("last_seen_at"),
  notificationsEnabled: boolean("notifications_enabled").default(true),
  soundEnabled: boolean("sound_enabled").default(true),
  isAdmin: boolean("is_admin").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_users_status").on(table.status),
  index("IDX_users_last_seen").on(table.lastSeenAt),
  index("IDX_users_username").on(table.username),
]);

// Conversations table (supports both direct and group)
export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: conversationTypeEnum("type").notNull().default("direct"),
  name: varchar("name"),
  description: text("description"),
  iconImageUrl: varchar("icon_image_url"),
  createdById: varchar("created_by_id").references(() => users.id),
  lastMessageId: varchar("last_message_id"),
  lastActivityAt: timestamp("last_activity_at").defaultNow(),
  isArchived: boolean("is_archived").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("IDX_conversations_last_activity").on(table.lastActivityAt),
  index("IDX_conversations_type").on(table.type),
]);

// Conversation participants
export const conversationParticipants = pgTable("conversation_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: participantRoleEnum("role").default("member"),
  joinedAt: timestamp("joined_at").defaultNow(),
  mutedUntil: timestamp("muted_until"),
  lastReadMessageId: varchar("last_read_message_id"),
  lastReadAt: timestamp("last_read_at"),
  isTyping: boolean("is_typing").default(false),
  typingUpdatedAt: timestamp("typing_updated_at"),
  draftContent: text("draft_content"),
  draftUpdatedAt: timestamp("draft_updated_at"),
}, (table) => [
  index("IDX_participants_conversation").on(table.conversationId),
  index("IDX_participants_user").on(table.userId),
]);

// Messages table
export const messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  senderId: varchar("sender_id").notNull().references(() => users.id),
  content: text("content"),
  messageType: messageTypeEnum("message_type").default("text"),
  attachments: jsonb("attachments").$type<Array<{ 
    url: string; 
    type: string; 
    name: string; 
    size?: number;
    duration?: number;
    width?: number;
    height?: number;
  }>>(),
  replyToId: varchar("reply_to_id"),
  forwardedFromId: varchar("forwarded_from_id"),
  forwardedById: varchar("forwarded_by_id").references(() => users.id),
  isPinned: boolean("is_pinned").default(false),
  pinnedAt: timestamp("pinned_at"),
  pinnedById: varchar("pinned_by_id").references(() => users.id),
  status: messageStatusEnum("status").default("sent"),
  editedAt: timestamp("edited_at"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_messages_conversation").on(table.conversationId),
  index("IDX_messages_sender").on(table.senderId),
  index("IDX_messages_created").on(table.createdAt),
  index("IDX_messages_pinned").on(table.isPinned),
  index("IDX_messages_content_search").on(table.content),
]);

// Message read receipts
export const messageReceipts = pgTable("message_receipts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deliveredAt: timestamp("delivered_at"),
  readAt: timestamp("read_at"),
}, (table) => [
  index("IDX_receipts_message").on(table.messageId),
  index("IDX_receipts_user").on(table.userId),
]);

// Message mentions
export const messageMentions = pgTable("message_mentions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_mentions_message").on(table.messageId),
  index("IDX_mentions_user").on(table.userId),
]);

// Link previews
export const linkPreviews = pgTable("link_previews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  title: varchar("title"),
  description: text("description"),
  imageUrl: varchar("image_url"),
  siteName: varchar("site_name"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_link_previews_message").on(table.messageId),
]);

// Conversation invite links
export const conversationInviteLinks = pgTable("conversation_invite_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  token: varchar("token").notNull().unique(),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at"),
  maxUses: integer("max_uses"),
  useCount: integer("use_count").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_invite_links_conversation").on(table.conversationId),
  index("IDX_invite_links_token").on(table.token),
]);

// Push notification subscriptions
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_push_subscriptions_user").on(table.userId),
]);

// Calls table
export const calls = pgTable("calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").references(() => conversations.id),
  initiatorId: varchar("initiator_id").notNull().references(() => users.id),
  type: callTypeEnum("type").notNull().default("voice"),
  status: callStatusEnum("status").notNull().default("initiated"),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  duration: integer("duration"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_calls_conversation").on(table.conversationId),
  index("IDX_calls_initiator").on(table.initiatorId),
  index("IDX_calls_status").on(table.status),
  index("IDX_calls_created").on(table.createdAt),
]);

// Call participants
export const callParticipants = pgTable("call_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  callId: varchar("call_id").notNull().references(() => calls.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  joinedAt: timestamp("joined_at").defaultNow(),
  leftAt: timestamp("left_at"),
  isMuted: boolean("is_muted").default(false),
  isVideoOff: boolean("is_video_off").default(false),
  isScreenSharing: boolean("is_screen_sharing").default(false),
}, (table) => [
  index("IDX_call_participants_call").on(table.callId),
  index("IDX_call_participants_user").on(table.userId),
]);

// Message reactions
export const messageReactions = pgTable("message_reactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  emoji: varchar("emoji").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("IDX_reactions_message").on(table.messageId),
  index("IDX_reactions_user").on(table.userId),
]);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  participations: many(conversationParticipants),
  sentMessages: many(messages),
  initiatedCalls: many(calls),
  callParticipations: many(callParticipants),
  pushSubscriptions: many(pushSubscriptions),
  mentions: many(messageMentions),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [conversations.createdById],
    references: [users.id],
  }),
  participants: many(conversationParticipants),
  messages: many(messages),
  calls: many(calls),
  inviteLinks: many(conversationInviteLinks),
}));

export const conversationParticipantsRelations = relations(conversationParticipants, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationParticipants.conversationId],
    references: [conversations.id],
  }),
  user: one(users, {
    fields: [conversationParticipants.userId],
    references: [users.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
  }),
  replyTo: one(messages, {
    fields: [messages.replyToId],
    references: [messages.id],
    relationName: "replyTo",
  }),
  forwardedFrom: one(messages, {
    fields: [messages.forwardedFromId],
    references: [messages.id],
    relationName: "forwardedFrom",
  }),
  forwardedBy: one(users, {
    fields: [messages.forwardedById],
    references: [users.id],
    relationName: "forwardedBy",
  }),
  pinnedBy: one(users, {
    fields: [messages.pinnedById],
    references: [users.id],
    relationName: "pinnedBy",
  }),
  receipts: many(messageReceipts),
  mentions: many(messageMentions),
  linkPreviews: many(linkPreviews),
  reactions: many(messageReactions),
}));

export const messageReceiptsRelations = relations(messageReceipts, ({ one }) => ({
  message: one(messages, {
    fields: [messageReceipts.messageId],
    references: [messages.id],
  }),
  user: one(users, {
    fields: [messageReceipts.userId],
    references: [users.id],
  }),
}));

export const messageMentionsRelations = relations(messageMentions, ({ one }) => ({
  message: one(messages, {
    fields: [messageMentions.messageId],
    references: [messages.id],
  }),
  user: one(users, {
    fields: [messageMentions.userId],
    references: [users.id],
  }),
}));

export const linkPreviewsRelations = relations(linkPreviews, ({ one }) => ({
  message: one(messages, {
    fields: [linkPreviews.messageId],
    references: [messages.id],
  }),
}));

export const conversationInviteLinksRelations = relations(conversationInviteLinks, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationInviteLinks.conversationId],
    references: [conversations.id],
  }),
  createdBy: one(users, {
    fields: [conversationInviteLinks.createdById],
    references: [users.id],
  }),
}));

export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(users, {
    fields: [pushSubscriptions.userId],
    references: [users.id],
  }),
}));

export const callsRelations = relations(calls, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [calls.conversationId],
    references: [conversations.id],
  }),
  initiator: one(users, {
    fields: [calls.initiatorId],
    references: [users.id],
  }),
  participants: many(callParticipants),
}));

export const callParticipantsRelations = relations(callParticipants, ({ one }) => ({
  call: one(calls, {
    fields: [callParticipants.callId],
    references: [calls.id],
  }),
  user: one(users, {
    fields: [callParticipants.userId],
    references: [users.id],
  }),
}));

export const messageReactionsRelations = relations(messageReactions, ({ one }) => ({
  message: one(messages, {
    fields: [messageReactions.messageId],
    references: [messages.id],
  }),
  user: one(users, {
    fields: [messageReactions.userId],
    references: [users.id],
  }),
}));

// Zod Schemas for validation
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const updateUserSchema = insertUserSchema.partial();
export const selectUserSchema = createSelectSchema(users);
export const signupSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(30, "Username must be at most 30 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});
export const signinSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true, updatedAt: true });
export const updateConversationSchema = insertConversationSchema.partial();

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export const updateMessageSchema = insertMessageSchema.partial();

export const insertCallSchema = createInsertSchema(calls).omit({ id: true, createdAt: true });
export const updateCallSchema = insertCallSchema.partial();

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;

export type ConversationParticipant = typeof conversationParticipants.$inferSelect;
export type InsertConversationParticipant = typeof conversationParticipants.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

export type MessageReceipt = typeof messageReceipts.$inferSelect;

export type MessageMention = typeof messageMentions.$inferSelect;

export type LinkPreview = typeof linkPreviews.$inferSelect;

export type ConversationInviteLink = typeof conversationInviteLinks.$inferSelect;
export type InsertConversationInviteLink = typeof conversationInviteLinks.$inferInsert;

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = typeof pushSubscriptions.$inferInsert;

export type MessageReaction = typeof messageReactions.$inferSelect;

export type Call = typeof calls.$inferSelect;
export type InsertCall = z.infer<typeof insertCallSchema>;

export type CallParticipant = typeof callParticipants.$inferSelect;

// Auth types
export type SignupInput = z.infer<typeof signupSchema>;
export type SigninInput = z.infer<typeof signinSchema>;

// Extended types for frontend use
export type ConversationWithDetails = Conversation & {
  participants: (ConversationParticipant & { user: User })[];
  lastMessage?: Message & { sender: User };
  unreadCount?: number;
  pinnedMessages?: MessageWithSender[];
};

export type MessageWithSender = Message & {
  sender: User;
  replyTo?: Message & { sender: User };
  forwardedFrom?: Message & { sender: User };
  reactions?: { emoji: string; count: number; userReacted: boolean }[];
  mentions?: User[];
  linkPreview?: LinkPreview;
  readBy?: { user: User; readAt: Date }[];
};

export type CallWithDetails = Call & {
  initiator: User;
  participants: (CallParticipant & { user: User })[];
  conversation?: Conversation;
};
