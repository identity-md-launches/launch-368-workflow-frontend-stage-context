import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  decodeFunctionData,
  encodeFunctionResult,
  encodeErrorResult,
  keccak256,
  stringToHex,
  parseEther,
  toHex,
} from "viem";
const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = resolve(root, "dist");
const evidence = resolve(root, "docs/evidence");
mkdirSync(evidence, { recursive: true });
const m = JSON.parse(readFileSync(resolve(dist, "imd-deployment.json")));
const token = m.contracts.find((c) => c.name === "LaunchToken");
const treasury = m.contracts.find((c) => c.name === "LockVoteTreasury");
const tokenAbi = JSON.parse(readFileSync(resolve(dist, token.abiPath)));
const treasuryAbi = JSON.parse(readFileSync(resolve(dist, treasury.abiPath)));
const user = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const hash = `0x${"ab".repeat(32)}`;
const blockHash = `0x${"cd".repeat(32)}`;
const now = BigInt(Math.floor(Date.now() / 1000));
const proposals = Array.from({ length: 6 }, (_, state) => ({
  recipient: other,
  amount: parseEther("0.25"),
  descriptionHash: keccak256(stringToHex(`Proposal ${state}`)),
  proposer: user,
  voteEnd: state === 0 ? now + 259200n : now - 90000n,
  forVotes: state === 0 ? parseEther("350000") : parseEther("1100000"),
  againstVotes: parseEther("100000"),
  state,
  voted: false,
}));
let state = {
  balance: parseEther("2000000"),
  allowance: 0n,
  locked: parseEther("200000"),
  until: 0n,
  treasuryBalance: parseEther("2.5"),
  failRPC: false,
  failSimulation: false,
  noCode: false,
  mismatchedToken: false,
  rejected: false,
  receiptRevert: false,
  countOverride: undefined,
  walletChain: "0x1",
  added: false,
};
const writes = [],
  requests = [],
  failures = [],
  results = [];
