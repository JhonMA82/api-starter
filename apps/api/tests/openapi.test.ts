import { describe, expect, test } from "bun:test";
import type { Config } from "@consulting/config";
import { ERROR_CODES } from "@consulting/core";
import type { OpenAPIV3_1 } from "openapi-types";
import { createApp } from "../src/app";

const config: Config = {
  APP_ENV: "test",
  APP_VERSION: "0.1.0",
  API_BASE_URL: "http://localhost:3000",
  LOG_LEVEL: "debug",
  PORT: 3000,
  HOST: "0.0.0.0",
  CORS_ORIGINS: ["https://app.example.com"],
};

const app = createApp(config);

const EXCLUDED_PATHS = new Set(["/openapi.json", "/docs"]);
const DOCUMENTED_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "trace",
] as const;

async function getSpec(): Promise<OpenAPIV3_1.Document> {
  const res = await app.request("/openapi.json");
  expect(res.status).toBe(200);
  return (await res.json()) as OpenAPIV3_1.Document;
}

describe("openapi document", () => {
  test("exposes a 3.1.0 document with info", async () => {
    const doc = await getSpec();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info).toBeDefined();
    expect(doc.info.title).toBe("@consulting/api");
    expect(doc.info.version).toBe("0.1.0");
  });

  test("every registered route is present in the spec paths", async () => {
    const doc = await getSpec();
    const specPaths = new Set(Object.keys(doc.paths ?? {}));
    const undocumented: string[] = [];
    for (const route of app.routes) {
      if (route.method === "ALL") {
        continue;
      }
      if (EXCLUDED_PATHS.has(route.path)) {
        continue;
      }
      const pathKey = route.path.replaceAll(":", "{");
      if (!specPaths.has(pathKey)) {
        undocumented.push(`${route.method} ${route.path}`);
      }
    }
    expect(undocumented, `Undocumented route(s): ${undocumented.join(", ")}`).toEqual([]);
  });

  test("every documented operation declares a 400 problem+json response with the ProblemDetails schema", async () => {
    const doc = await getSpec();
    for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
      for (const method of DOCUMENTED_METHODS) {
        const operation = pathItem?.[method];
        if (operation === undefined) {
          continue;
        }
        const response = operation.responses?.["400"];
        expect(response, `Missing 400 response on ${method.toUpperCase()} ${path}`).toBeDefined();
        if (!response || !("content" in response)) {
          continue;
        }
        const media = response.content?.["application/problem+json"];
        expect(
          media,
          `400 response on ${method.toUpperCase()} ${path} has no application/problem+json content`,
        ).toBeDefined();
        const schema = media?.schema;
        expect(
          schema,
          `400 response on ${method.toUpperCase()} ${path} has no schema`,
        ).toBeDefined();
        if (schema === undefined || !("properties" in schema) || schema.properties === undefined) {
          continue;
        }
        const code = schema.properties.code;
        const requestId = schema.properties.requestId;
        expect(
          code && "enum" in code && code.enum,
          `400 schema on ${method.toUpperCase()} ${path} does not carry the ErrorCode enum`,
        ).toEqual([...ERROR_CODES]);
        expect(
          requestId !== undefined,
          `400 schema on ${method.toUpperCase()} ${path} does not carry requestId`,
        ).toBe(true);
      }
    }
  });

  test("GET /docs returns Scalar HTML", async () => {
    const res = await app.request("/docs");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<html");
  });
});
