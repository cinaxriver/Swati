import { Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";
import type { Storage } from "@swati/core/interfaces";
import type { ChoreoId, Manifest, Result, RoleName } from "@swati/core";
import { ok, err } from "@swati/core";

export interface ZeroGStorageConfig {
  evmRpc?: string;
  indexerRpc?: string;
  privateKey?: string;
  uploadTimeoutMs?: number;
  uploadRetries?: number;
}

const DEFAULT_EVM_RPC = "https://evmrpc-testnet.0g.ai";
const DEFAULT_INDEXER_RPC = "https://indexer-storage-testnet-turbo.0g.ai";
const UPLOAD_TIMEOUT_MS = 120_000;
const UPLOAD_RETRIES = 3;
const DOWNLOAD_RETRIES = 3;
const DOWNLOAD_RETRY_DELAY = 500;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ZeroGProbeResult {
  indexerReachable: boolean;
  evmRpcReachable: boolean;
  walletAddress: string | null;
  blockNumber: number | null;
  error: string | null;
}

export class ZeroGStorage implements Storage {
  private readonly evmRpc: string;
  private readonly indexerRpc: string;
  private readonly privateKey: string;
  private readonly uploadTimeoutMs: number;
  private readonly uploadRetries: number;

  private _provider: ethers.JsonRpcProvider | null = null;
  private _signer: ethers.Wallet | null = null;
  private _indexer: Indexer | null = null;

  private uploadQueue: Promise<unknown> = Promise.resolve();

  constructor(cfg: ZeroGStorageConfig = {}) {
    this.evmRpc = cfg.evmRpc ?? process.env["ZEROG_EVM_RPC"] ?? DEFAULT_EVM_RPC;
    this.indexerRpc =
      cfg.indexerRpc ?? process.env["ZEROG_INDEXER_RPC"] ?? DEFAULT_INDEXER_RPC;
    const rawKey = cfg.privateKey ?? process.env["ZEROG_PRIVATE_KEY"] ?? "";
    this.privateKey =
      rawKey && !rawKey.startsWith("0x") ? `0x${rawKey}` : rawKey;
    this.uploadTimeoutMs = cfg.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS;
    this.uploadRetries = cfg.uploadRetries ?? UPLOAD_RETRIES;
  }

  async putManifest(
    manifest: Manifest,
  ): Promise<Result<{ uri: string; hash: string }>> {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(manifest));
      const rootHash = await this.upload(bytes);
      return ok({ uri: `0g://${rootHash}`, hash: rootHash });
    } catch (cause) {
      return err(
        "ZEROG_UPLOAD_FAILED",
        "Failed to upload manifest to 0G Storage",
        cause,
      );
    }
  }

  async getManifest(uri: string): Promise<Result<Manifest>> {
    try {
      const rootHash = this.parseUri(uri);
      const bytes = await this.download(rootHash);
      return ok(JSON.parse(new TextDecoder().decode(bytes)) as Manifest);
    } catch (cause) {
      return err(
        "ZEROG_DOWNLOAD_FAILED",
        `Failed to download manifest from ${uri}`,
        cause,
      );
    }
  }

  async putLogSnapshot(
    _choreoId: ChoreoId,
    _role: RoleName,
    jsonl: string,
  ): Promise<Result<{ uri: string }>> {
    try {
      const bytes = new TextEncoder().encode(jsonl);
      const rootHash = await this.upload(bytes);
      return ok({ uri: `0g://${rootHash}` });
    } catch (cause) {
      return err(
        "ZEROG_UPLOAD_FAILED",
        "Failed to upload log snapshot to 0G Storage",
        cause,
      );
    }
  }

  async getLogSnapshot(uri: string): Promise<Result<string>> {
    try {
      const rootHash = this.parseUri(uri);
      const bytes = await this.download(rootHash);
      return ok(new TextDecoder().decode(bytes));
    } catch (cause) {
      return err(
        "ZEROG_DOWNLOAD_FAILED",
        `Failed to download log snapshot from ${uri}`,
        cause,
      );
    }
  }

  async putSource(
    bytes: Uint8Array,
  ): Promise<Result<{ uri: string; hash: string }>> {
    try {
      const rootHash = await this.upload(bytes);
      return ok({ uri: `0g://${rootHash}`, hash: `sha256:${rootHash}` });
    } catch (cause) {
      return err(
        "ZEROG_UPLOAD_FAILED",
        "Failed to upload source to 0G Storage",
        cause,
      );
    }
  }

  async getSource(uri: string): Promise<Result<Uint8Array>> {
    try {
      const rootHash = this.parseUri(uri);
      const bytes = await this.download(rootHash);
      return ok(bytes);
    } catch (cause) {
      return err(
        "ZEROG_DOWNLOAD_FAILED",
        `Failed to download source from ${uri}`,
        cause,
      );
    }
  }

  async probe(): Promise<ZeroGProbeResult> {
    const result: ZeroGProbeResult = {
      indexerReachable: false,
      evmRpcReachable: false,
      walletAddress: null,
      blockNumber: null,
      error: null,
    };
    try {
      await fetch(`${this.indexerRpc}/nodes`).then((r) => {
        if (r.ok || r.status === 404) result.indexerReachable = true;
      });
    } catch {}

    try {
      const provider = this.getProvider();
      const [block, addr] = await Promise.all([
        provider.getBlockNumber(),
        this.privateKey ? this.getSigner().getAddress() : Promise.resolve(null),
      ]);
      result.evmRpcReachable = true;
      result.blockNumber = block;
      result.walletAddress = addr;
    } catch (e) {
      result.error = (e as Error).message;
    }
    return result;
  }

  private getProvider(): ethers.JsonRpcProvider {
    if (!this._provider) {
      this._provider = new ethers.JsonRpcProvider(this.evmRpc);
    }
    return this._provider;
  }

  private getSigner(): ethers.Wallet {
    if (!this._signer) {
      if (!this.privateKey) {
        throw new Error(
          "ZEROG_PRIVATE_KEY is not set. " +
            "Set it in your environment or pass privateKey to ZeroGStorage config.",
        );
      }
      this._signer = new ethers.Wallet(this.privateKey, this.getProvider());
    }
    return this._signer;
  }

  private getIndexer(): Indexer {
    if (!this._indexer) {
      this._indexer = new Indexer(this.indexerRpc);
    }
    return this._indexer;
  }

  private upload(bytes: Uint8Array): Promise<string> {
    const next = this.uploadQueue.then(() => this.doUpload(bytes));
    this.uploadQueue = next.catch(() => undefined);
    return next;
  }

  private async doUpload(bytes: Uint8Array): Promise<string> {
    const signer = this.getSigner();
    const indexer = this.getIndexer();
    const memData = new MemData(bytes);

    const [, treeErr] = await memData.merkleTree();
    if (treeErr) throw treeErr;

    const uploadPromise = indexer.upload(
      memData,
      this.evmRpc,

      signer as any,
      undefined,
      {
        Retries: this.uploadRetries,
        Interval: 1,
        MaxGasPrice: 0,
      },
    );

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`0G upload timed out after ${this.uploadTimeoutMs}ms`),
          ),
        this.uploadTimeoutMs,
      ),
    );

    const [tx, uploadErr] = await Promise.race([uploadPromise, timeoutPromise]);
    if (uploadErr) throw uploadErr;
    if (!tx) throw new Error("0G upload returned empty transaction");

    return "rootHash" in tx ? tx.rootHash : tx.rootHashes[0]!;
  }

  private async download(rootHash: string): Promise<Uint8Array> {
    const indexer = this.getIndexer();
    let lastErr: Error = new Error("download failed");

    for (let attempt = 0; attempt < DOWNLOAD_RETRIES; attempt++) {
      if (attempt > 0) await sleep(DOWNLOAD_RETRY_DELAY * 2 ** (attempt - 1));

      const [blob, dlErr] = await indexer.downloadToBlob(rootHash);
      if (dlErr) {
        const msg = dlErr.message ?? String(dlErr);

        if (/not found|no location|no replica/i.test(msg)) {
          throw new Error(
            `0G blob not found: ${rootHash.slice(0, 16)}… (${msg})`,
          );
        }
        lastErr = new Error(`0G download attempt ${attempt + 1}: ${msg}`);
        continue;
      }
      if (!blob) {
        lastErr = new Error(
          `0G download for ${rootHash.slice(0, 16)}… returned empty blob`,
        );
        continue;
      }
      return new Uint8Array(await blob.arrayBuffer());
    }
    throw lastErr;
  }

  private parseUri(uri: string): string {
    if (!uri.startsWith("0g://")) {
      throw new Error(
        `Invalid 0G URI: "${uri}". Expected format: 0g://<rootHash>`,
      );
    }
    return uri.slice(5);
  }
}

export { mintChoreographyNft } from "./inft.js";
export type { MintResult, InftConfig } from "./inft.js";