const server = createServer((req, res) => {
  try {
    const path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    ).replace(/^\/preview\//, "");
    if (path.includes("..") || path.startsWith("/")) {
      res.writeHead(404);
      res.end();
      return;
    }
    const file = resolve(dist, path || "index.html");
    const type =
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
      }[extname(file)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
let browser;
function contractCall(params, mutate = false) {
  const transaction = params[0];
  const isToken = transaction.to.toLowerCase() === token.address.toLowerCase();
  const abi = isToken ? tokenAbi : treasuryAbi;
  const { functionName: f, args = [] } = decodeFunctionData({
    abi,
    data: transaction.data,
  });
  const values = {
    token: state.mismatchedToken ? other : token.address,
    proposalCount: BigInt(state.countOverride ?? proposals.length),
    decimals: 18,
    symbol: "LVOT",
    PROPOSAL_THRESHOLD: parseEther("100000"),
    QUORUM: parseEther("1000000"),
    EXECUTION_DELAY: 86400n,
    EXECUTION_EXPIRY: 1296000n,
    balanceOf: state.balance,
    allowance: state.allowance,
    locked: transaction.data ? state.locked : 0n,
    lockedUntil: state.until,
  };
  let result = values[f];
  if (f === "proposal") {
    const p = proposals[Number(args[0])] ?? proposals[0];
    result = [
      p.recipient,
      p.amount,
      p.descriptionHash,
      p.proposer,
      p.voteEnd,
      p.forVotes,
      p.againstVotes,
      p.state,
    ];
  }
  if (f === "hasVoted")
    result = (proposals[Number(args[0])] ?? proposals[0]).voted;
  if (
    [
      "approve",
      "lock",
      "unlock",
      "propose",
      "vote",
      "execute",
      "donate",
    ].includes(f)
  ) {
    if (!mutate && state.failSimulation)
      throw {
        code: 3,
        message: "execution reverted",
        data: encodeErrorResult({
          abi: treasuryAbi,
          errorName: "InsufficientETH",
        }),
      };
    if (mutate) {
      writes.push({
        functionName: f,
        args,
        to: transaction.to,
        value: transaction.value,
      });
      if (!state.receiptRevert) {
        if (f === "approve") state.allowance = args[1];
        if (f === "lock") {
          state.balance -= args[0];
          state.locked += args[0];
          state.allowance -= args[0];
        }
        if (f === "unlock") {
          state.balance += args[0];
          state.locked -= args[0];
        }
        if (f === "propose")
          proposals.push({
            recipient: args[0],
            amount: args[1],
            descriptionHash: args[2],
            proposer: user,
            voteEnd: now + 259200n,
            forVotes: 0n,
            againstVotes: 0n,
            state: 0,
            voted: false,
          });
        if (f === "vote") {
          const p = proposals[Number(args[0])];
          p.voted = true;
          p[args[1] ? "forVotes" : "againstVotes"] += state.locked;
          state.until = p.voteEnd;
        }
        if (f === "execute") {
          const p = proposals[Number(args[0])];
          p.state = 4;
          state.treasuryBalance -= p.amount;
        }
        if (f === "donate") state.treasuryBalance += BigInt(transaction.value);
      }
    }
    result =
      f === "approve"
        ? true
        : f === "propose"
          ? BigInt(proposals.length)
          : undefined;
  }
  return encodeFunctionResult({ abi, functionName: f, result });
}
function rpc(method, params = []) {
  if (state.failRPC) throw { code: -32000, message: "Mock RPC unavailable" };
  if (method === "eth_chainId") return toHex(m.chainId);
  if (method === "eth_blockNumber") return "0xc00001";
  if (method === "eth_getCode") return state.noCode ? "0x" : "0x60006000";
  if (method === "eth_getBalance") return toHex(state.treasuryBalance);
  if (method === "eth_call") return contractCall(params);
  if (method === "eth_getBlockByNumber")
    return {
      number: "0xc00001",
      hash: blockHash,
      parentHash: blockHash,
      timestamp: toHex(now),
      nonce: "0x0000000000000000",
      sha3Uncles: hash,
      logsBloom: `0x${"00".repeat(256)}`,
      transactionsRoot: hash,
      stateRoot: hash,
      receiptsRoot: hash,
      miner: other,
      difficulty: "0x0",
      totalDifficulty: "0x0",
      extraData: "0x",
      size: "0x1",
      gasLimit: "0x1c9c380",
      gasUsed: "0x0",
      transactions: [],
      uncles: [],
      baseFeePerGas: "0x1",
    };
  if (method === "eth_getTransactionReceipt")
    return {
      transactionHash: params[0],
      transactionIndex: "0x0",
      blockHash,
      blockNumber: "0xc00001",
      from: user,
      to: treasury.address,
      cumulativeGasUsed: "0x5208",
      gasUsed: "0x5208",
      effectiveGasPrice: "0x1",
      contractAddress: null,
      logs: [],
      logsBloom: `0x${"00".repeat(256)}`,
      status: state.receiptRevert ? "0x0" : "0x1",
      type: "0x2",
    };
  if (method === "eth_getTransactionByHash")
    return {
      hash: params[0],
      blockHash,
      blockNumber: "0xc00001",
      from: user,
      to: treasury.address,
      gas: "0x5208",
      gasPrice: "0x1",
      input: "0x",
      nonce: "0x0",
      value: "0x0",
      v: "0x1",
      r: hash,
      s: hash,
      transactionIndex: "0x0",
      type: "0x2",
      chainId: toHex(m.chainId),
    };
  throw Error(`Unhandled RPC: ${method}`);
}
async function wait(fn, message, timeout = 15000) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeout) throw Error(message);
    await new Promise((r) => setTimeout(r, 100));
  }
}
async function check(name, fn) {
  await fn();
  results.push({ name, pass: true });
  console.log(`PASS ${name}`);
}
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.route("https://**", async (route) => {
    if (!m.network.rpcUrls.includes(route.request().url().replace(/\/$/, ""))) {
      failures.push(`Unexpected external resource ${route.request().url()}`);
      return route.abort();
    }
    const data = route.request().postDataJSON();
    function respond(row) {
      try {
        return {
          jsonrpc: "2.0",
          id: row.id,
          result: rpc(row.method, row.params),
        };
      } catch (e) {
        return {
          jsonrpc: "2.0",
          id: row.id,
          error: { code: e.code ?? -32000, message: e.message, data: e.data },
        };
      }
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        Array.isArray(data) ? data.map(respond) : respond(data),
      ),
    });
  });
  await context.exposeBinding("mockWallet", async (_, { method, params }) => {
    requests.push({ method, params });
    if (method === "eth_requestAccounts" || method === "eth_accounts")
      return [user];
    if (method === "eth_chainId") return state.walletChain;
    if (method === "wallet_switchEthereumChain") {
      if (!state.added) throw { code: 4902, message: "Unknown chain" };
      state.walletChain = params[0].chainId;
      return null;
    }
    if (method === "wallet_addEthereumChain") {
      assert.deepEqual(params[0], m.walletAddChain);
      state.added = true;
      return null;
    }
    if (method === "wallet_requestPermissions")
      return [{ parentCapability: "eth_accounts" }];
    if (method === "wallet_revokePermissions") return null;
    if (method === "eth_sendTransaction") {
      if (state.rejected)
        throw { code: 4001, message: "User rejected request" };
      contractCall(params, true);
      return hash;
    }
    return rpc(method, params);
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => failures.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") failures.push(msg.text());
  });
  page.on("response", (response) => {
    if (response.url().startsWith(url) && response.status() >= 400)
      failures.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(url);
  await page.getByText("Read at block", { exact: false }).waitFor();
  const button = (name) => page.getByRole("button", { name, exact: true });
  const refresh = async () => {
    await button("Refresh state").click();
    await wait(
      () => button("Refresh state").isEnabled(),
      "Read did not settle",
    );
  };
  const reviewAndConfirm = async (name) => {
    await button(name).click();
    await page.getByRole("dialog").waitFor();
    await button("Confirm in wallet").click();
    await page
      .getByText("Transaction confirmed. Refreshing contract state.")
      .waitFor();
    await wait(
      () => button("Refresh state").isEnabled(),
      "Transaction refresh did not settle",
    );
  };
  await check(
    "static subpath, disconnected actions and six contract states",
    async () => {
      assert(await button("Approve LVOT").isDisabled());
      for (const name of [
        "Active",
        "Defeated",
        "Queued",
        "Executable",
        "Executed",
        "Expired",
      ])
        assert(await page.getByText(name, { exact: true }).isVisible());
      assert.equal(await page.locator(".proposal").count(), 6);
    },
  );
  await check("missing wallet reports recovery", async () => {
    await button("Connect wallet").click();
    await page
      .getByText("No browser wallet found.", { exact: false })
      .waitFor();
    await button("Dismiss").click();
  });
  await page.evaluate(() => {
    const listeners = {};
    window.ethereum = {
      isMetaMask: true,
      on(name, cb) {
        (listeners[name] ??= []).push(cb);
      },
      removeListener(name, cb) {
        listeners[name] = (listeners[name] ?? []).filter((x) => x !== cb);
      },
      emit(name, value) {
        (listeners[name] ?? []).forEach((cb) => cb(value));
      },
      async request(args) {
        try {
          const result = await window.mockWallet(args);
          if (args.method === "wallet_switchEthereumChain")
            this.emit("chainChanged", args.params[0].chainId);
          return result;
        } catch (e) {
          if (e.message.includes("Unknown chain")) e.code = 4902;
          if (e.message.includes("rejected")) e.code = 4001;
          throw e;
        }
      },
    };
  });
  await check(
    "wrong network gates transactions; unknown chain adds exact vetted parameters",
    async () => {
      await button("Connect wallet").click();
      await button("Switch to Sepolia").waitFor();
      assert(await button("Approve LVOT").isDisabled());
      await button("Switch to Sepolia").click();
      await wait(
        () => button("Approve LVOT").isEnabled(),
        "Wallet did not become ready",
      );
      assert.equal(
        requests.filter((r) => r.method === "wallet_addEthereumChain").length,
        1,
      );
    },
  );
  await check(
    "approval is exact and separate from lock; confirmed state refresh",
    async () => {
      await page.getByLabel("Amount to lock", { exact: true }).fill("10");
      await reviewAndConfirm("Approve LVOT");
      assert.equal(writes.at(-1).functionName, "approve");
      assert.equal(
        writes.at(-1).args[0].toLowerCase(),
        treasury.address.toLowerCase(),
      );
      assert.equal(writes.at(-1).args[1], parseEther("10"));
      await reviewAndConfirm("Lock LVOT");
      assert.equal(state.locked, parseEther("200010"));
      assert.equal(state.allowance, 0n);
      assert.equal(writes.at(-1).args[0], parseEther("10"));
    },
  );
  await check(
    "unlock returns exact amount; invalid and overprecision amounts never sign",
    async () => {
      await button("Unlock").click();
      await page.getByLabel("Amount to unlock", { exact: true }).fill("1");
      await reviewAndConfirm("Unlock LVOT");
      assert.equal(state.locked, parseEther("200009"));
      const count = writes.length;
      for (const value of [
        "0",
        "-1",
        "0.0000000000000000001",
        "999999999999",
      ]) {
        await page.getByLabel("Amount to unlock", { exact: true }).fill(value);
        await button("Unlock LVOT").click();
        await page.getByRole("alert").waitFor();
        assert.equal(
          await page
            .getByLabel("Amount to unlock", { exact: true })
            .getAttribute("aria-invalid"),
          "true",
        );
        assert.equal(
          await page.evaluate(() => document.activeElement.id),
          "lock-amount",
        );
        assert.equal(writes.length, count);
        assert(!(await page.getByRole("dialog").isVisible()));
        await button("Dismiss").click();
      }
    },
  );
  await check(
    "proposal validates recipient and encodes ETH and description hash",
    async () => {
      await page.getByText("＋ Create a proposal", { exact: true }).click();
      await page
        .getByLabel("Recipient address")
        .fill("0x0000000000000000000000000000000000000000");
      await page.getByLabel("Treasury payment (ETH)").fill("0.1");
      await page
        .getByLabel("Proposal description")
        .fill("Fund a community experiment");
      await button("Review proposal").click();
      await page
        .getByRole("alert")
        .getByText("Enter a valid, nonzero Ethereum recipient address.")
        .waitFor();
      await button("Dismiss").click();
      await page.getByLabel("Recipient address").fill(other);
      await reviewAndConfirm("Review proposal");
      assert.equal(writes.at(-1).functionName, "propose");
      assert.equal(writes.at(-1).args[1], parseEther("0.1"));
      assert.equal(
        writes.at(-1).args[2],
        keccak256(stringToHex("Fund a community experiment")),
      );
      await page.getByText("＋ Create a proposal", { exact: true }).click();
    },
  );
  await check(
    "vote confirmation, frozen unlock and duplicate-vote prevention",
    async () => {
      await page
        .getByRole("button", { name: "Vote for", exact: true })
        .first()
        .click();
      await page
        .getByRole("dialog")
        .getByText("This vote cannot be changed.", { exact: false })
        .waitFor();
      await button("Confirm in wallet").click();
      await page
        .getByText("Transaction confirmed. Refreshing contract state.")
        .waitFor();
      await wait(() => button("Refresh state").isEnabled(), "Vote refresh");
      assert.equal(writes.at(-1).functionName, "vote");
      assert.equal(writes.at(-1).args[1], true);
      assert(await button("Unlock LVOT").isDisabled());
      assert(
        await page
          .getByRole("button", { name: "Vote for", exact: true })
          .first()
          .isDisabled(),
      );
      await page
        .getByText("You already voted. Votes cannot be changed.")
        .waitFor();
    },
  );
  await check(
    "execution sends the proposal ID and refreshes treasury ETH",
    async () => {
      state.treasuryBalance = 0n;
      await refresh();
      assert(await button("Execute payment").isDisabled());
      state.treasuryBalance = parseEther("2.5");
      await refresh();
      await reviewAndConfirm("Execute payment");
      assert.equal(writes.at(-1).functionName, "execute");
      assert.equal(writes.at(-1).args[0], 3n);
      assert.equal(state.treasuryBalance, parseEther("2.25"));
    },
  );
  await page.locator("#donate summary").click();
  await page.getByLabel("Donation (Sepolia ETH)").fill("0.05");
  await check("rejected wallet request remains recoverable", async () => {
    state.rejected = true;
    await button("Review donation").click();
    await button("Confirm in wallet").click();
    await page
      .getByText("Request rejected in your wallet.", { exact: false })
      .waitFor();
    state.rejected = false;
    await button("Dismiss").click();
  });
  await check("simulation failure blocks wallet signature", async () => {
    state.failSimulation = true;
    const before = requests.filter(
      (r) => r.method === "eth_sendTransaction",
    ).length;
    await button("Review donation").click();
    await button("Confirm in wallet").click();
    await page.getByRole("alert").waitFor();
    assert.equal(
      requests.filter((r) => r.method === "eth_sendTransaction").length,
      before,
    );
    assert(
      (await page.getByRole("alert").innerText()).includes("InsufficientETH"),
    );
    state.failSimulation = false;
    await button("Dismiss").click();
  });
  await check(
    "donation passes exact native value; cancelled review sends nothing",
    async () => {
      const count = writes.length;
      await button("Review donation").click();
      await page.keyboard.press("Escape");
      assert.equal(writes.length, count);
      assert.equal(
        await page.evaluate(() => document.activeElement.textContent),
        "Review donation",
      );
      await reviewAndConfirm("Review donation");
      assert.equal(writes.at(-1).functionName, "donate");
      assert.equal(BigInt(writes.at(-1).value), parseEther("0.05"));
    },
  );
  await check("mined revert does not report success", async () => {
    state.receiptRevert = true;
    await button("Review donation").click();
    await button("Confirm in wallet").click();
    await page.getByText("Transaction reverted.", { exact: false }).waitFor();
    state.receiptRevert = false;
    await button("Dismiss").click();
  });
  await check("pagination reads all proposal IDs from views", async () => {
    await button("Older proposals").click();
    await page.getByText("Proposal 000", { exact: true }).waitFor();
    assert.equal(await page.locator(".proposal").count(), 1);
    await reviewAndConfirm("Vote against");
    assert.equal(writes.at(-1).functionName, "vote");
    assert.equal(writes.at(-1).args[0], 0n);
    assert.equal(writes.at(-1).args[1], false);
    await button("Newer proposals").click();
    await page.getByText("Proposal 006", { exact: true }).waitFor();
  });
  await check(
    "missing code, linked-token mismatch and RPC failure disable writes",
    async () => {
      for (const flag of ["noCode", "mismatchedToken", "failRPC"]) {
        state[flag] = true;
        await refresh();
        await page
          .getByText("Contract reads unavailable.", { exact: false })
          .waitFor();
        assert(await button("Review donation").isDisabled());
        state[flag] = false;
        await button("Retry refresh").click();
        await wait(
          () => button("Review donation").isEnabled(),
          `Recovery failed for ${flag}`,
          30000,
        );
      }
    },
  );
  await check(
    "account changes invalidate wallet snapshot and close reviews",
    async () => {
      await button("Review donation").click();
      await page.evaluate(
        (address) => window.ethereum.emit("accountsChanged", [address]),
        other,
      );
      await wait(
        async () => !(await page.getByRole("dialog").isVisible()),
        "Review remained open",
      );
      await page.evaluate(
        (address) => window.ethereum.emit("accountsChanged", [address]),
        user,
      );
      await wait(
        () => button("Review donation").isEnabled(),
        "Account refresh",
      );
    },
  );
  await page.locator("#donate summary").click();
  await check("keyboard navigation and modal focus confinement", async () => {
    await page.locator("#donate summary").focus();
    await page.keyboard.press("Enter");
    await button("Review donation").focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(() => document.activeElement.textContent),
      "Cancel",
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.textContent),
      "Confirm in wallet",
    );
    await page.keyboard.press("Tab");
    // Chromium may visit browser chrome (body as activeElement) before wrapping.
    assert(
      await page.evaluate(
        () =>
          document.activeElement === document.body ||
          !!document.activeElement.closest("dialog"),
      ),
      "Focus reached background control",
    );
    if (await page.evaluate(() => document.activeElement === document.body))
      await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.textContent),
      "Cancel",
    );
    await page.screenshot({ path: resolve(evidence, "review-desktop.png") });
    await page.keyboard.press("Escape");
    await page.locator("#donate summary").click();
  });
  await check(
    "responsive export and automated accessibility at desktop, tablet and 320px",
    async () => {
      for (const width of [1440, 768, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(() => scrollTo(0, 0));
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `Overflow at ${width}`,
        );
        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        writeFileSync(
          resolve(evidence, `accessibility-${width}.json`),
          JSON.stringify(
            { violations: axe.violations, passes: axe.passes.map((p) => p.id) },
            null,
            2,
          ),
        );
        assert.deepEqual(
          axe.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
          })),
          [],
        );
        await page.screenshot({
          path: resolve(evidence, `connected-${width}.png`),
          fullPage: false,
        });
      }
      await page.locator(".participation").scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(evidence, "controls-320.png") });
      await page.locator(".proposal").first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(evidence, "proposal-320.png") });
      const contrast = await page.evaluate(() => {
        const rgba = (value) =>
          value
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number);
        const luminance = (rgb) =>
          rgb
            .map((v) => {
              const c = v / 255;
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            })
            .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        return [
          ".lead",
          ".test-notice p",
          ".treasury-stat .eyebrow",
          ".treasury-stat a",
          ".new-proposal summary .small",
          ".state-0",
          ".state-1",
        ].map((selector) => {
          const el = document.querySelector(selector);
          const foreground = getComputedStyle(el).color;
          let bg = el;
          while (
            bg.parentElement &&
            ["rgba(0, 0, 0, 0)", "transparent"].includes(
              getComputedStyle(bg).backgroundColor,
            )
          )
            bg = bg.parentElement;
          const background = getComputedStyle(bg).backgroundColor;
          const a = luminance(rgba(foreground)),
            b = luminance(rgba(background));
          return {
            selector,
            foreground,
            background,
            ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          };
        });
      });
      assert(contrast.every((c) => c.ratio >= 4.5));
      writeFileSync(
        resolve(evidence, "contrast.json"),
        JSON.stringify(contrast, null, 2),
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(
        await button("Disconnect").evaluate(
          (el) => getComputedStyle(el).transitionDuration,
        ),
        "0s",
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
    },
  );
  await check("empty state and enlarged text reflow", async () => {
    state.countOverride = 0;
    await refresh();
    await page.getByText("The next idea could be yours.").waitFor();
    await page.setViewportSize({ width: 768, height: 1000 });
    await page.evaluate(
      () => (document.documentElement.style.fontSize = "200%"),
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Text resize overflow",
    );
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await button("Disconnect").click();
    await page.screenshot({
      path: resolve(evidence, "empty-desktop.png"),
      fullPage: true,
    });
  });
  await check("runtime ABI tampering fails closed", async () => {
    const tampered = await context.newPage();
    await tampered.route("**/abi/LaunchToken.json", (route) =>
      route.fulfill({ contentType: "application/json", body: "[]" }),
    );
    await tampered.goto(url);
    await tampered
      .getByText("ABI integrity check failed for LaunchToken.")
      .waitFor();
    assert.equal(
      await tampered.getByRole("button", { name: "Connect wallet" }).count(),
      0,
    );
    await tampered.close();
  });
  assert.deepEqual(failures, [], "Console or asset failures");
  results.push({
    name: "no browser console errors or failed local assets",
    pass: true,
  });
  writeFileSync(
    resolve(evidence, "interactions.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        browser: await browser.version(),
        exportPath: "/preview/",
        realTransactions: 0,
        mockedTransactionFunctions: writes.map((w) => w.functionName),
        tests: results,
        consoleErrors: failures,
        screenshots: [
          "connected-1440.png",
          "connected-768.png",
          "connected-320.png",
          "review-desktop.png",
          "empty-desktop.png",
          "controls-320.png",
          "proposal-320.png",
        ],
      },
      null,
      2,
    ) + "\n",
  );
} catch (e) {
  console.error(e);
  if (browser) {
    const pages = browser.contexts()[0]?.pages();
    if (pages?.[0]) {
      await pages[0].screenshot({
        path: resolve(root, "test/scratch/test-failure.png"),
        fullPage: true,
      });
      writeFileSync(
        resolve(root, "test/scratch/test-failure.txt"),
        await pages[0].locator("body").innerText(),
      );
    }
  }
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
