import { describe, expect, test } from "bun:test";
import type { Permission } from "../src/permissions";
import { PERMISSION_DESCRIPTIONS, PERMISSIONS } from "../src/permissions";

describe("permission catalog", () => {
  test("lists exactly the nine catalog permissions in order", () => {
    expect(PERMISSIONS).toEqual([
      "request.create",
      "request.read",
      "request.update",
      "request.assign",
      "request.review",
      "request.approve",
      "request.reject",
      "request.export",
      "request.delete",
    ]);
  });

  test("describes every permission with a non-empty description", () => {
    expect(Object.keys(PERMISSION_DESCRIPTIONS)).toHaveLength(PERMISSIONS.length);
    for (const permission of PERMISSIONS) {
      expect(PERMISSION_DESCRIPTIONS[permission].length).toBeGreaterThan(0);
    }
  });

  test("rejects non-catalog permissions at the type level", () => {
    // @ts-expect-error "request.nuke" is not part of the permission catalog
    const invalid: Permission = "request.nuke";
    expect(typeof invalid).toBe("string");
  });
});
