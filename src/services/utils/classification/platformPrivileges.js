export const EXCLUDED_PLATFORM_PRIVILEGES = Object.freeze({
  BOT_TESTER: 1 << 1,
  VOLUNTEER: 1 << 9,
  STAFF: 1 << 12,
  DEVELOPER: 1 << 14,
  USER_ADMIN: 1 << 24,
  GROUP_ADMIN: 1 << 25,
  ENTERTAINER: 1 << 29
});

export const EXCLUDED_PLATFORM_PRIVILEGE_MASK = Object.values(
  EXCLUDED_PLATFORM_PRIVILEGES
).reduce((mask, privilege) => mask | privilege, 0);

export function isPlatformPrivileged (privileges) {
  return Number.isInteger(privileges) &&
    (privileges & EXCLUDED_PLATFORM_PRIVILEGE_MASK) !== 0;
}
