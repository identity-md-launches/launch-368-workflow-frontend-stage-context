import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, stringToHex } from "viem";
import assert from "node:assert/strict";
const root = fileURLToPath(new URL("../", import.meta.url));
const dist = resolve(root, "../dist");
const read = (path) => JSON.parse(readFileSync(path));
const manifest = read(resolve(dist, "imd-deployment.json"));
const handoff = read(resolve(root, "deployment/handoff.json"));
const network = read(resolve(root, "deployment/network.json"));
for (const key of [
  "version",
  "launchId",
  "chainId",
  "sourceCommit",
  "attestationHash",
])
  assert.deepEqual(manifest[key], handoff[key], key);
assert.deepEqual(manifest.network, network.network);
assert.deepEqual(manifest.walletAddChain, network.walletAddChain);
assert.deepEqual(
  manifest.contracts.map(({ name, address, abiHash }) => ({
    name,
    address,
    abiHash,
  })),
  handoff.contracts.map(({ name, address, abiHash }) => ({
    name,
    address,
    abiHash,
  })),
);
const sort = (v) =>
  Array.isArray(v)
    ? v.map(sort)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sort(v[k])]),
        )
      : v;
for (const c of manifest.contracts) {
  const abi = read(resolve(dist, c.abiPath));
  assert(Array.isArray(abi));
  assert.equal(
    keccak256(stringToHex(JSON.stringify(sort(abi)))).slice(2),
    c.abiHash,
  );
  assert.equal(
    readFileSync(resolve(dist, c.abiPath), "utf8"),
    readFileSync(resolve(root, "deployment/abi", `${c.name}.json`), "utf8"),
  );
}
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = resolve(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [relative(dist, path)];
  });
assert.deepEqual(
  walk(dist)
    .filter((p) => p !== "imd-deployment.json")
    .sort(),
  manifest.assets.map((a) => a.path).sort(),
);
assert(manifest.assets.length <= 128);
let bytes = statSync(resolve(dist, "imd-deployment.json")).size;
for (const a of manifest.assets) {
  assert(
    !a.path.startsWith("/") && !a.path.includes("..") && !a.path.includes(":"),
  );
  const contents = readFileSync(resolve(dist, a.path));
  assert(contents.length <= 8388608);
  assert.equal(
    createHash("sha256").update(contents).digest("hex"),
    a.sha256,
    a.path,
  );
  bytes += contents.length;
}
assert(bytes < 32 * 1024 * 1024);
assert(
  readFileSync(resolve(dist, "index.html"), "utf8").includes('src="./assets/'),
);
console.log(
  JSON.stringify(
    {
      result: "pass",
      contracts: manifest.contracts.length,
      assets: manifest.assets.length,
      totalExportBytes: bytes,
      abiHashes: "canonical Keccak verified",
      sha256: "all exported assets verified",
    },
    null,
    2,
  ),
);
