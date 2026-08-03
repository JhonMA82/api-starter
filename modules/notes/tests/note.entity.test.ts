import { describe, expect, test } from "bun:test";
import { assertValidTitle } from "../src/domain/note.entity";
import { InvalidNoteError } from "../src/domain/note.errors";

describe("assertValidTitle", () => {
  test("rejects a blank title", () => {
    expect(() => assertValidTitle("")).toThrow(InvalidNoteError);
    expect(() => assertValidTitle("   ")).toThrow(InvalidNoteError);
  });

  test("rejects a title that is blank after trimming", () => {
    expect(() => assertValidTitle("\t\n ")).toThrow(InvalidNoteError);
  });

  test("accepts a non-blank title", () => {
    expect(() => assertValidTitle("Welcome")).not.toThrow();
  });

  test("error message explains the failure", () => {
    try {
      assertValidTitle("");
      expect.unreachable("expected assertValidTitle to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidNoteError);
      expect((error as InvalidNoteError).message).toBe("title must not be blank");
    }
  });
});
