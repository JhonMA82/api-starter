import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  closeClient,
  createTestClient,
  getDatabaseUrl,
  migrateToLatest,
  resetDatabase,
} from "../../notes/tests/db-test-utils";
import {
  ApiKeyNotFoundError,
  createApiKeyRepository,
  createDb,
  createOrganizationRepository,
} from "../src";
import { hashApiKeySecret } from "../src/application/api-key-token";

const databaseUrl = getDatabaseUrl();
const describeDb = databaseUrl === null ? describe.skip : describe;
if (databaseUrl === null) {
  console.warn("[api key repository tests] DATABASE_URL is not set — skipping real-DB tests");
}

describeDb("api key repositories (real database)", () => {
  const client = createTestClient(databaseUrl as string);

  beforeAll(async () => {
    await resetDatabase(client);
    await migrateToLatest(client);
  });

  afterAll(async () => {
    await closeClient(client);
  });

  test("create, findByKeyHash, findById, listByOrganization, revoke, markUsed lifecycle", async () => {
    const db = createDb(client);
    const organizations = createOrganizationRepository(db);
    const repository = createApiKeyRepository(db);
    const organization = await organizations.create({
      name: "Keys Org",
      slug: `keys-${crypto.randomUUID()}`,
    });
    const keyHash = hashApiKeySecret(`secret-${crypto.randomUUID()}`);

    const created = await repository.create({
      organizationId: organization.id,
      name: "CI deploy key",
      prefix: keyHash.slice(0, 8),
      keyHash,
      expiresAt: null,
    });
    expect(created.id).toBeString();
    expect(created.organizationId).toBe(organization.id);
    expect(created.name).toBe("CI deploy key");
    expect(created.prefix).toBe(keyHash.slice(0, 8));
    expect(created.expiresAt).toBeNull();
    expect(created.revokedAt).toBeNull();
    expect(created.lastUsedAt).toBeNull();
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);

    expect(await repository.findByKeyHash(keyHash)).toEqual(created);
    expect(await repository.findById({ organizationId: organization.id, id: created.id })).toEqual(
      created,
    );
    expect(await repository.findByKeyHash(hashApiKeySecret("missing"))).toBeNull();
    expect(
      await repository.findById({ organizationId: organization.id, id: crypto.randomUUID() }),
    ).toBeNull();

    expect((await repository.listByOrganization(organization.id)).map((key) => key.id)).toEqual([
      created.id,
    ]);

    const usedAt = new Date("2026-02-02T03:04:05Z");
    await repository.markUsed(created.id, usedAt);
    expect(
      (await repository.findById({ organizationId: organization.id, id: created.id }))?.lastUsedAt,
    ).not.toBeNull();

    const revokedAt = new Date("2026-03-03T03:04:05Z");
    const revoked = await repository.revoke({
      organizationId: organization.id,
      id: created.id,
      revokedAt,
    });
    expect(revoked.revokedAt?.getTime()).toBe(revokedAt.getTime());
    expect(
      (await repository.findById({ organizationId: organization.id, id: created.id }))?.revokedAt,
    ).not.toBeNull();

    await expect(
      repository.revoke({
        organizationId: organization.id,
        id: crypto.randomUUID(),
        revokedAt,
      }),
    ).rejects.toBeInstanceOf(ApiKeyNotFoundError);
  });

  test("findById and revoke are tenant-scoped (IDOR guard)", async () => {
    const db = createDb(client);
    const organizations = createOrganizationRepository(db);
    const repository = createApiKeyRepository(db);
    const orgA = await organizations.create({
      name: "Keys Org A",
      slug: `keys-a-${crypto.randomUUID()}`,
    });
    const orgB = await organizations.create({
      name: "Keys Org B",
      slug: `keys-b-${crypto.randomUUID()}`,
    });

    const keyInB = await repository.create({
      organizationId: orgB.id,
      name: "B's key",
      prefix: "prefix-b",
      keyHash: hashApiKeySecret(`secret-b-${crypto.randomUUID()}`),
      expiresAt: null,
    });

    expect(await repository.findById({ organizationId: orgA.id, id: keyInB.id })).toBeNull();
    await expect(
      repository.revoke({ organizationId: orgA.id, id: keyInB.id, revokedAt: new Date() }),
    ).rejects.toBeInstanceOf(ApiKeyNotFoundError);

    expect(await repository.findById({ organizationId: orgB.id, id: keyInB.id })).toEqual(keyInB);
    expect(
      (await repository.revoke({ organizationId: orgB.id, id: keyInB.id, revokedAt: new Date() }))
        .revokedAt,
    ).not.toBeNull();
  });

  test("verify path: findByKeyHash then markUsed persists lastUsedAt", async () => {
    const db = createDb(client);
    const organizations = createOrganizationRepository(db);
    const repository = createApiKeyRepository(db);
    const organization = await organizations.create({
      name: "Verify Org",
      slug: `verify-${crypto.randomUUID()}`,
    });
    const secret = `verify-secret-${crypto.randomUUID()}`;
    const key = await repository.create({
      organizationId: organization.id,
      name: "verify key",
      prefix: secret.slice(0, 8),
      keyHash: hashApiKeySecret(secret),
      expiresAt: null,
    });

    const found = await repository.findByKeyHash(hashApiKeySecret(secret));
    expect(found?.id).toBe(key.id);

    await repository.markUsed(key.id, new Date());
    const after = await repository.findById({ organizationId: organization.id, id: key.id });
    expect(after?.lastUsedAt).not.toBeNull();
  });

  test("cascades on organization delete", async () => {
    const db = createDb(client);
    const organizations = createOrganizationRepository(db);
    const repository = createApiKeyRepository(db);
    const organization = await organizations.create({
      name: "Cascade Org",
      slug: `cascade-${crypto.randomUUID()}`,
    });
    const key = await repository.create({
      organizationId: organization.id,
      name: "cascade key",
      prefix: "prefix-c",
      keyHash: hashApiKeySecret(`cascade-secret-${crypto.randomUUID()}`),
      expiresAt: null,
    });

    await organizations.delete(organization.id);

    expect(await repository.findById({ organizationId: organization.id, id: key.id })).toBeNull();
    expect(await repository.listByOrganization(organization.id)).toEqual([]);
  });
});
