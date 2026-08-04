import { createHash } from "node:crypto";

import type { FileHashing } from "../application/ports";

export function createSha256Hasher(): FileHashing {
  return {
    hash(data: Buffer): string {
      return createHash("sha256").update(data).digest("hex");
    },
  };
}
