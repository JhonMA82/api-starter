import { describe, expect, test } from "bun:test";

import { generateApiKeySecret, hashApiKeySecret } from "../src/application/api-key-token";
import { createApiKeyUseCase } from "../src/application/create-api-key";
import { createOrganizationAudit } from "../src/application/organization-audit";
import { revokeApiKeyUseCase } from "../src/application/revoke-api-key";
import { verifyApiKeyUseCase } from "../src/application/verify-api-key";
import { assertValidApiKeyName, isApiKeyActive } from "../src/domain/api-key.entity";
import {
  ApiKeyNameError,
  ApiKeyNotFoundError,
  ForbiddenOrganizationActionError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
  OrganizationSuspendedError,
} from "../src/domain/organization.errors";
import {
  createFakeAudit,
  createFakeRepositories,
  createFakeUnitOfWork,
  makeApiKey,
  makeMembership,
  makeOrganization,
} from "./fakes";

describe("generateApiKeySecret", () => {
  test("produces a base64url secret with the first 8 chars as prefix and the sha256 hex as hash", () => {
    const { secret, prefix, keyHash } = generateApiKeySecret();

    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(prefix).toBe(secret.slice(0, 8));
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(keyHash).toBe(hashApiKeySecret(secret));
    expect(secret).not.toBe(keyHash);
  });

  test("generates a unique secret on every call", () => {
    const secrets = new Set(Array.from({ length: 64 }, () => generateApiKeySecret().secret));
    expect(secrets.size).toBe(64);
  });

  test("hashApiKeySecret is deterministic for the same input", () => {
    expect(hashApiKeySecret("abc")).toBe(hashApiKeySecret("abc"));
    expect(hashApiKeySecret("abc")).not.toBe(hashApiKeySecret("abd"));
  });
});

describe("assertValidApiKeyName", () => {
  test("accepts a normal name", () => {
    expect(() => assertValidApiKeyName("CI deploy key")).not.toThrow();
  });

  test("rejects a blank name", () => {
    expect(() => assertValidApiKeyName("   ")).toThrow(ApiKeyNameError);
    expect(() => assertValidApiKeyName("")).toThrow(ApiKeyNameError);
  });

  test("rejects a name longer than 100 characters", () => {
    expect(() => assertValidApiKeyName("x".repeat(101))).toThrow(ApiKeyNameError);
    expect(() => assertValidApiKeyName("x".repeat(100))).not.toThrow();
  });
});

describe("isApiKeyActive", () => {
  const now = new Date("2026-08-03T12:00:00Z");

  test("active when never revoked and no expiry", () => {
    expect(isApiKeyActive(makeApiKey(), now)).toBe(true);
  });

  test("inactive when revoked even if not expired", () => {
    expect(
      isApiKeyActive(
        makeApiKey({
          revokedAt: new Date("2026-07-01T00:00:00Z"),
          expiresAt: new Date("2099-01-01"),
        }),
        now,
      ),
    ).toBe(false);
  });

  test("inactive when expired and active when expiry is in the future", () => {
    expect(isApiKeyActive(makeApiKey({ expiresAt: new Date("2026-01-01T00:00:00Z") }), now)).toBe(
      false,
    );
    expect(isApiKeyActive(makeApiKey({ expiresAt: new Date("2099-01-01T00:00:00Z") }), now)).toBe(
      true,
    );
  });
});

