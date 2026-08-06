import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function sha256WithPrefix(content: string | Buffer): string {
  return `sha256:${sha256Hex(content)}`;
}

export function hashFileContent(content: string): string {
  return sha256WithPrefix(content);
}

export function hashFile(path: string): string {
  const content = readFileSync(path);
  return sha256WithPrefix(content);
}

export function hashString(value: string): string {
  return sha256WithPrefix(value);
}
