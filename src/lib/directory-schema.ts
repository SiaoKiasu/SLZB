import { z } from "zod";
import { portalConfigSchema } from "./config-schema";

export const directorySchema = portalConfigSchema.refine(
  (v) => v.users.every((u) => u.role === "viewer"),
  "后台用户只能拥有只读权限",
);
export type Directory = z.infer<typeof directorySchema>;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.-]{3,64}$/);
const revision = z.string().uuid().nullable();
const account = z
  .object({
    id,
    label: z.string().trim().min(1).max(60),
    source: z.enum(["binance", "demo"]),
    environment: z.enum(["mainnet", "testnet"]),
    enabled: z.boolean(),
    principal: z
      .string()
      .regex(/^\d{1,20}(\.\d{1,16})?$/)
      .nullable(),
    apiKey: z.string().trim().max(512).optional(),
    apiSecret: z.string().trim().max(512).optional(),
  })
  .strict();
const user = z
  .object({
    username,
    displayName: z.string().trim().min(1).max(60),
    accountId: id,
    enabled: z.boolean(),
    password: z.string().min(8).max(256).optional(),
  })
  .strict();
export const adminMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createAccount"), revision, account }).strict(),
  z.object({ action: z.literal("updateAccount"), revision, account }).strict(),
  z.object({ action: z.literal("createUser"), revision, user }).strict(),
  z.object({ action: z.literal("updateUser"), revision, user }).strict(),
  z.object({ action: z.literal("revokeSessions"), revision, username }).strict(),
  z.object({ action: z.literal("deleteUser"), revision, username }).strict(),
]);
export type AdminMutation = z.infer<typeof adminMutationSchema>;
export type DirectoryView = {
  revision: string | null;
  administrator: { username: string; displayName: string };
  accounts: {
    id: string;
    label: string;
    source: "demo" | "binance";
    environment: "mainnet" | "testnet";
    enabled: boolean;
    principal: string | null;
    hasCredentials: boolean;
  }[];
  users: {
    username: string;
    displayName: string;
    accountId: string;
    enabled: boolean;
    role: "viewer";
  }[];
  audit: { at: number; by: string; action: string; target: string }[];
};
