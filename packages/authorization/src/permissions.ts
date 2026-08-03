export const PERMISSIONS = [
  "request.create",
  "request.read",
  "request.update",
  "request.assign",
  "request.review",
  "request.approve",
  "request.reject",
  "request.export",
  "request.delete",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  "request.create": "Create a new request",
  "request.read": "Read a request",
  "request.update": "Update a request",
  "request.assign": "Assign a request to an actor",
  "request.review": "Review a request",
  "request.approve": "Approve a request",
  "request.reject": "Reject a request",
  "request.export": "Export request data",
  "request.delete": "Delete a request",
};
