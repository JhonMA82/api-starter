import { ProblemDetailsSchema } from "@consulting/contracts";
import { buildProblemDetails, mapValidationIssues, type ValidationIssue } from "@consulting/core";
import type { TenantContext } from "@consulting/module-organizations";
import { sValidator } from "@hono/standard-validator";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";

import { createDeleteFileUseCase } from "../application/delete-file";
import { createListFilesUseCase } from "../application/list-files";
import type {
  FileHashing,
  FileRepository,
  FileStorage,
  MembershipGuard,
} from "../application/ports";
import {
  buildSignedDownloadUrl,
  decodeSignedDownloadToken,
  verifySignedDownloadToken,
} from "../application/signed-url";
import { createUploadFileUseCase } from "../application/upload-file";
import { MAX_FILE_SIZE_BYTES, type StoredFile, sanitizeFileName } from "../domain/file.entity";
import { FileTooLargeError } from "../domain/file.errors";
import { toFileHttpException } from "./errors";
import {
  DownloadUrlResponse,
  type FileResponse as FileResponseType,
  FileWithDownloadUrlResponse,
  ListResponse,
  UploadResponse,
} from "./schemas";

const PROBLEM_JSON = { "content-type": "application/problem+json" } as const;
const problem = { "application/problem+json": { schema: resolver(ProblemDetailsSchema) } };

/** Default validity of a signed download URL, in seconds (1 hour). */
export const DEFAULT_EXPIRY_SECONDS = 3_600;
/** Upper bound for a client-requested expiry, in seconds (24 hours). */
export const MAX_EXPIRY_SECONDS = 86_400;

function validationResponses() {
  return {
    400: { description: "Validation failed", content: problem },
    500: { description: "Internal error", content: problem },
  };
}

function sessionResponses() {
  return {
    ...validationResponses(),
    401: { description: "Missing or invalid session", content: problem },
  };
}

function tenantResponses() {
  return {
    ...sessionResponses(),
    403: {
      description: "Insufficient permissions or no access to the organization",
      content: problem,
    },
    404: { description: "Organization or file not found", content: problem },
    503: { description: "File storage unavailable", content: problem },
  };
}

/**
 * Structural stand-in for the app's auth session variables (the module must
 * not import @consulting/auth). Mirrors the organizations
 * OrganizationHttpVariables but scoped to what the files routes read.
 */
export interface FileHttpVariables {
  user: { id: string } | null;
  tenant: TenantContext | null;
  requestId?: string;
}

export interface FileRoutesDeps {
  /** Membership check, wired from the organizations tenancy service. */
  guard: MembershipGuard;
  files: FileRepository;
  storage: FileStorage;
  hash: FileHashing;
  /** HMAC secret for signed download tokens. */
  signedUrlSecret: string;
  /** Public API origin used to build download links (e.g. https://api.example.com). */
  baseUrl: string;
  /** Upload size cap in bytes; defaults to MAX_FILE_SIZE_BYTES (10 MiB). */
  maxUploadBytes?: number;
  /** The organizations tenant middleware, passed in (not imported). */
  tenantContext: MiddlewareHandler;
}

function validationErrorHandler(
  result: { success: true } | { success: false; error: readonly ValidationIssue[] },
  c: Context,
): Response | undefined {
  if (result.success) {
    return undefined;
  }
  return c.json(
    buildProblemDetails({
      status: 400,
      code: "VALIDATION_FAILED",
      errors: mapValidationIssues(result.error),
      requestId: c.get("requestId") ?? "",
      instance: c.req.path,
    }),
    400,
    PROBLEM_JSON,
  );
}

function toFileResponse(file: StoredFile): FileResponseType {
  return {
    id: file.id,
    organizationId: file.organizationId,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    status: file.status,
    createdAt: file.createdAt.toISOString(),
    deletedAt: file.deletedAt === null ? null : file.deletedAt.toISOString(),
  };
}

function requireUser(c: Context<{ Variables: FileHttpVariables }>): { id: string } {
  const user = c.get("user");
  if (user === null) {
    throw new HTTPException(401);
  }
  return user;
}

function requireTenant(c: Context<{ Variables: FileHttpVariables }>): TenantContext {
  const tenant = c.get("tenant");
  if (tenant === null) {
    throw new HTTPException(401);
  }
  return tenant;
}

