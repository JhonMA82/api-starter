import { z } from "zod";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const OrganizationResponse = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: z.enum(["active", "suspended"]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type OrganizationResponse = z.infer<typeof OrganizationResponse>;

export const MembershipResponse = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  role: z.enum(["owner", "admin", "auditor", "member"]),
  status: z.enum(["active", "inactive"]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type MembershipResponse = z.infer<typeof MembershipResponse>;

export const CreateOrganizationBody = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(
      SLUG_PATTERN,
      "slug must be kebab-case: lowercase letters or digits, single hyphens between segments",
    ),
});
export type CreateOrganizationBody = z.infer<typeof CreateOrganizationBody>;

export const InviteMemberBody = z.object({
  email: z.email(),
  role: z.enum(["admin", "auditor", "member"]),
});
export type InviteMemberBody = z.infer<typeof InviteMemberBody>;

export const AcceptInvitationBody = z.object({
  token: z.string().min(32),
});
export type AcceptInvitationBody = z.infer<typeof AcceptInvitationBody>;

export const TransferOwnershipBody = z.object({
  newOwnerUserId: z.string().min(1),
});
export type TransferOwnershipBody = z.infer<typeof TransferOwnershipBody>;

export const InvitationResponse = z.object({
  id: z.string(),
  organizationId: z.string(),
  email: z.string(),
  role: z.enum(["owner", "admin", "auditor", "member"]),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type InvitationResponse = z.infer<typeof InvitationResponse>;

export const TenantContextResponse = z.object({
  organizationId: z.string(),
  membershipId: z.string(),
  userId: z.string(),
  roleIds: z.array(z.string()),
});
export type TenantContextResponse = z.infer<typeof TenantContextResponse>;

export const CreateApiKeyBody = z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.iso.datetime().optional(),
});
export type CreateApiKeyBody = z.infer<typeof CreateApiKeyBody>;

export const ApiKeyResponse = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  prefix: z.string(),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  lastUsedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ApiKeyResponse = z.infer<typeof ApiKeyResponse>;
