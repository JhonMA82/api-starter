import { ProblemDetailsSchema } from "@consulting/contracts";
import { buildProblemDetails, mapValidationIssues } from "@consulting/core";
import { sValidator } from "@hono/standard-validator";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { sayHello } from "../application/say-hello";
import { HelloQuery, HelloResponse } from "./schemas";

const PROBLEM_JSON = { "content-type": "application/problem+json" } as const;

export const exampleRoutes = new Hono().get(
  "/example/hello",
  describeRoute({
    description: "Greets a caller by name",
    responses: {
      200: {
        description: "Greeting message",
        content: { "application/json": { schema: resolver(HelloResponse) } },
      },
      400: {
        description: "Validation failed",
        content: { "application/problem+json": { schema: resolver(ProblemDetailsSchema) } },
      },
    },
  }),
  sValidator("query", HelloQuery, (result, c) => {
    if (result.success) {
      return undefined;
    }
    return c.json(
      buildProblemDetails({
        status: 400,
        code: "VALIDATION_FAILED",
        errors: mapValidationIssues(result.error),
        requestId: c.get("requestId"),
        instance: c.req.path,
      }),
      400,
      PROBLEM_JSON,
    );
  }),
  (c) => c.json(sayHello(c.req.valid("query")), 200),
);
