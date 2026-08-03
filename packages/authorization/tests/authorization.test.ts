import { describe, expect, test } from "bun:test";
import type { Actor } from "../src/authorization";
import { AuthorizationError, authorize } from "../src/authorization";
import { PERMISSIONS } from "../src/permissions";

function actor(id: string, roles: Actor["roles"]): Actor {
  return { id, roles };
}

describe("authorize", () => {
  test("denies by default for an actor with no roles", () => {
    expect(authorize(actor("u1", []), "request.read")).toBe(false);
  });

  test("ignores unknown roles", () => {
    const withUnknownRole = actor("u1", ["superuser"] as unknown as Actor["roles"]);
    expect(authorize(withUnknownRole, "request.read")).toBe(false);
  });

  test("grants admin every catalog permission", () => {
    const admin = actor("u1", ["admin"]);
    for (const permission of PERMISSIONS) {
      expect(authorize(admin, permission)).toBe(true);
    }
  });

  test("grants member create, read, update and export but not approve or delete", () => {
    const member = actor("u1", ["member"]);
    expect(authorize(member, "request.create")).toBe(true);
    expect(authorize(member, "request.read")).toBe(true);
    expect(authorize(member, "request.update")).toBe(true);
    expect(authorize(member, "request.export")).toBe(true);
    expect(authorize(member, "request.approve")).toBe(false);
    expect(authorize(member, "request.delete")).toBe(false);
  });

  test("denies when no role grants the permission", () => {
    const reviewer = actor("u1", ["reviewer"]);
    expect(authorize(reviewer, "request.create")).toBe(false);
    expect(authorize(reviewer, "request.delete")).toBe(false);
  });

  test("grants when any role grants the permission", () => {
    const mixed = actor("u1", ["member", "admin"]);
    expect(authorize(mixed, "request.delete")).toBe(true);
  });

  test("still grants when an unknown role sits next to a known one", () => {
    const mixed = actor("u1", ["superuser" as unknown as Actor["roles"][number], "member"]);
    expect(authorize(mixed, "request.create")).toBe(true);
  });
});

describe("AuthorizationError", () => {
  test("carries the error name and a formatted message", () => {
    const error = new AuthorizationError(actor("u7", ["member"]), "request.approve");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error.name).toBe("AuthorizationError");
    expect(error.message).toBe('Denied permission "request.approve" for actor "u7"');
    expect(error.actorId).toBe("u7");
    expect(error.permission).toBe("request.approve");
  });
});
