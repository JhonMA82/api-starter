import { afterAll, describe, expect, test } from "bun:test";
import net from "node:net";

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function getFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("could not allocate an ephemeral port");
  }
  const { port } = address;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function connect(port: number): Promise<net.Socket> {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

describe("server graceful shutdown", () => {
  const children: ReturnType<typeof Bun.spawn>[] = [];
  afterAll(() => {
    for (const child of children) {
      child.kill("SIGKILL");
    }
  });

  test(
    "SIGTERM drains the in-flight request, closes the listener, and exits 0",
    async () => {
      const port = await getFreePort();
      const child = Bun.spawn([process.execPath, "src/server.ts"], {
        cwd: new URL("..", import.meta.url).pathname,
        env: {
          APP_ENV: "test",
          LOG_LEVEL: "info",
          PORT: String(port),
          HOST: "127.0.0.1",
          DATABASE_URL: "postgres://postgres:postgres@localhost:5432/api",
          BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      children.push(child);

      const startedAt = Date.now();
      let healthy = false;
      while (Date.now() - startedAt < 5_000) {
        const res = await fetch(`http://127.0.0.1:${port}/health`).catch(() => undefined);
        if (res?.status === 200) {
          healthy = true;
          break;
        }
        await Bun.sleep(50);
      }
      expect(healthy, "server did not become healthy on the ephemeral port").toBe(true);

      const socket = await connect(port);
      let received = "";
      let responseAt = 0;
      const responsePromise = new Promise<string>((resolve) => {
        socket.on("data", (chunk: Buffer) => {
          received += chunk.toString();
          if (received.includes("\r\n\r\n") && responseAt === 0) {
            responseAt = Date.now();
            resolve(received);
          }
        });
      });

      socket.write(
        "POST /health HTTP/1.1\r\nHost: 127.0.0.1\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
      );
      socket.write("5\r\nhello\r\n");
      await Bun.sleep(200);

      const sigtermAt = Date.now();
      child.kill("SIGTERM");
      await Bun.sleep(300);

      expect(await canConnect(port), "listener should refuse new connections while draining").toBe(
        false,
      );

      socket.write("6\r\nworld!\r\n");
      socket.write("0\r\n\r\n");

      const response = await Promise.race([
        responsePromise,
        Bun.sleep(SHUTDOWN_TIMEOUT_MS).then(() => ""),
      ]);
      expect(response, "in-flight request should complete with a response").toContain(
        "HTTP/1.1 404",
      );
      expect(received).toContain("application/problem+json");
      expect(responseAt, "in-flight response must arrive after SIGTERM").toBeGreaterThan(sigtermAt);

      const exit = await Promise.race([
        child.exited,
        Bun.sleep(SHUTDOWN_TIMEOUT_MS).then(() => "timeout"),
      ]);
      expect(exit, `server must exit within ${SHUTDOWN_TIMEOUT_MS} ms`).toBe(0);
      expect(await canConnect(port), "listener must be closed after exit").toBe(false);

      socket.destroy();
    },
    SHUTDOWN_TIMEOUT_MS + 5_000,
  );
});
