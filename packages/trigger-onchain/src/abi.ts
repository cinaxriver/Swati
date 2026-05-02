export const SWATI_RUN_TRIGGER_ABI = [
  {
    type: "event",
    name: "RunRequested",
    inputs: [
      { name: "runKey", type: "bytes32", indexed: true },
      { name: "choreoId", type: "bytes32", indexed: true },
      { name: "input", type: "bytes", indexed: false },
      { name: "requester", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "RunCompleted",
    inputs: [
      { name: "runKey", type: "bytes32", indexed: true },
      { name: "role", type: "string", indexed: false },
      { name: "success", type: "bool", indexed: false },
      { name: "result", type: "bytes", indexed: false },
      { name: "reporter", type: "address", indexed: true },
    ],
  },

  {
    type: "function",
    name: "requestRun",
    stateMutability: "nonpayable",
    inputs: [
      { name: "choreoId", type: "bytes32" },
      { name: "input", type: "bytes" },
    ],
    outputs: [{ name: "runKey", type: "bytes32" }],
  },
  {
    type: "function",
    name: "reportResult",
    stateMutability: "nonpayable",
    inputs: [
      { name: "runKey", type: "bytes32" },
      { name: "role", type: "string" },
      { name: "success", type: "bool" },
      { name: "result", type: "bytes" },
    ],
    outputs: [],
  },

  {
    type: "function",
    name: "runs",
    stateMutability: "view",
    inputs: [{ name: "runKey", type: "bytes32" }],
    outputs: [
      { name: "choreoId", type: "bytes32" },
      { name: "inputHash", type: "bytes32" },
      { name: "requester", type: "address" },
      { name: "requestedAt", type: "uint64" },
      { name: "exists", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "results",
    stateMutability: "view",
    inputs: [
      { name: "runKey", type: "bytes32" },
      { name: "role", type: "string" },
    ],
    outputs: [
      { name: "success", type: "bool" },
      { name: "resultHash", type: "bytes32" },
      { name: "reportedAt", type: "uint64" },
      { name: "exists", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "getReportedRoles",
    stateMutability: "view",
    inputs: [{ name: "runKey", type: "bytes32" }],
    outputs: [{ name: "", type: "string[]" }],
  },
  {
    type: "function",
    name: "verifyResult",
    stateMutability: "view",
    inputs: [
      { name: "runKey", type: "bytes32" },
      { name: "role", type: "string" },
      { name: "result", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },

  {
    type: "error",
    name: "RunNotFound",
    inputs: [{ name: "runKey", type: "bytes32" }],
  },
  {
    type: "error",
    name: "ResultAlreadyReported",
    inputs: [
      { name: "runKey", type: "bytes32" },
      { name: "role", type: "string" },
    ],
  },
  {
    type: "error",
    name: "EmptyInput",
    inputs: [],
  },
] as const;

export const TRIGGER_ADDRESSES: Record<"mainnet" | "sepolia", `0x${string}` | null> = {
  mainnet: null,
  sepolia: null,
};
