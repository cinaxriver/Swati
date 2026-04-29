import { ui } from "../ui.js";

export interface WatchOptions {
  score: string;
  config?: string;
  role?: string;
}

export async function runWatch(opts: WatchOptions): Promise<void> {
  ui.header("swati watch");
  ui.info(`Score: ${opts.score}`);
  ui.warn("watch is not yet implemented.");
  ui.dim(
    "It will tail the live log for a running choreography, printing each act as it arrives.",
  );
  ui.dim(
    "For now, use `swati verify <uri>` to inspect a completed run's log snapshot.",
  );
  process.exit(0);
}
