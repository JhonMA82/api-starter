import { describe, expect, test } from "bun:test";

import { PERMISSIONS } from "../src/permissions";
import { ROLE_PERMISSIONS, ROLES } from "../src/roles";

describe("role permissions", () => {
  test("defines exactly the three global roles", () => {
    expect(ROLES).toEqual(["admin", "reviewer", "member"]);
  });

  test("grants admin every catalog permission", () => {
    expect(ROLE_PERMISSIONS.admin).toHaveLength(PERMISSIONS.length);
    for (const permission of PERMISSIONS) {
      expect(ROLE_PERMISSIONS.admin).toContain(permission);
    }
  });

  test("keeps reviewer away from create, update and delete", () => {
    expect(ROLE_PERMISSIONS.reviewer).toContain("request.read");
    expect(ROLE_PERMISSIONS.reviewer).toContain("request.approve");
    expect(ROLE_PERMISSIONS.reviewer).not.toContain("request.create");
    expect(ROLE_PERMISSIONS.reviewer).not.toContain("request.update");
    expect(ROLE_PERMISSIONS.reviewer).not.toContain("request.delete");
  });

  test("keeps member away from assign, review, approve, reject and delete", () => {
    expect(ROLE_PERMISSIONS.member).toContain("request.create");
    expect(ROLE_PERMISSIONS.member).toContain("request.read");
    expect(ROLE_PERMISSIONS.member).toContain("request.update");
    expect(ROLE_PERMISSIONS.member).toContain("request.export");
    expect(ROLE_PERMISSIONS.member).not.toContain("request.assign");
    expect(ROLE_PERMISSIONS.member).not.toContain("request.review");
    expect(ROLE_PERMISSIONS.member).not.toContain("request.approve");
    expect(ROLE_PERMISSIONS.member).not.toContain("request.reject");
    expect(ROLE_PERMISSIONS.member).not.toContain("request.delete");
  });

  test("references only valid catalog permissions", () => {
    const catalog = new Set<string>(PERMISSIONS);
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(catalog.has(permission)).toBe(true);
      }
    }
  });
});
