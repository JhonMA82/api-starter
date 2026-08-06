import { describe, expect, test } from "bun:test";

import { resolveUpdatePath } from "../updates/registry";

describe("registry integration", () => {
  test("from===to empty", () => {
    expect(resolveUpdatePath("0.11.0", "0.11.0")).toEqual([]);
  });

  test("0.10.1 -> 0.11.0 resolves expected id", () => {
    const path = resolveUpdatePath("0.10.1", "0.11.0");
    expect(path.map((u) => u.id)).toEqual(["0.10.1-to-0.11.0"]);
  });

  test("missing path throws", () => {
    expect(() => resolveUpdatePath("0.9.0", "0.11.0")).toThrow(/no update path/);
  });

  test("downgrade throws", () => {
    expect(() => resolveUpdatePath("0.11.0", "0.10.1")).toThrow(/newer than/);
  });

  test("overshoot throws", () => {
    // If we ask 0.10.1 -> 0.10.5 but only have 0.10.1->0.11.0 which goes beyond, it should throw
    expect(() => resolveUpdatePath("0.10.1", "0.10.2")).toThrow();
  });
});
