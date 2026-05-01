import { Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";
import type { Storage } from "@swati/core/interfaces";
import type { ChoreoId, Manifest, Result, RoleName } from "@swati/core";
import { ok, err } from "@swati/core";

export interface ActTrace {
  choreographyId: string;
  role: string;
  step: string;
  input: unknown;
  output: unknown;
  timestamp: number;
  prevHash?: string;
  sig: string;
}

export interface VaultConfig {
  evmRpc?: string;
  nodeRpc?: string;
  signingKey?: string;
  commitTimeoutMs?: number;
  commitRetries?: number;
}

export interface ConnectivityReport {
  nodeReachable: boolean;
  chainReachable: boolean;
  signerAddress: string | null;
  latestBlock: number | null;
  errorDetail: string | null;
}

const CHAIN_RPC_DEFAULT = "https://evmrpc-testnet.0g.ai";
const NODE_RPC_DEFAULT = "https://indexer-storage-testnet-turbo.0g.ai";
const COMMIT_TIMEOUT_MS = 120_000;
const COMMIT_RETRIES = 3;
const FETCH_RETRIES = 3;
const FETCH_RETRY_DELAY = 500;

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class BlobVault implements Storage {
  private readonly chainRpc: string;
  private readonly nodeRpc: string;
  private readonly signingKey: string;
  private readonly commitTimeoutMs: number;
  private readonly commitRetries: number;

  private _provider: ethers.JsonRpcProvider | null = null;
  private _signer: ethers.Wallet | null = null;
  private _indexer: Indexer | null = null;

  private writeGate: Promise<unknown> = Promise.resolve();

  constructor(cfg: VaultConfig = {}) {
    this.chainRpc =
      cfg.evmRpc ?? process.env["ZEROG_EVM_RPC"] ?? CHAIN_RPC_DEFAULT;
    this.nodeRpc =
      cfg.nodeRpc ?? process.env["ZEROG_INDEXER_RPC"] ?? NODE_RPC_DEFAULT;
    const rawKey = cfg.signingKey ?? process.env["ZEROG_PRIVATE_KEY"] ?? "";
    this.signingKey =
      rawKey && !rawKey.startsWith("0x") ? `0x${rawKey}` : rawKey;
    this.commitTimeoutMs = cfg.commitTimeoutMs ?? COMMIT_TIMEOUT_MS;
    this.commitRetries = cfg.commitRetries ?? COMMIT_RETRIES;
  }

  async putManifest(
    manifest: Manifest,
  ): Promise<Result<{ uri: string; hash: string }>> {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(manifest));
      const hash = await this.commit(bytes);
      return ok({ uri: `0g://${hash}`, hash });
    } catch (cause) {
      return err(
        "VAULT_COMMIT_FAILED",
        "BlobVault: manifest commit failed",
        cause,
      );
    }
  }

  async getManifest(uri: string): Promise<Result<Manifest>> {
    try {
      const hash = this.resolveAddress(uri);
      const bytes = await this.retrieve(hash);
      return ok(JSON.parse(new TextDecoder().decode(bytes)) as Manifest);
    } catch (cause) {
      return err(
        "VAULT_FETCH_FAILED",
        `BlobVault: manifest fetch failed for ${uri}`,
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
      const hash = await this.commit(bytes);
      return ok({ uri: `0g://${hash}` });
    } catch (cause) {
      return err(
        "VAULT_COMMIT_FAILED",
        "BlobVault: log snapshot commit failed",
        cause,
      );
    }
  }

  async getLogSnapshot(uri: string): Promise<Result<string>> {
    try {
      const hash = this.resolveAddress(uri);
      const bytes = await this.retrieve(hash);
      return ok(new TextDecoder().decode(bytes));
    } catch (cause) {
      return err(
        "VAULT_FETCH_FAILED",
        `BlobVault: log snapshot fetch failed for ${uri}`,
        cause,
      );
    }
  }

  async putSource(
    bytes: Uint8Array,
  ): Promise<Result<{ uri: string; hash: string }>> {
    try {
      const hash = await this.commit(bytes);
      return ok({ uri: `0g://${hash}`, hash: `sha256:${hash}` });
    } catch (cause) {
      return err(
        "VAULT_COMMIT_FAILED",
        "BlobVault: source commit failed",
        cause,
      );
    }
  }

  async getSource(uri: string): Promise<Result<Uint8Array>> {
    try {
      const hash = this.resolveAddress(uri);
      const bytes = await this.retrieve(hash);
      return ok(bytes);
    } catch (cause) {
      return err(
        "VAULT_FETCH_FAILED",
        `BlobVault: source fetch failed for ${uri}`,
        cause,
      );
    }
  }

  async storeTrace(trace: ActTrace): Promise<{ uri: string; hash: string }> {
    const bytes = new TextEncoder().encode(JSON.stringify(trace));
    const hash = await this.commit(bytes);
    return { uri: `0g://${hash}`, hash };
  }

  async loadTrace(uri: string): Promise<ActTrace> {
    const hash = this.resolveAddress(uri);
    const bytes = await this.retrieve(hash);
    return JSON.parse(new TextDecoder().decode(bytes)) as ActTrace;
  }

  async checkConnectivity(): Promise<ConnectivityReport> {
    const report: ConnectivityReport = {
      nodeReachable: false,
      chainReachable: false,
      signerAddress: null,
      latestBlock: null,
      errorDetail: null,
    };

    try {
      await fetch(`${this.nodeRpc}/nodes`).then((r) => {
        if (r.ok || r.status === 404) report.nodeReachable = true;
      });
    } catch {}

    try {
      const provider = this.lazyProvider();
      const [block, addr] = await Promise.all([
        provider.getBlockNumber(),
        this.signingKey
          ? this.lazySigner().getAddress()
          : Promise.resolve(null),
      ]);
      report.chainReachable = true;
      report.latestBlock = block;
      report.signerAddress = addr;
    } catch (e) {
      report.errorDetail = (e as Error).message;
    }

    return report;
  }

  private lazyProvider(): ethers.JsonRpcProvider {
    if (!this._provider) {
      this._provider = new ethers.JsonRpcProvider(this.chainRpc);
    }
    return this._provider;
  }

  private lazySigner(): ethers.Wallet {
    if (!this._signer) {
      if (!this.signingKey) {
        throw new Error(
          "ZEROG_PRIVATE_KEY is not set. " +
            "Pass signingKey in VaultConfig or set the environment variable.",
        );
      }
      this._signer = new ethers.Wallet(this.signingKey, this.lazyProvider());
    }
    return this._signer;
  }

  private lazyNode(): Indexer {
    if (!this._indexer) {
      this._indexer = new Indexer(this.nodeRpc);
    }
    return this._indexer;
  }

  private commit(bytes: Uint8Array): Promise<string> {
    const next = this.writeGate.then(() => this.executeCommit(bytes));
    this.writeGate = next.catch(() => undefined);
    return next;
  }

  private async executeCommit(bytes: Uint8Array): Promise<string> {
    const signer = this.lazySigner();
    const indexer = this.lazyNode();
    const blob = new MemData(bytes);

    const [, treeErr] = await blob.merkleTree();
    if (treeErr) throw treeErr;

    const uploadOp = indexer.upload(
      blob,
      this.chainRpc,

      signer as any,
      undefined,
      {
        Retries: this.commitRetries,
        Interval: 1,
        MaxGasPrice: 0,
      },
    );

    const deadline = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`0G commit timed out after ${this.commitTimeoutMs}ms`),
          ),
        this.commitTimeoutMs,
      ),
    );

    const [tx, txErr] = await Promise.race([uploadOp, deadline]);
    if (txErr) throw txErr;
    if (!tx) throw new Error("0G commit returned no transaction");

    return "rootHash" in tx ? tx.rootHash : tx.rootHashes[0]!;
  }

  private async retrieve(hash: string): Promise<Uint8Array> {
    const indexer = this.lazyNode();
    let lastError: Error = new Error("retrieve failed");

    for (let attempt = 0; attempt < FETCH_RETRIES; attempt++) {
      if (attempt > 0) await pause(FETCH_RETRY_DELAY * 2 ** (attempt - 1));

      const [blob, fetchErr] = await indexer.downloadToBlob(hash);

      if (fetchErr) {
        const msg = fetchErr.message ?? String(fetchErr);
        if (/not found|no location|no replica/i.test(msg)) {
          throw new Error(`0G blob not found: ${hash.slice(0, 16)}… (${msg})`);
        }
        lastError = new Error(`0G retrieve attempt ${attempt + 1}: ${msg}`);
        continue;
      }
      if (!blob) {
        lastError = new Error(
          `0G retrieve for ${hash.slice(0, 16)}… returned empty blob`,
        );
        continue;
      }
      return new Uint8Array(await blob.arrayBuffer());
    }
    throw lastError;
  }

  private resolveAddress(uri: string): string {
    if (!uri.startsWith("0g://")) {
      throw new Error(
        `Invalid vault address: "${uri}". Expected format: 0g://<rootHash>`,
      );
    }
    return uri.slice(5);
  }
}
