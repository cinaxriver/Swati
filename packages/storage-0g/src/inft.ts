import { ethers } from "ethers";

const INFT_ABI = [
  "function mint(address to, string calldata tokenURI) external returns (uint256)",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
] as const;

export interface MintResult {
  txHash: string;
  tokenId: string;
  tokenUri: string;
}

export interface InftConfig {
  rpcUrl: string;
  privateKey: string;
  contractAddress: string;
}

export async function mintChoreographyNft(
  config: InftConfig,
  zeroGUri: string,
  recipientAddress?: string,
): Promise<MintResult> {
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.privateKey, provider);

  const contract = new ethers.Contract(
    config.contractAddress,
    INFT_ABI,
    wallet,
  );

  const to = recipientAddress ?? wallet.address;
  const tx = await (
    contract["mint"] as (
      to: string,
      uri: string,
    ) => Promise<ethers.ContractTransactionResponse>
  )(to, zeroGUri);
  const receipt = await tx.wait();

  if (!receipt) throw new Error("Transaction receipt not found");

  const iface = new ethers.Interface(INFT_ABI);
  let tokenId = "0";
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "Transfer") {
        tokenId = parsed.args["tokenId"].toString();
        break;
      }
    } catch {}
  }

  return {
    txHash: receipt.hash,
    tokenId,
    tokenUri: zeroGUri,
  };
}
