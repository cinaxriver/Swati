import { createRuntime } from "@swati/core";
import { loadConfig } from "../config-loader.js";
import { ui } from "../ui.js";
import http from "node:http";

export interface DaemonOptions {
  config?: string | undefined;
  port?: number | undefined;
}

export async function runDaemon(opts: DaemonOptions): Promise<void> {
  const port = opts.port ?? 7420;
  const cfg = await loadConfig(opts.config);

  const runtime = createRuntime({
    transport: cfg.transport,
    resolver: cfg.resolver,
    storage: cfg.storage,
    gates: cfg.gates,
    llm: cfg.llm,
  });

  await runtime.start();
  ui.ok(`Swati daemon started (HTTP API on :${port})`);

  if (cfg.choreographies && Object.keys(cfg.choreographies).length > 0) {
    ui.ok(
      `Registered choreographies: ${Object.keys(cfg.choreographies).join(", ")}`,
    );
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          status: "healthy",
          choreographies: Object.keys(cfg.choreographies ?? {}),
          activeRuns: runtime
            .listRuns()
            .filter((r) => r.status === "running" || r.status === "pending")
            .length,
        }),
      );
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }

    try {
      const body = await readBody(req);
      const msg = JSON.parse(body) as {
        method: string;
        params: Record<string, unknown>;
      };

      switch (msg.method) {
        case "swati.submit": {
          const choreoName = msg.params["choreoName"] as string | undefined;
          const role = msg.params["role"] as string | undefined;
          const input = msg.params["input"] ?? {};
          const identityFile = msg.params["identityFile"] as string | undefined;

          if (!choreoName || !role) {
            res
              .writeHead(400, { "Content-Type": "application/json" })
              .end(
                JSON.stringify({ error: "choreoName and role are required" }),
              );
            break;
          }

          const choreo = cfg.choreographies?.[choreoName];
          if (!choreo) {
            res
              .writeHead(404, { "Content-Type": "application/json" })
              .end(
                JSON.stringify({
                  error: `choreography "${choreoName}" not found`,
                }),
              );
            break;
          }

          const runId = await runtime.submit(choreo, role, input, identityFile);
          res
            .writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify({ runId }));
          break;
        }

        case "swati.getStatus": {
          const status = runtime.getStatus(msg.params["runId"] as string);
          res
            .writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify({ status }));
          break;
        }

        case "swati.getResult": {
          const runId = msg.params["runId"] as string;
          const timeoutMs =
            (msg.params["timeoutMs"] as number | undefined) ?? 30_000;

          const immediate = runtime.getResult(runId);
          if (immediate) {
            res
              .writeHead(200, { "Content-Type": "application/json" })
              .end(JSON.stringify(immediate));
            break;
          }

          const result = await runtime.waitFor(runId, timeoutMs);
          res
            .writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify(result));
          break;
        }

        case "swati.listRuns": {
          res
            .writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify({ runs: runtime.listRuns() }));
          break;
        }

        case "swati.stopRun": {
          res
            .writeHead(501, { "Content-Type": "application/json" })
            .end(
              JSON.stringify({ error: "per-run cancel not yet implemented" }),
            );
          break;
        }

        case "swati.listChoreographies": {
          const choreos = Object.entries(cfg.choreographies ?? {}).map(
            ([name, c]) => ({
              name,
              roles: c.roles,
            }),
          );
          res
            .writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify({ choreographies: choreos }));
          break;
        }

        default:
          res
            .writeHead(404, { "Content-Type": "application/json" })
            .end(JSON.stringify({ error: `unknown method "${msg.method}"` }));
      }
    } catch (e) {
      res
        .writeHead(400, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: String(e) }));
    }
  });

  server.listen(port);

  const shutdown = async () => {
    ui.ok("Shutting down daemon…");
    server.close();
    await runtime.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  await new Promise(() => {});
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += String(c);
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
