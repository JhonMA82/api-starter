import { describe, expect, test } from "bun:test";
import type { MatrixEntry } from "../src/matrix";
import { PERMISSION_MATRIX, rolesForPermission } from "../src/matrix";
import { PERMISSIONS } from "../src/permissions";
import { ROLE_PERMISSIONS, ROLES } from "../src/roles";

describe("permission matrix", () => {
  test("has exactly one entry per catalog permission, in catalog order", () => {
    const matrix: readonly MatrixEntry[] = PERMISSION_MATRIX;
    expect(matrix).toHaveLength(PERMISSIONS.length);
    expect(matrix.map((entry) => entry.action)).toEqual([...PERMISSIONS]);
  });

  test("keeps every entry on the request resource with a valid permission", () => {
    const catalog = new Set<string>(PERMISSIONS);
    for (const entry of PERMISSION_MATRIX) {
      expect(entry.resource).toBe("request");
      expect(catalog.has(entry.action)).toBe(true);
    }
  });

  test("derives each entry from ROLE_PERMISSIONS exactly", () => {
    for (const entry of PERMISSION_MATRIX) {
      expect(entry.admin).toBe(ROLE_PERMISSIONS.admin.includes(entry.action));
      expect(entry.reviewer).toBe(ROLE_PERMISSIONS.reviewer.includes(entry.action));
      expect(entry.member).toBe(ROLE_PERMISSIONS.member.includes(entry.action));
    }
  });

  test("grants every permission to at least one role", () => {
    for (const entry of PERMISSION_MATRIX) {
      const grantingRoles = ROLES.filter((role) => entry[role]);
      expect(grantingRoles.length).toBeGreaterThan(0);
    }
  });

  test("rolesForPermission returns exactly the granting roles", () => {
    for (const permission of PERMISSIONS) {
      const expected = ROLES.filter((role) => ROLE_PERMISSIONS[role].includes(permission));
      expect(rolesForPermission(permission)).toEqual(expected);
    }
  });

  test("rolesForPermission distinguishes admin-only, shared and universal permissions", () => {
    expect(rolesForPermission("request.delete")).toEqual(["admin"]);
    expect(rolesForPermission("request.create")).toEqual(["admin", "member"]);
    expect(rolesForPermission("request.approve")).toEqual(["admin", "reviewer"]);
    expect(rolesForPermission("request.export")).toEqual(["admin", "reviewer", "member"]);
  });
});