describe("createApiKeyUseCase", () => {
  const org = makeOrganization();

  function setup(role: "owner" | "admin" | "auditor" | "member" = "owner") {
    const repos = createFakeRepositories();
    repos.organizationStore.set(org.id, org);
    repos.membershipStore.set("membership-1", makeMembership({ userId: "user-1", role }));
    const { audit, records } = createFakeAudit();
    const useCase = createApiKeyUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
      apiKeys: repos.apiKeys,
      audit: createOrganizationAudit(audit),
    });
    return { repos, useCase, records };
  }

  test("creates a key storing only the hash and prefix, returning the secret once", async () => {
    const { repos, useCase } = setup();

    const { apiKey, secret } = await useCase({
      actorUserId: "user-1",
      organizationId: org.id,
      name: "CI deploy key",
    });

    expect(apiKey.name).toBe("CI deploy key");
    expect(apiKey.prefix).toBe(secret.slice(0, 8));
    expect(apiKey.keyHash).toBe(hashApiKeySecret(secret));
    expect(apiKey.expiresAt).toBeNull();
    expect(apiKey.revokedAt).toBeNull();
    expect(apiKey.lastUsedAt).toBeNull();
    expect(repos.apiKeyStore.get(apiKey.id)?.keyHash).toBe(hashApiKeySecret(secret));
    expect(repos.apiKeyStore.get(apiKey.id)?.name).toBe("CI deploy key");
  });

  test("honors an optional expiresAt", async () => {
    const { useCase } = setup();
    const expiresAt = new Date("2099-01-01T00:00:00Z");

    const { apiKey } = await useCase({
      actorUserId: "user-1",
      organizationId: org.id,
      name: "short-lived",
      expiresAt,
    });

    expect(apiKey.expiresAt?.getTime()).toBe(expiresAt.getTime());
  });

  test("records an api_key.created audit entry when an audit logger is provided", async () => {
    const { useCase, records } = setup();

    const { secret } = await useCase({
      actorUserId: "user-1",
      organizationId: org.id,
      name: "CI deploy key",
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      actorUserId: "user-1",
      action: "api_key.created",
      resourceType: "api_key",
      resourceId: org.id,
      outcome: "success",
      metadata: { name: "CI deploy key", prefix: secret.slice(0, 8) },
    });
  });

  test("rejects a blank name with ApiKeyNameError before creating anything", async () => {
    const { repos, useCase } = setup();

    await expect(
      useCase({ actorUserId: "user-1", organizationId: org.id, name: "  " }),
    ).rejects.toThrow(ApiKeyNameError);
    expect(repos.apiKeyStore.size).toBe(0);
  });

  test("rejects an unknown organization with OrganizationNotFoundError", async () => {
    const { repos, useCase } = setup();

    await expect(
      useCase({ actorUserId: "user-1", organizationId: "missing-org", name: "key" }),
    ).rejects.toThrow(OrganizationNotFoundError);
    expect(repos.apiKeyStore.size).toBe(0);
  });

  test("rejects a suspended organization with OrganizationSuspendedError", async () => {
    const { repos, useCase } = setup();
    repos.organizationStore.set(org.id, makeOrganization({ status: "suspended" }));

    await expect(
      useCase({ actorUserId: "user-1", organizationId: org.id, name: "key" }),
    ).rejects.toThrow(OrganizationSuspendedError);
  });

  test("rejects a non-member actor with MembershipNotFoundError", async () => {
    const repos = createFakeRepositories();
    repos.organizationStore.set(org.id, org);
    const useCase = createApiKeyUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
      apiKeys: repos.apiKeys,
    });

    await expect(
      useCase({ actorUserId: "stranger", organizationId: org.id, name: "key" }),
    ).rejects.toThrow(MembershipNotFoundError);
  });

  test("rejects an inactive membership with MembershipNotFoundError", async () => {
    const { repos, useCase } = setup();
    repos.membershipStore.set(
      "membership-1",
      makeMembership({ userId: "user-1", role: "owner", status: "inactive" }),
    );

    await expect(
      useCase({ actorUserId: "user-1", organizationId: org.id, name: "key" }),
    ).rejects.toThrow(MembershipNotFoundError);
  });

  test.each(["member", "auditor"] as const)(
    "rejects a %s actor with ForbiddenOrganizationActionError",
    async (role) => {
      const { repos, useCase } = setup(role);

      await expect(
        useCase({ actorUserId: "user-1", organizationId: org.id, name: "key" }),
      ).rejects.toThrow(ForbiddenOrganizationActionError);
      expect(repos.apiKeyStore.size).toBe(0);
    },
  );
});

