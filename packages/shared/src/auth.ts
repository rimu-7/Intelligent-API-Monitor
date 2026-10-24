/**
 * Roles and permissions — the single authorization map (§12.2).
 *
 * Deny by default: a role holds exactly the permissions listed here. `requirePermission`
 * never special-cases a role; ADMIN passes only because it is granted every permission.
 */

export const ROLES = ['ADMIN', 'MANAGER'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'alerts:read',
  'apis:read',
  'telemetry:ingest',
  'alerts:resolve',
  'alerts:regenerate',
  'simulator:control',
  'apis:configure',
  'users:manage',
  'audit:read',
  'settings:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS = {
  ADMIN: ALL_PERMISSIONS,
  // Reserved — grant permissions here later; no route changes needed.
  // Likely candidates: 'alerts:read', 'apis:read', 'alerts:resolve' (docs/DECISIONS.md ADR-008).
  MANAGER: [],
} as const satisfies Record<Role, readonly Permission[]>;

/** Machine credential sent as `x-ingest-key`. */
export const INGEST_KEY_PERMISSIONS: readonly Permission[] = ['telemetry:ingest'];

/** Anonymous callers when DEMO_MODE=true (read-only + ingest). */
export const DEMO_PERMISSIONS: readonly Permission[] = ['alerts:read', 'apis:read', 'telemetry:ingest'];

export const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value);

export const isPermission = (value: unknown): value is Permission =>
  typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);

export const permissionsForRole = (role: Role): readonly Permission[] => ROLE_PERMISSIONS[role];

export interface AuthUserDto {
  id: string;
  email: string;
  role: Role;
}

export interface LoginResponseDto {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  user: AuthUserDto;
  permissions: Permission[];
}

export interface MeResponseDto {
  user: AuthUserDto;
  permissions: Permission[];
}

/** Roles that hold `permission` — e.g. who counts as "an admin" for last-admin protection. */
export const rolesWithPermission = (permission: Permission): Role[] =>
  ROLES.filter((role) => (ROLE_PERMISSIONS[role] as readonly Permission[]).includes(permission));
