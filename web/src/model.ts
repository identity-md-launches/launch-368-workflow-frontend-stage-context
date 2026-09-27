import {
  BaseError,
  ContractFunctionRevertedError,
  formatUnits,
  maxUint256,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import type { Runtime } from "./config";
export const stateNames = [
  "Active",
  "Defeated",
  "Queued",
  "Executable",
  "Executed",
  "Expired",
];
export type Proposal = {
  id: bigint;
  recipient: Address;
  amount: bigint;
  descriptionHash: Hex;
  proposer: Address;
  voteEnd: bigint;
  forVotes: bigint;
  againstVotes: bigint;
  state: number;
  voted: boolean;
};
export type Snapshot = {
  block: bigint;
  timestamp: bigint;
  fetchedAt: number;
  treasuryBalance: bigint;
  balance: bigint;
  allowance: bigint;
  locked: bigint;
  until: bigint;
  decimals: number;
  symbol: string;
  count: bigint;
  proposals: Proposal[];
  threshold: bigint;
  quorum: bigint;
  delay: bigint;
  expiry: bigint;
};
export function amount(input: string, decimals: number) {
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`).test(input.trim()))
    throw Error(
      `Enter a positive amount with at most ${decimals} decimal places.`,
    );
  const value = parseUnits(input.trim(), decimals);
  if (value <= 0n || value > maxUint256)
    throw Error("Enter a positive amount within the token limit.");
  return value;
}
export function units(value: bigint, decimals = 18) {
  const [whole, fraction] = formatUnits(value, decimals).split(".");
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    (fraction ? `.${fraction}` : "")
  );
}
export function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
export function date(timestamp: bigint) {
  return new Date(Number(timestamp) * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
export function errorText(error: unknown): string {
  if (error instanceof BaseError) {
    const revert = error.walk(
      (cause) => cause instanceof ContractFunctionRevertedError,
    );
    if (
      revert instanceof ContractFunctionRevertedError &&
      revert.data?.errorName
    ) {
      const name = revert.data.errorName;
      const guidance: Record<string, string> = {
        InsufficientETH:
          "The treasury needs more ETH. Refresh its balance before retrying.",
        ETHTransferFailed:
          "The recipient rejected this payment. It can be retried within the execution window if the recipient can accept ETH.",
        TokensStillLocked:
          "Wait until your displayed unlock time, then refresh.",
        AlreadyVoted:
          "You already voted on this proposal. Votes cannot be changed.",
        VotingClosed: "Voting has ended. Refresh the proposal state.",
        ExecutionTooEarly:
          "Wait until the execution window opens, then refresh.",
        ProposalExpired:
          "The execution window has ended. This proposal cannot be paid.",
        AlreadyExecuted:
          "This proposal has already been paid. Refresh the list.",
        ProposalNotPassed:
          "This proposal did not meet quorum and a strict majority.",
        InsufficientLockedBalance:
          "Check your locked balance and the proposal threshold.",
        NoVotingWeight: "Lock LVOT before voting.",
        ERC20InsufficientAllowance:
          "Approve the treasury for the amount you want to lock.",
        ERC20InsufficientBalance:
          "Enter an amount within your available LVOT balance.",
      };
      return `${name}: ${guidance[name] || "The contract rejected this request. Refresh state and review the inputs before retrying."}`;
    }
  }
  const e = error as {
    shortMessage?: string;
    message?: string;
    code?: number;
    cause?: unknown;
  };
  if (
    e.code === 4001 ||
    /rejected|denied/i.test(e.shortMessage || e.message || "")
  )
    return "Request rejected in your wallet. No action was confirmed; you can try again.";
  return (
    e.shortMessage ||
    e.message ||
    "Request failed. Check your connection and try again."
  );
}
export function unknownChain(error: unknown): boolean {
  const e = error as { code?: number; message?: string; cause?: unknown };
  return (
    e.code === 4902 ||
    /unknown chain|unrecognized chain|not added/i.test(e.message || "") ||
    !!(e.cause && unknownChain(e.cause))
  );
}
export async function snapshot(
  r: Runtime,
  account: Address | undefined,
  page: number,
): Promise<Snapshot> {
  const c = r.publicClient;
  if ((await c.getChainId()) !== r.chain.id)
    throw Error(
      "RPC returned the wrong network. Transactions are disabled. Retry refresh.",
    );
  const block = await c.getBlock();
  if (Date.now() / 1000 - Number(block.timestamp) > 180)
    throw Error(
      "RPC block is stale. Transactions are disabled. Retry refresh.",
    );
  const read = (
    token: boolean,
    functionName: string,
    args?: readonly unknown[],
  ) =>
    c.readContract({
      address: token ? r.token.address : r.treasury.address,
      abi: token ? r.token.abi : r.treasury.abi,
      functionName,
      args: args ?? [],
      blockNumber: block.number,
    }) as Promise<unknown>;
  const [treasuryCode, tokenCode, linkedToken] = await Promise.all([
    c.getCode({ address: r.treasury.address, blockNumber: block.number }),
    c.getCode({ address: r.token.address, blockNumber: block.number }),
    read(false, "token"),
  ]);
  if (
    !treasuryCode ||
    treasuryCode === "0x" ||
    !tokenCode ||
    tokenCode === "0x" ||
    String(linkedToken).toLowerCase() !== r.token.address.toLowerCase()
  )
    throw Error(
      "Deployment verification failed: code or treasury token mismatch. Transactions are disabled.",
    );
  // After token() matches the handoff, this same address is used for balance and allowance.
  const [
    treasuryBalance,
    count,
    decimals,
    symbol,
    threshold,
    quorum,
    delay,
    expiry,
    balance,
    allowance,
    locked,
    until,
  ] = await Promise.all([
    c.getBalance({ address: r.treasury.address, blockNumber: block.number }),
    read(false, "proposalCount"),
    read(true, "decimals"),
    read(true, "symbol"),
    read(false, "PROPOSAL_THRESHOLD"),
    read(false, "QUORUM"),
    read(false, "EXECUTION_DELAY"),
    read(false, "EXECUTION_EXPIRY"),
    account ? read(true, "balanceOf", [account]) : 0n,
    account ? read(true, "allowance", [account, r.treasury.address]) : 0n,
    account ? read(false, "locked", [account]) : 0n,
    account ? read(false, "lockedUntil", [account]) : 0n,
  ]);
  const start = (count as bigint) - 1n - BigInt(page * 6);
  const ids = Array.from({ length: 6 }, (_, i) => start - BigInt(i)).filter(
    (id) => id >= 0n,
  );
  const proposals = await Promise.all(
    ids.map(async (id) => {
      const [tuple, voted] = await Promise.all([
        read(false, "proposal", [id]),
        account ? read(false, "hasVoted", [id, account]) : false,
      ]);
      const [
        recipient,
        amount,
        descriptionHash,
        proposer,
        voteEnd,
        forVotes,
        againstVotes,
        state,
      ] = tuple as [
        Address,
        bigint,
        Hex,
        Address,
        bigint,
        bigint,
        bigint,
        number,
      ];
      return {
        id,
        recipient,
        amount,
        descriptionHash,
        proposer,
        voteEnd,
        forVotes,
        againstVotes,
        state,
        voted: voted as boolean,
      };
    }),
  );
  return {
    block: block.number,
    timestamp: block.timestamp,
    fetchedAt: Date.now(),
    treasuryBalance,
    count,
    decimals,
    symbol,
    threshold,
    quorum,
    delay,
    expiry,
    balance,
    allowance,
    locked,
    until,
    proposals,
  } as Snapshot;
}
