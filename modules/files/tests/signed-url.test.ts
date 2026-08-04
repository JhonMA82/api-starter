import { describe, expect, test } from "bun:test";

import {
  buildSignedDownloadUrl,
  createSignedDownloadToken,
  decodeSignedDownloadToken,
  verifySignedDownloadToken,
} from "../src/application/signed-url";

const SECRET = "test-signed-url-secret";
const NOW = new Date("2026-08-03T12:00:00.000Z");
const EXPIRES_AT = new Date(NOW.getTime() + 60 * 60 * 1000);

function input(overrides: { expiresAt?: Date } = {}) {
  return {
    fileId: "file-1",
    organizationId: "org-1",
    expiresAt: overrides.expiresAt ?? EXPIRES_AT,
  };
}

describe("createSignedDownloadToken", () => {
  test("produces a deterministic <base64url payload>.<hex hmac> token", () => {
    const token = createSignedDownloadToken(SECRET, input());
    const separatorIndex = token.lastIndexOf(".");
    expect(separatorIndex).toBeGreaterThan(0);
    const payload = token.slice(0, separatorIndex);
    const signature = token.slice(separatorIndex + 1);

    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(payload).not.toMatch(/[+/]/);
    expect(payload).not.toContain("=");

    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    expect(claims).toEqual({
      fileId: "file-1",
      organizationId: "org-1",
      exp: Math.floor(EXPIRES_AT.getTime() / 1000),
    });

    const again = createSignedDownloadToken(SECRET, input());
    expect(again).toBe(token);
  });
});

describe("decodeSignedDownloadToken", () => {
  test("returns the claims of a well-formed token", () => {
    const token = createSignedDownloadToken(SECRET, input());
    expect(decodeSignedDownloadToken(token)).toEqual({
      fileId: "file-1",
      organizationId: "org-1",
      exp: Math.floor(EXPIRES_AT.getTime() / 1000),
    });
  });

  test("returns null for malformed tokens", () => {
    expect(decodeSignedDownloadToken("")).toBeNull();
    expect(decodeSignedDownloadToken("no-separator")).toBeNull();
    expect(decodeSignedDownloadToken(".deadbeef")).toBeNull();
    expect(decodeSignedDownloadToken("aGVsbG8=.deadbeef")).toBeNull();
    expect(
      decodeSignedDownloadToken(
        "not-base64!.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      ),
    ).toBeNull();
    expect(
      decodeSignedDownloadToken(
        `${Buffer.from('{"fileId":1}').toString("base64url")}.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`,
      ),
    ).toBeNull();
  });
});

describe("verifySignedDownloadToken", () => {
  test("accepts a valid unexpired token", () => {
    const token = createSignedDownloadToken(SECRET, input());
    expect(
      verifySignedDownloadToken(SECRET, token, {
        fileId: "file-1",
        organizationId: "org-1",
        now: NOW,
      }),
    ).toBe(true);
  });

  test("rejects a tampered payload", () => {
    const token = createSignedDownloadToken(SECRET, input());
    const separatorIndex = token.lastIndexOf(".");
    const tampered =
      token.slice(0, separatorIndex).replace("file-1", "file-2") + token.slice(separatorIndex);
    expect(
      verifySignedDownloadToken(SECRET, tampered, {
        fileId: "file-2",
        organizationId: "org-1",
        now: NOW,
      }),
    ).toBe(false);
  });

  test("rejects a token signed with a different secret", () => {
    const token = createSignedDownloadToken("other-secret", input());
    expect(
      verifySignedDownloadToken(SECRET, token, {
        fileId: "file-1",
        organizationId: "org-1",
        now: NOW,
      }),
    ).toBe(false);
  });

  test("rejects an expired token", () => {
    const token = createSignedDownloadToken(
      SECRET,
      input({ expiresAt: new Date(NOW.getTime() - 1000) }),
    );
    expect(
      verifySignedDownloadToken(SECRET, token, {
        fileId: "file-1",
        organizationId: "org-1",
        now: NOW,
      }),
    ).toBe(false);
  });

  test("rejects a token expiring exactly now (exp must be strictly greater)", () => {
    const token = createSignedDownloadToken(SECRET, input({ expiresAt: NOW }));
    expect(
      verifySignedDownloadToken(SECRET, token, {
        fileId: "file-1",
        organizationId: "org-1",
        now: NOW,
      }),
    ).toBe(false);
  });

  test("rejects claims that do not match the caller's expectation", () => {
    const token = createSignedDownloadToken(SECRET, input());
    expect(
      verifySignedDownloadToken(SECRET, token, {
        fileId: "file-1",
        organizationId: "org-2",
        now: NOW,
      }),
    ).toBe(false);
    expect(
      verifySignedDownloadToken(SECRET, token, {
        fileId: "file-2",
        organizationId: "org-1",
        now: NOW,
      }),
    ).toBe(false);
  });

  test("never throws on malformed input", () => {
    expect(
      verifySignedDownloadToken(SECRET, "", {
        fileId: "file-1",
        organizationId: "org-1",
        now: NOW,
      }),
    ).toBe(false);
    expect(
      verifySignedDownloadToken(SECRET, "garbage", {
        fileId: "file-1",
        organizationId: "org-1",
        now: NOW,
      }),
    ).toBe(false);
    expect(
      verifySignedDownloadToken(SECRET, "..", {
        fileId: "file-1",
        organizationId: "org-1",
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("buildSignedDownloadUrl", () => {
  test("builds a public download URL with the token as the only query parameter", () => {
    const url = buildSignedDownloadUrl("https://api.example.com/", SECRET, input());
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://api.example.com/api/v1/files/download");
    const token = parsed.searchParams.get("token");
    expect(token).toBeString();
    expect(
      verifySignedDownloadToken(SECRET, token as string, {
        fileId: "file-1",
        organizationId: "org-1",
        now: NOW,
      }),
    ).toBe(true);
  });

  test("handles a base URL without trailing slash", () => {
    const url = buildSignedDownloadUrl("https://api.example.com", SECRET, input());
    expect(url.startsWith("https://api.example.com/api/v1/files/download?token=")).toBe(true);
  });
});
