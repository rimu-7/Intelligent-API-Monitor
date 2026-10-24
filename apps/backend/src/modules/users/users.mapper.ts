import { permissionsForRole, type AuthUserDto, type Permission, type Role } from '@apimon/shared';
import type { PublicUser } from './users.repository';

export interface UserDto extends AuthUserDto {
  is_active: boolean;
  last_login_at: string | null;
  password_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const toAuthUserDto = (user: { id: string; email: string; role: Role }): AuthUserDto => ({
  id: user.id,
  email: user.email,
  role: user.role,
});

export const toUserDto = (user: PublicUser): UserDto => ({
  ...toAuthUserDto(user),
  is_active: user.isActive,
  last_login_at: user.lastLoginAt?.toISOString() ?? null,
  password_changed_at: user.passwordChangedAt?.toISOString() ?? null,
  created_at: user.createdAt.toISOString(),
  updated_at: user.updatedAt.toISOString(),
});

export const permissionList = (role: Role): Permission[] => [...permissionsForRole(role)];
