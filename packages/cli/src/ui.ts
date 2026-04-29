import chalk from "chalk";
import ora from "ora";

export const ui = {
  ok: (msg: string) => console.log(chalk.green("✓") + " " + msg),
  info: (msg: string) => console.log(chalk.dim("→") + " " + msg),
  warn: (msg: string) => console.log(chalk.yellow("⚠") + " " + msg),
  error: (msg: string) => console.error(chalk.red("✗") + " " + msg),
  dim: (msg: string) => console.log(chalk.dim(msg)),

  spinner(label: string) {
    return ora({ text: label, color: "cyan" });
  },

  json(data: unknown) {
    console.log(JSON.stringify(data, null, 2));
  },

  header(text: string) {
    console.log("\n" + chalk.bold(text));
  },
};
