import { describe, expect, test } from "bun:test";

import { runPostValidations } from "../src/validate-post";
import { cleanup, createTempProject } from "./helpers/tmp-project";

describe("post-validations", () => {
  test("typecheck passes on clean project", () => {
    const { dir } = createTempProject({ profile: "minimal", features: [] });
    const result = runPostValidations(dir, []);
    expect(result.ok).toBe(true);
    cleanup(dir);
  });

  test("dry-run does not imply validations", () => {
    // runPostValidations is only called on apply, not dry-run. This test just checks it doesn't throw
    const { dir } = createTempProject({ profile: "minimal", features: [] });
    expect(() => runPostValidations(dir, [])).not.toThrow();
    cleanup(dir);
  });
});
