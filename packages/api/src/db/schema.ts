import { pgTable, text, boolean, timestamp, jsonb, uuid } from "drizzle-orm/pg-core";

export const robots = pgTable("robots", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  model: text("model").notNull(),
  capabilities: jsonb("capabilities").notNull(),
  status: text("status").notNull().default("offline"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  robotId: text("robot_id").notNull().references(() => robots.id),
  userId: text("user_id").notNull(),
  status: text("status").notNull().default("active"),
  record: boolean("record").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  keyHash: text("key_hash").notNull(),
  label: text("label").default("default"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
