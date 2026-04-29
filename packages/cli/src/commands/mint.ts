import { ui } from "../ui.js";

export interface MintOptions {
  uri: string;
  config?: string;
  json?: boolean;
}

export async function runMint(opts: MintOptions): Promise<void> {
  ui.header("swati mint");
  ui.info(`URI: ${opts.uri}`);
  ui.warn(
    "mint requires 0G Storage and an EVM wallet — not available in vanilla mode.",
  );
  ui.dim(
    "Set ZEROG_PRIVATE_KEY, ZEROG_EVM_RPC, and INFT_CONTRACT_ADDRESS, then re-run.",
  );
  ui.dim(
    "The iNFT contract implements ERC-7857: each token owns the choreography manifest.",
  );

  process.exit(1);
}
