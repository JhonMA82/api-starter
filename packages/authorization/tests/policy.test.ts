import { describe, expect, test } from "bun:test";

import type { Actor } from "../src/authorization";
import type { RequestResource } from "../src/policy";
import { canApproveRequest, canDeleteRequest, canUpdateRequest } from "../src/policy";

function actor(id: string, roles: Actor["roles"]): Actor {
  return { id, roles };
}

function request(overrides: Partial<RequestResource> = {}): RequestResource {
  return { id: "req-1", ownerId: "owner-1", status: "draft", ...overrides };
}

describe("canUpdateRequest", () => {
  test("allows the owner to update their own request in any status", () => {
    const member = actor("owner-1", ["member"]);
    expect(canUpdateRequest({ actor: member, request: request({ status: "draft" }) })).toBe(true);
    expect(canUpdateRequest({ actor: member, request: request({ status: "submitted" }) })).toBe(
      true,
    );
  });

  test("allows a non-owner to update a draft request", () => {
    const member = actor("someone-else", ["member"]);
    expect(canUpdateRequest({ actor: member, request: request({ status: "draft" }) })).toBe(true);
  });

  test("denies a non-owner to update a submitted request", () => {
    const member = actor("someone-else", ["member"]);
    expect(canUpdateRequest({ actor: member, request: request({ status: "submitted" }) })).toBe(
      false,
    );
  });

  test("denies actors without request.update even when owner or draft", () => {
    const reviewer = actor("owner-1", ["reviewer"]);
    expect(canUpdateRequest({ actor: reviewer, request: request({ status: "draft" }) })).toBe(
      false,
    );
  });
});

describe("canApproveRequest", () => {
  test("allows a reviewer to approve someone else's submitted request", () => {
    const reviewer = actor("reviewer-1", ["reviewer"]);
    expect(
      canApproveRequest({
        actor: reviewer,
        request: request({ ownerId: "owner-1", status: "submitted" }),
      }),
    ).toBe(true);
  });

  test("denies approval while the request is not submitted", () => {
    const reviewer = actor("reviewer-1", ["reviewer"]);
    expect(canApproveRequest({ actor: reviewer, request: request({ status: "draft" }) })).toBe(
      false,
    );
  });

  test("denies the owner from approving their own request even as admin", () => {
    const admin = actor("owner-1", ["admin"]);
    expect(
      canApproveRequest({
        actor: admin,
        request: request({ ownerId: "owner-1", status: "submitted" }),
      }),
    ).toBe(false);
  });

  test("denies actors without request.approve", () => {
    const member = actor("someone-else", ["member"]);
    expect(
      canApproveRequest({
        actor: member,
        request: request({ status: "submitted" }),
      }),
    ).toBe(false);
  });
});

describe("canDeleteRequest", () => {
  test("allows the owner to delete their own draft request", () => {
    const admin = actor("owner-1", ["admin"]);
    expect(canDeleteRequest({ actor: admin, request: request({ status: "draft" }) })).toBe(true);
  });

  test("allows an admin to delete any request regardless of ownership or status", () => {
    const admin = actor("admin-1", ["admin"]);
    expect(
      canDeleteRequest({
        actor: admin,
        request: request({ ownerId: "owner-1", status: "approved" }),
      }),
    ).toBe(true);
  });

  test("denies a member owner of a draft request for lack of request.delete", () => {
    const member = actor("owner-1", ["member"]);
    expect(canDeleteRequest({ actor: member, request: request({ status: "draft" }) })).toBe(false);
  });

  test("denies a non-owner member even on a draft request", () => {
    const member = actor("someone-else", ["member"]);
    expect(canDeleteRequest({ actor: member, request: request({ status: "draft" }) })).toBe(false);
  });

  test("denies a reviewer owner of a non-draft request", () => {
    const reviewer = actor("owner-1", ["reviewer"]);
    expect(canDeleteRequest({ actor: reviewer, request: request({ status: "approved" }) })).toBe(
      false,
    );
  });
});
