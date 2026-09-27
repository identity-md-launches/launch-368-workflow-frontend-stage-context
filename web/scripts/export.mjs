import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { keccak256, stringToHex } from "viem";
import { fileURLToPath } from "node:url";
import { resolve, relative } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const dist = resolve(root, "../dist");
export const canonical = (value) => JSON.stringify(sort(value));
function sort(value) {
  return Array.isArray(value)
    ? value.map(sort)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, sort(value[k])]),
        )
      : value;
}
const handoff = JSON.parse(
  readFileSync(resolve(root, "deployment/handoff.json")),
);
const network = JSON.parse(
  readFileSync(resolve(root, "deployment/network.json")),
);
if (
  handoff.chainId !== network.network.chainId ||
  Number(network.walletAddChain.chainId) !== handoff.chainId
)
  throw Error("Network handoff mismatch");
mkdirSync(resolve(dist, "abi"), { recursive: true });
const contracts = handoff.contracts.map(({ name, address, abiHash }) => {
  const path = resolve(root, `deployment/abi/${name}.json`);
  const abi = JSON.parse(readFileSync(path));
  if (
    !Array.isArray(abi) ||
    keccak256(stringToHex(canonical(abi))).slice(2) !== abiHash
  )
    throw Error(`ABI hash mismatch: ${name}`);
  copyFileSync(path, resolve(dist, `abi/${name}.json`));
  return { name, address, abiHash, abiPath: `abi/${name}.json` };
});
const files = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = resolve(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
const assets = files(dist)
  .filter((p) => relative(dist, p) !== "imd-deployment.json")
  .sort()
  .map((p) => {
    const bytes = readFileSync(p);
    if (bytes.length > 8388608) throw Error("Asset exceeds 8 MiB");
    return {
      path: relative(dist, p),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
if (assets.length > 128) throw Error("Too many assets");
const { version, launchId, chainId, sourceCommit, attestationHash } = handoff;
writeFileSync(
  resolve(dist, "imd-deployment.json"),
  JSON.stringify(
    {
      version,
      launchId,
      chainId,
      sourceCommit,
      attestationHash,
      contracts,
      assets,
      ...network,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Verified ${contracts.length} canonical ABI hashes; inventoried ${assets.length} assets.`,
);
