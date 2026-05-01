import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { ui } from "../ui.js";

type Action =
  | { type: "local"; role: string; action: string; label: string }
  | { type: "send"; from: string; to: string; label: string }
  | { type: "broadcast"; from: string; label: string }
  | { type: "condition"; condition: string; label: string };

export async function runVisualize(opts: {
  score: string;
  format?: string;
  mermaidOut?: string;
}) {
  const filePath = resolve(opts.score);
  let code: string;
  try {
    code = readFileSync(filePath, "utf-8");
  } catch (err) {
    ui.error(`Could not read score file: ${filePath}`);
    process.exit(1);
  }

  const nodes = new Set<string>();
  const actions: Action[] = [];

  const rolesMatch = code.match(/roles:\s*\[([^\]]+)\]/);
  if (rolesMatch) {
    const rolesStr = rolesMatch[1]!;
    const roleMatches = rolesStr.matchAll(/"([^"]+)"/g);
    for (const match of roleMatches) {
      nodes.add(match[1]!);
    }
  }

  const lines = code.split("\n");
  let step = 1;
  for (const line of lines) {
    const sendMatch = line.match(
      /c\.send\([^,]+,\s*"([^"]+)"\s*,\s*"([^"]+)"\)/,
    );
    if (sendMatch) {
      actions.push({
        type: "send",
        from: sendMatch[1]!,
        to: sendMatch[2]!,
        label: `${step}. send`,
      });
      step++;
      continue;
    }

    const chooseMatch = line.match(/c\.choose\("([^"]+)"/);
    if (chooseMatch) {
      actions.push({
        type: "broadcast",
        from: chooseMatch[1]!,
        label: `${step}. choose (broadcast)`,
      });
      step++;
      continue;
    }

    const gateMatch = line.match(/c\.gate\("([^"]+)"/);
    if (gateMatch) {
      actions.push({
        type: "local",
        role: gateMatch[1]!,
        action: "gate",
        label: `${step}. gate (execute)`,
      });
      step++;
      continue;
    }

    const doMatch = line.match(/(\w+)\.do\(/);
    if (doMatch) {
      const role = doMatch[1]!;
      if (nodes.has(role)) {
        actions.push({
          type: "local",
          role,
          action: "do",
          label: `${step}. do (LLM)`,
        });
        step++;
      }
      continue;
    }

    const ifMatch = line.match(/if\s*\(([^)]+)\)\s*\{/);
    if (ifMatch && !line.includes("else")) {
      actions.push({
        type: "condition",
        condition: ifMatch[1]!,
        label: `${step}. if (${ifMatch[1]!})`,
      });
      step++;
      continue;
    }

    const elseIfMatch = line.match(/else\s+if\s*\(([^)]+)\)\s*\{/);
    if (elseIfMatch) {
      actions.push({
        type: "condition",
        condition: elseIfMatch[1]!,
        label: `${step}. else if (${elseIfMatch[1]!})`,
      });
      step++;
      continue;
    }

    const elseMatch = line.match(/else\s*\{/);
    if (elseMatch && !line.includes("if")) {
      actions.push({
        type: "condition",
        condition: "else",
        label: `${step}. else`,
      });
      step++;
      continue;
    }
  }

  if (nodes.size === 0) {
    ui.warn(
      "No roles found in the choreography. Visualization might be incomplete.",
    );
  }

  const format = opts.format || "ascii";

  if (format === "ascii") {
    renderAscii(actions, Array.from(nodes));
  } else if (format === "mermaid") {
    const mermaidStr = renderMermaid(actions, Array.from(nodes));
    console.log(mermaidStr);
  } else {
    ui.error(`Unknown format: ${format}. Use 'ascii' or 'mermaid'.`);
  }

  if (opts.mermaidOut) {
    try {
      const mermaidStr = renderMermaid(actions, Array.from(nodes));
      writeFileSync(resolve(opts.mermaidOut), mermaidStr, "utf-8");
      ui.ok(`Mermaid diagram exported to ${opts.mermaidOut}`);
    } catch (err) {
      ui.error(`Failed to export mermaid diagram: ${(err as Error).message}`);
    }
  }
}

function renderAscii(actions: Action[], roles: string[]) {
  console.log("\n" + chalk.hex("#9ca3af")("choreography flow"));
  console.log(chalk.dim("—".repeat(40)) + "\n");

  let currentRole = "";

  for (const act of actions) {
    if (act.type === "condition") {
      console.log(chalk.dim("   │"));
      console.log(
        chalk.dim("   ├─ ") +
          chalk.hex("#fbbf24").italic(`branch: if ${act.condition}`),
      );
      continue;
    }

    const actor =
      act.type === "send" || act.type === "broadcast" ? act.from : act.role;

    if (actor !== currentRole) {
      if (currentRole !== "") {
        console.log(chalk.dim("   │"));
      }
      currentRole = actor;
      console.log(chalk.hex("#a78bfa").bold(`[${currentRole}]`));
    }

    if (act.type === "local") {
      const text =
        act.action === "do"
          ? "do (llm inference)"
          : "gate (execute side-effect)";
      const color =
        act.action === "do" ? chalk.hex("#34d399") : chalk.hex("#f87171");
      console.log(chalk.dim("   │"));
      console.log(chalk.dim("   ├─ ") + color(`local: ${text}`));
    } else if (act.type === "send") {
      console.log(chalk.dim("   │"));
      console.log(
        chalk.dim("   ├─ ") +
          chalk.hex("#60a5fa")("send ") +
          chalk.dim("──> ") +
          chalk.hex("#a78bfa")(`[${act.to}]`),
      );
    } else if (act.type === "broadcast") {
      console.log(chalk.dim("   │"));
      console.log(
        chalk.dim("   ├─ ") + chalk.hex("#60a5fa")("choose (broadcast)"),
      );
      const others = roles.filter((r) => r !== actor);
      for (let i = 0; i < others.length; i++) {
        const char = i === others.length - 1 ? "└" : "├";
        console.log(
          chalk.dim(`   │  ${char}──> `) +
            chalk.hex("#a78bfa")(`[${others[i]}]`),
        );
      }
    }
  }
  console.log(chalk.dim("   ▼"));
  console.log(chalk.hex("#9ca3af")("end of flow\n"));
}

function renderMermaid(actions: Action[], roles: string[]): string {
  const lines = [
    "sequenceDiagram",
    "  autonumber",
    ...roles.map((n) => `  participant ${n}`),
  ];

  for (const edge of actions) {
    if (edge.type === "local") {
      lines.push(
        `  Note over ${edge.role}: ${edge.action === "do" ? "do (LLM)" : "gate (Execute)"}`,
      );
    } else if (edge.type === "send") {
      lines.push(`  ${edge.from}->>${edge.to}: send`);
    } else if (edge.type === "broadcast") {
      const others = roles.filter((r) => r !== edge.from);
      for (const to of others) {
        lines.push(`  ${edge.from}-->>${to}: choose (broadcast)`);
      }
    } else if (edge.type === "condition") {
      lines.push(`  Note over ${roles[0]}: Branch: ${edge.condition}`);
    }
  }
  return lines.join("\n");
}
