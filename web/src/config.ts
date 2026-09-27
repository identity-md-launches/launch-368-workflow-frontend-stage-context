import { createConfig, injected } from "@wagmi/core";
import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  isAddress,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
} from "viem";
export type Deployment = {
  version: number;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[];
    uniswapV4: Record<string, Address>;
  };
  walletAddChain: {
    chainId: string;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
};
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, sort(x)]),
          )
        : v;
  return JSON.stringify(sort(value));
}
async function json(path: string) {
  const response = await fetch(new URL(path, document.baseURI));
  if (!response.ok)
    throw Error(`Cannot load ${path}. Reload the page to retry.`);
  return response.json();
}
export async function loadRuntime() {
  const deployment: Deployment = await json("./imd-deployment.json");
  if (
    deployment.version !== 1 ||
    deployment.chainId !== deployment.network.chainId ||
    Number(deployment.walletAddChain.chainId) !== deployment.chainId
  )
    throw Error(
      "Deployment network configuration does not match. Transactions are disabled.",
    );
  const contracts = await Promise.all(
    deployment.contracts.map(async (c) => {
      if (
        !isAddress(c.address) ||
        !/^[a-zA-Z0-9_/-]+\.json$/.test(c.abiPath) ||
        c.abiPath.includes("..") ||
        c.abiPath.startsWith("/")
      )
        throw Error("Invalid contract configuration.");
      const abi: Abi = await json(`./${c.abiPath}`);
      if (
        !Array.isArray(abi) ||
        keccak256(stringToHex(canonical(abi))).slice(2) !== c.abiHash
      )
        throw Error(`ABI integrity check failed for ${c.name}.`);
      return { ...c, abi };
    }),
  );
  const treasury = contracts.find((c) => c.name === "LockVoteTreasury");
  const token = contracts.find((c) => c.name === "LaunchToken");
  if (!treasury || !token) throw Error("Required contracts are missing.");
  const n = deployment.network;
  const chain = defineChain({
    id: deployment.chainId,
    name: n.name,
    nativeCurrency: n.nativeCurrency,
    rpcUrls: { default: { http: n.rpcUrls } },
    blockExplorers: { default: { name: n.name, url: n.explorer } },
    testnet: n.testnet,
  });
  const transport = fallback(
    n.rpcUrls.map((url) => http(url, { timeout: 8000, retryCount: 0 })),
    { retryCount: 1 },
  );
  const publicClient = createPublicClient({ chain, transport });
  const walletConfig = createConfig({
    chains: [chain],
    connectors: [injected()],
    transports: { [chain.id]: transport },
    multiInjectedProviderDiscovery: true,
  });
  return { deployment, treasury, token, chain, publicClient, walletConfig };
}
export type Runtime = Awaited<ReturnType<typeof loadRuntime>>;
