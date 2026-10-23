import {
  ALL_PERMISSIONS,
  DEMO_PERMISSIONS,
  INGEST_KEY_PERMISSIONS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
  rolesWithPermission,
} from '@apimon/shared';
import { describe, expect, it } from 'vitest';
import { anonymousPrincipal, ingestKeyPrincipal, userPrincipal } from '../../src/http/principal';

describe('ROLE_PERMISSIONS (§12.2)', () => {
  it('grants ADMIN every permission', () => {
    expect([...ROLE_PERMISSIONS.ADMIN].sort()).toEqual([...PERMISSIONS].sort());
    expect(ALL_PERMISSIONS).toHaveLength(9);
  });

  it('grants MANAGER nothing (deny by default)', () => {
    expect(ROLE_PERMISSIONS.MANAGER).toEqual([]);
  });

  it('covers every role', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLES].sort());
  });

  it('limits machine and demo principals', () => {
    expect(INGEST_KEY_PERMISSIONS).toEqual(['telemetry:ingest']);
    expect([...DEMO_PERMISSIONS].sort()).toEqual(['alerts:read', 'apis:read', 'telemetry:ingest']);
  });

  it('derives "admin" from the users:manage permission', () => {
    expect(rolesWithPermission('users:manage')).toEqual(['ADMIN']);
  });
});

describe('principals', () => {
  it('builds user principals from the map', () => {
    expect(userPrincipal({ id: 'u', email: 'a@b.c', role: 'MANAGER' }).permissions.size).toBe(0);
    expect(userPrincipal({ id: 'u', email: 'a@b.c', role: 'ADMIN' }).permissions.has('users:manage')).toBe(
      true,
    );
  });

  it('gives anonymous callers permissions only in demo mode', () => {
    expect(anonymousPrincipal(false).permissions.size).toBe(0);
    expect(anonymousPrincipal(true).permissions.has('alerts:read')).toBe(true);
    expect(anonymousPrincipal(true).permissions.has('alerts:resolve')).toBe(false);
    expect(ingestKeyPrincipal().permissions.has('alerts:read')).toBe(false);
  });
});