describe("revokeApiKeyUseCase", () => {
  const org = makeOrganization();
  const key = makeApiKey({ id: "api-key-1", keyHash: hashApiKeySecret("some-secret") });

  function setup(role: "owner" | "admin" | "member" = "owner") {
    const repos = createFakeRepositories();
    repos.organizationStore.set(org.id, org);
    repos.membershipStore.set("membership-1", makeMembership({ userId: "user-1", role }));
    repos.apiKeyStore.set(key.id, key);
    const { audit, records } = createFakeAudit();
    const useCase = revokeApiKeyUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
      apiKeys: repos.apiKeys,
      audit: createOrganizationAudit(audit),
    });
    return { repos, useCase, records };
  }

  test("revokes the key and records an api_key.revoked audit entry", async () => {
    const { repos, useCase, records } = setup();

    const revoked = await useCase({
      actorUserId: "user-1",
      organizationId: org.id,
      keyId: key.id,
    });

    expect(revoked.revokedAt).not.toBeNull();
    expect(repos.apiKeyStore.get(key.id)?.revokedAt).not.toBeNull();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      actorUserId: "user-1",
      action: "api_key.revoked",
      resourceType: "api_key",
      resourceId: org.id,
      outcome: "success",
      metadata: { name: key.name, prefix: key.prefix },
    });
  });

  test("rejects a member actor with ForbiddenOrganizationActionError", async () => {
    const { repos, useCase } = setup("member");

    await expect(
      useCase({ actorUserId: "user-1", organizationId: org.id, keyId: key.id }),
    ).rejects.toThrow(ForbiddenOrganizationActionError);
    expect(repos.apiKeyStore.get(key.id)?.revokedAt).toBeNull();
  });

  test("throws ApiKeyNotFoundError for a key that does not belong to the organization", async () => {
    const { useCase } = setup();

    await expect(
      useCase({ actorUserId: "user-1", organizationId: org.id, keyId: "other-org-key" }),
    ).rejects.toThrow(ApiKeyNotFoundError);
  });

  test("rejects an unknown organization with OrganizationNotFoundError", async () => {
    const { useCase } = setup();

    await expect(
      useCase({ actorUserId: "user-1", organizationId: "missing-org", keyId: key.id }),
    ).rejects.toThrow(OrganizationNotFoundError);
  });

  test("rejects a suspended organization with OrganizationSuspendedError", async () => {
    const { repos, useCase } = setup();
    repos.organizationStore.set(org.id, makeOrganization({ status: "suspended" }));

    await expect(
      useCase({ actorUserId: "user-1", organizationId: org.id, keyId: key.id }),
    ).rejects.toThrow(OrganizationSuspendedError);
  });

  test("rejects a non-member actor with MembershipNotFoundError", async () => {
    const { useCase } = setup();

    await expect(
      useCase({ actorUserId: "stranger", organizationId: org.id, keyId: key.id }),
    ).rejects.toThrow(MembershipNotFoundError);
  });

  test("appends an api_key.revoked outbox event when a unit of work is provided", async () => {
    const repos = createFakeRepositories();
    repos.organizationStore.set(org.id, org);
    repos.membershipStore.set("membership-1", makeMembership({ userId: "user-1", role: "owner" }));
    repos.apiKeyStore.set(key.id, key);
    const { uow } = createFakeUnitOfWork(repos);
    const useCase = revokeApiKeyUseCase({
      organizations: repos.organizations,
      memberships: repos.memberships,
      apiKeys: repos.apiKeys,
      uow,
    });

    await useCase({ actorUserId: "user-1", organizationId: org.id, keyId: key.id });

    expect(repos.apiKeyStore.get(key.id)?.revokedAt).not.toBeNull();
    expect(repos.outboxStore).toHaveLength(1);
    expect(repos.outboxStore[0]).toMatchObject({
      type: "api_key.revoked",
      organizationId: org.id,
      actorUserId: "user-1",
    });
    expect(repos.outboxStore[0]?.payload).toMatchObject({
      apiKeyId: key.id,
      name: key.name,
      prefix: key.prefix,
    });
  });
});

describe("verifyApiKeyUseCase", () => {
  const org = makeOrganization();
  const secret = "a-secret-value";
  const key = makeApiKey({ id: "api-key-1", keyHash: hashApiKeySecret(secret) });

  function setup(overrides: Partial<Parameters<typeof makeApiKey>[0]> = {}) {
    const repos = createFakeRepositories();
    repos.organizationStore.set(org.id, org);
    repos.apiKeyStore.set(key.id, { ...key, ...overrides });
    const useCase = verifyApiKeyUseCase({ apiKeys: repos.apiKeys });
    return { repos, useCase };
  }

  test("returns the key for a valid secret and records lastUsedAt", async () => {
    const { repos, useCase } = setup();

    const result = await useCase({ secret });

    expect(result?.id).toBe(key.id);
    expect(result?.organizationId).toBe(org.id);
    expect(result?.keyHash).toBe(hashApiKeySecret(secret));
    expect(repos.apiKeyStore.get(key.id)?.lastUsedAt).not.toBeNull();
  });

  test("returns null for an unknown secret", async () => {
    const { repos, useCase } = setup();

    await expect(useCase({ secret: "wrong-secret" })).resolves.toBeNull();
    expect(repos.apiKeyStore.get(key.id)?.lastUsedAt).toBeNull();
  });

  test("returns null for a revoked key", async () => {
    const { useCase } = setup({ revokedAt: new Date("2026-07-01T00:00:00Z") });

    await expect(useCase({ secret })).resolves.toBeNull();
  });

  test("returns null for an expired key", async () => {
    const { useCase } = setup({ expiresAt: new Date("2026-01-01T00:00:00Z") });

    await expect(useCase({ secret })).resolves.toBeNull();
  });
});
