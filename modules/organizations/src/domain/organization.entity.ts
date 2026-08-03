import { OrganizationNameError, OrganizationSlugError } from "./organization.errors";

export type OrganizationStatus = "active" | "suspended";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  createdAt: Date;
  updatedAt: Date;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertValidOrganizationName(name: string): void {
  if (name.trim() === "") {
    throw new OrganizationNameError("organization name must not be blank");
  }
}

export function assertValidSlug(slug: string): void {
  if (slug.trim() === "" || !SLUG_PATTERN.test(slug)) {
    throw new OrganizationSlugError(
      "slug must be kebab-case: lowercase letters or digits, single hyphens between segments",
    );
  }
}
