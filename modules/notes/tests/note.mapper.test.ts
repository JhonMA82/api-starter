import { describe, expect, test } from "bun:test";

import { createToRow, rowToEntity } from "../src/infrastructure/note.mapper";

describe("note mapper", () => {
  test("rowToEntity maps every row field onto the entity", () => {
    const createdAt = new Date("2026-08-02T00:00:00.000Z");
    const updatedAt = new Date("2026-08-02T00:00:01.000Z");
    const entity = rowToEntity({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Welcome",
      body: "A note body.",
      pinned: true,
      createdAt,
      updatedAt,
    });

    expect(entity).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Welcome",
      body: "A note body.",
      pinned: true,
      createdAt,
      updatedAt,
    });
  });

  test("rowToEntity defaults pinned to false when the row lacks it", () => {
    const createdAt = new Date("2026-08-02T00:00:00.000Z");
    const entity = rowToEntity({
      id: "22222222-2222-4222-8222-222222222222",
      title: "Run the stack",
      body: "A note body.",
      pinned: false,
      createdAt,
      updatedAt: createdAt,
    });

    expect(entity.pinned).toBe(false);
  });

  test("createToRow carries title and body through", () => {
    const row = createToRow({ title: "Welcome", body: "A note body." });

    expect(row.title).toBe("Welcome");
    expect(row.body).toBe("A note body.");
  });

  test("createToRow defaults pinned to false", () => {
    expect(createToRow({ title: "Welcome", body: "A note body." }).pinned).toBe(false);
  });

  test("createToRow preserves an explicit pinned value", () => {
    expect(createToRow({ title: "Welcome", body: "A note body.", pinned: true }).pinned).toBe(true);
  });
});