/**
 * Files HTTP surface (spec §15). All routes mount under /api/v1 via the app
 * wiring; tenant-scoped routes sit behind the organizations tenant middleware
 * and the session, while GET /files/download is PUBLIC: the HMAC signature of
 * the token IS the authorization, and the token's embedded organizationId
 * scopes the lookup.
 */
export function createFileRoutes(deps: FileRoutesDeps): Hono<{ Variables: FileHttpVariables }> {
  const app = new Hono<{ Variables: FileHttpVariables }>();
  const tenantContext = deps.tenantContext;
  const maxUploadBytes = deps.maxUploadBytes ?? MAX_FILE_SIZE_BYTES;

  const upload = createUploadFileUseCase({
    files: deps.files,
    storage: deps.storage,
    hash: deps.hash,
    guard: deps.guard,
  });
  const remove = createDeleteFileUseCase({ files: deps.files, guard: deps.guard });
  const list = createListFilesUseCase({ files: deps.files, guard: deps.guard });

  function issueDownloadUrl(
    file: { id: string; organizationId: string },
    expiresIn: number,
  ): string {
    return buildSignedDownloadUrl(deps.baseUrl, deps.signedUrlSecret, {
      fileId: file.id,
      organizationId: file.organizationId,
      expiresAt: new Date(Date.now() + expiresIn * 1_000),
    });
  }

  app.post(
    "/files",
    describeRoute({
      description:
        'Uploads a file as multipart/form-data (field "file"). The upload is stored ' +
        "under a server-generated key and its sha256 recorded. Returns the stored " +
        "metadata plus an HMAC-signed download URL valid for 1 hour.",
      responses: {
        201: {
          description: "File uploaded",
          content: { "application/json": { schema: resolver(UploadResponse) } },
        },
        ...tenantResponses(),
      },
    }),
    tenantContext,
    async (c) => {
      const user = requireUser(c);
      const tenant = requireTenant(c);
      try {
        const formData = await c.req.formData();
        const formFile = formData.get("file");
        if (!(formFile instanceof File)) {
          throw new HTTPException(400);
        }
        if (formFile.size > maxUploadBytes) {
          throw new FileTooLargeError(formFile.size, maxUploadBytes);
        }
        const data = Buffer.from(await formFile.arrayBuffer());
        // Multipart parts may carry parameters ("text/plain;charset=utf-8");
        // the allowlist is keyed on the bare MIME type, so strip them.
        const mimeType = formFile.type.split(";")[0]?.trim() ?? "";
        const file = await upload({
          actorUserId: user.id,
          organizationId: tenant.organizationId,
          name: formFile.name,
          mimeType,
          data,
        });
        const downloadUrl = issueDownloadUrl(file, DEFAULT_EXPIRY_SECONDS);
        return c.json(
          { file: toFileResponse(file), downloadUrl, expiresIn: DEFAULT_EXPIRY_SECONDS },
          201,
        );
      } catch (error) {
        throw toFileHttpException(error);
      }
    },
  );

  app.get(
    "/files",
    describeRoute({
      description:
        "Lists the organization's stored files (newest first). Each item carries a " +
        "freshly issued HMAC-signed download URL valid for 1 hour.",
      responses: {
        200: {
          description: "Stored files of the organization",
          content: { "application/json": { schema: resolver(ListResponse) } },
        },
        ...tenantResponses(),
      },
    }),
    tenantContext,
    sValidator(
      "query",
      z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
      validationErrorHandler,
    ),
    async (c) => {
      const user = requireUser(c);
      const tenant = requireTenant(c);
      try {
        const files = await list({
          actorUserId: user.id,
          organizationId: tenant.organizationId,
          limit: c.req.valid("query").limit,
        });
        const items = files.map((file) => ({
          ...toFileResponse(file),
          downloadUrl: issueDownloadUrl(file, DEFAULT_EXPIRY_SECONDS),
        }));
        return c.json({ files: items }, 200);
      } catch (error) {
        throw toFileHttpException(error);
      }
    },
  );

  // PUBLIC by design: no tenant middleware, no session. The HMAC signature of
  // the token IS the authorization; the token's embedded organizationId scopes
  // the lookup. Invalid/expired tokens answer 401 without revealing why.
  // Registered BEFORE /files/:id so the static segment wins over the param.
  app.get(
    "/files/download",
    describeRoute({
      description:
        "Public file download via an HMAC-signed token. The token embeds the file " +
        "id, the organization id, and the expiry; it is issued by POST /files and " +
        "POST /files/:id/url. Invalid, tampered, or expired tokens answer 401; a " +
        "valid token for a missing or deleted file answers 404. Returns the raw " +
        "bytes with the stored content-type and an attachment disposition.",
      responses: {
        200: {
          description: "File bytes",
          content: {
            "application/octet-stream": { schema: { type: "string", format: "binary" } },
          },
        },
        400: { description: "Missing token", content: problem },
        401: { description: "Invalid, tampered, or expired token", content: problem },
        404: { description: "File not found", content: problem },
        500: { description: "Internal error", content: problem },
      },
    }),
    sValidator("query", z.object({ token: z.string().min(1) }), validationErrorHandler),
    async (c) => {
      const { token } = c.req.valid("query");
      const claims = decodeSignedDownloadToken(token);
      if (
        claims === null ||
        !verifySignedDownloadToken(deps.signedUrlSecret, token, {
          fileId: claims.fileId,
          organizationId: claims.organizationId,
          now: new Date(),
        })
      ) {
        throw new HTTPException(401);
      }
      try {
        const file = await deps.files.findById({
          organizationId: claims.organizationId,
          id: claims.fileId,
        });
        if (file === null || file.status !== "stored") {
          throw new HTTPException(404);
        }
        const data = await deps.storage.get(file.storageKey);
        const dispositionName = sanitizeFileName(file.name).replaceAll('"', "");
        return new Response(new Uint8Array(data), {
          status: 200,
          headers: {
            "content-type": file.mimeType,
            "content-disposition": `attachment; filename="${dispositionName}"`,
            "content-length": String(data.length),
          },
        });
      } catch (error) {
        throw toFileHttpException(error);
      }
    },
  );

  app.get(
    "/files/:id",
    describeRoute({
      description:
        "Returns the metadata of a single stored file plus a freshly issued " +
        "HMAC-signed download URL valid for 1 hour.",
      responses: {
        200: {
          description: "File metadata with download URL",
          content: { "application/json": { schema: resolver(FileWithDownloadUrlResponse) } },
        },
        ...tenantResponses(),
      },
    }),
    tenantContext,
    async (c) => {
      const tenant = requireTenant(c);
      try {
        const file = await deps.files.findById({
          organizationId: tenant.organizationId,
          id: c.req.param("id") as string,
        });
        if (file === null || file.status === "deleted") {
          throw new HTTPException(404);
        }
        return c.json(
          { ...toFileResponse(file), downloadUrl: issueDownloadUrl(file, DEFAULT_EXPIRY_SECONDS) },
          200,
        );
      } catch (error) {
        throw toFileHttpException(error);
      }
    },
  );

  app.delete(
    "/files/:id",
    describeRoute({
      description:
        "Soft-deletes a file: the row is marked deleted and the file disappears from " +
        "listings and downloads. The blob is removed later by a retention job.",
      responses: {
        204: { description: "File soft-deleted" },
        ...tenantResponses(),
      },
    }),
    tenantContext,
    async (c) => {
      const user = requireUser(c);
      const tenant = requireTenant(c);
      try {
        await remove({
          actorUserId: user.id,
          organizationId: tenant.organizationId,
          fileId: c.req.param("id") as string,
        });
        return c.body(null, 204);
      } catch (error) {
        throw toFileHttpException(error);
      }
    },
  );

  app.post(
    "/files/:id/url",
    describeRoute({
      description:
        "Issues a fresh HMAC-signed download URL for a stored file. The client may " +
        "request a validity of up to 24 hours (default 1 hour).",
      responses: {
        200: {
          description: "Fresh signed download URL",
          content: { "application/json": { schema: resolver(DownloadUrlResponse) } },
        },
        ...tenantResponses(),
      },
    }),
    tenantContext,
    sValidator(
      "json",
      z.object({
        expiresInSeconds: z.coerce.number().int().min(1).max(MAX_EXPIRY_SECONDS).optional(),
      }),
      validationErrorHandler,
    ),
    async (c) => {
      const tenant = requireTenant(c);
      try {
        const file = await deps.files.findById({
          organizationId: tenant.organizationId,
          id: c.req.param("id") as string,
        });
        if (file === null || file.status === "deleted") {
          throw new HTTPException(404);
        }
        const expiresIn = c.req.valid("json").expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS;
        const downloadUrl = issueDownloadUrl(file, expiresIn);
        return c.json({ downloadUrl, expiresIn }, 200);
      } catch (error) {
        throw toFileHttpException(error);
      }
    },
  );

  return app;
}
