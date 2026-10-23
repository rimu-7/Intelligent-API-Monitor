/**
 * Role-based access control.
 *
 * - admin   → full user management (create admins and managers, change roles, ban, delete).
 * - manager → read-only, and only for what admin grants here. The users service also
 *             scopes managers so they can only see other managers.
 *
 * To give managers more access, add actions to `manager` below.
 */
import { createAccessControl } from "better-auth/plugins/access";

export const statement = {
  user: ["create", "list", "get", "set-role", "ban", "delete"],
  session: ["list", "revoke", "delete"],
} as const;

export const ac = createAccessControl(statement);

export const roles = {
  admin: ac.newRole({
    user: ["create", "list", "get", "set-role", "ban", "delete"],
    session: ["list", "revoke", "delete"],
  }),
  manager: ac.newRole({
    user: ["list", "get"],
  }),
};

export const ROLES = ["admin", "manager"] as const;
export type Role = (typeof ROLES)[number];

export type Permissions = {
  [K in keyof typeof statement]?: (typeof statement)[K][number][];
};

export const isRole = (value: unknown): value is Role =>
  typeof value === "string" && (ROLES as readonly string[]).includes(value);

export const hasPermission = (role: unknown, permissions: Permissions): boolean =>
  isRole(role) && roles[role].authorize(permissions).success;
