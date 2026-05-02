import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { existsSync, readFileSync, watch as fsWatch } from "node:fs";
import { homedir } from "node:os";
import chalk from "chalk";
import { ui } from "../ui.js";
import type { ChoreographyDef } from "@swati/core";

export interface WatchOptions {
  score: string;
  config?: string;
  role?: string;
}

export async function runWatch(opts: WatchOptions): Promise<void> {
  let choreo: ChoreographyDef;
  try {
    const scorePath = pathToFileURL(resolve(opts.score)).href;
    const mod = (await import(scorePath)) as { default: ChoreographyDef };
    choreo = mod.default;
  } catch (cause) {
    ui.error(`Failed to load score: ${String(cause)}`);
    process.exit(1);
  }

  const logDir = join(process.env["SWATI_HOME"] ?? join(homedir(), ".swati"), "logs");

  const rolesToWatch: string[] = opts.role ? [opts.role] : [...choreo.roles];

  ui.header(`swati watch — ${choreo.name}`);
  ui.dim(`Log dir: ${logDir}`);
  ui.info(`Watching roles: ${rolesToWatch.join(", ")} — press Ctrl+C to stop.\n`);

  for (const role of rolesToWatch) {
    const logPath = join(logDir, `${choreo.name}-${role}.jsonl`);
    if (!existsSync(logPath)) {
      ui.warn(`Log not found for role "${role}" — will tail when created: ${logPath}`);
    } else {
      ui.ok(`Tailing: ${logPath}`);
    }
    startTail(logPath, role);
  }

  await new Promise<void>((res) => {
    process.on("SIGINT", () => {
      process.stdout.write("\n");
      ui.info("Watch stopped.");
      res();
    });
  });
}

function startTail(logPath: string, role: string): void {
  let offset = 0;

  const flush = () => {
    if (!existsSync(logPath)) return;
    const content = readFileSync(logPath, "utf-8");
    if (content.length <= offset) return;
    const newContent = content.slice(offset);
    offset = content.length;
    for (const line of newContent.split("\n").filter(Boolean)) {
      try {
        const act = JSON.parse(line) as Record<string, unknown>;
        printAct(role, act);
      } catch {}
    }
  };

  flush();

  if (existsSync(logPath)) {
    try {
      fsWatch(logPath, () => flush());
    } catch {}
  } else {
    const pollId = setInterval(() => {
      if (existsSync(logPath)) {
        clearInterval(pollId);
        flush();
        try {
          fsWatch(logPath, () => flush());
        } catch {}
      }
    }, 500);
  }
}

const KIND_COLORS: Record<string, (s: string) => string> = {
  send: (s) => chalk.hex("#60a5fa")(s),
  choose: (s) => chalk.hex("#fbbf24")(s),
  do: (s) => chalk.hex("#34d399")(s),
  gate: (s) => chalk.hex("#f87171")(s),
  ack: (s) => chalk.green(s),
  ping: (s) => chalk.dim(s),
  persist: (s) => chalk.hex("#a78bfa")(s),
  recurse: (s) => chalk.hex("#f97316")(s),
};

function printAct(role: string, act: Record<string, unknown>): void {
  const kind = String(act["kind"] ?? "?");
  const ts = act["timestamp"]
    ? new Date(act["timestamp"] as number).toISOString().slice(11, 23)
    : "--:--:--.---";
  const id = String(act["id"] ?? "").slice(0, 8);
  const colorFn = KIND_COLORS[kind] ?? ((s: string) => chalk.white(s));
  const payload = act["payload"] ? JSON.stringify(act["payload"]).slice(0, 80) : "";

  console.log(
    chalk.dim(ts) +
      " " +
      chalk.hex("#a78bfa")(`[${role}]`) +
      " " +
      colorFn(kind.padEnd(8)) +
      " " +
      chalk.dim(id) +
      (payload ? " " + chalk.dim(payload) : ""),
  );
}
