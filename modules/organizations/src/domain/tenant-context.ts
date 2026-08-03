export interface TenantContext {
  organizationId: string;
  membershipId: string;
  userId: string;
  roleIds: string[];
}

export function createTenantContext(input: {
  organizationId: string;
  membershipId: string;
  userId: string;
  roleIds: readonly string[];
}): TenantContext {
  return {
    organizationId: input.organizationId,
    membershipId: input.membershipId,
    userId: input.userId,
    roleIds: [...input.roleIds],
  };
}
