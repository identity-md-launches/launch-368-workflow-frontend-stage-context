// Read-only configured RPC evidence. Never sends a transaction.
import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { decodeFunctionResult, encodeFunctionData } from "viem";
const run = promisify(execFile);
const m = JSON.parse(
  readFileSync(new URL("../../dist/imd-deployment.json", import.meta.url)),
);
const treasury = m.contracts.find((c) => c.name === "LockVoteTreasury");
const abi = JSON.parse(
  readFileSync(new URL(`../../dist/${treasury.abiPath}`, import.meta.url)),
);
const rows = await Promise.all(
  m.network.rpcUrls.map(async (rpc) => {
    let id = 0;
    const call = async (method, params) => {
      const { stdout } = await run("curl", [
        "--silent",
        "--show-error",
        "--fail",
        "--max-time",
        "20",
        rpc,
        "-H",
        "Content-Type: application/json",
        "--data",
        JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      ]);
      const r = JSON.parse(stdout);
      if (r.error) throw Error(JSON.stringify(r.error));
      return r.result;
    };
    try {
      const chainId = Number(await call("eth_chainId", []));
      const block = await call("eth_blockNumber", []);
      const codes = await Promise.all(
        m.contracts.map(async (c) => ({
          name: c.name,
          address: c.address,
          runtimeBytes:
            ((await call("eth_getCode", [c.address, block])).length - 2) / 2,
        })),
      );
      const token = decodeFunctionResult({
        abi,
        functionName: "token",
        data: await call("eth_call", [
          {
            to: treasury.address,
            data: encodeFunctionData({ abi, functionName: "token" }),
          },
          block,
        ]),
      });
      return {
        rpc,
        chainId,
        blockNumber: Number(block),
        codes,
        token,
        pass:
          chainId === m.chainId &&
          codes.every((c) => c.runtimeBytes > 0) &&
          token.toLowerCase() ===
            m.contracts
              .find((c) => c.name === "LaunchToken")
              .address.toLowerCase(),
      };
    } catch (e) {
      return { rpc, pass: false, error: e.message.slice(0, 500) };
    }
  }),
);
const result = {
  checkedAt: new Date().toISOString(),
  readOnly: true,
  checks: rows,
};
writeFileSync(
  fileURLToPath(new URL("../../docs/evidence/live-rpc.json", import.meta.url)),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
