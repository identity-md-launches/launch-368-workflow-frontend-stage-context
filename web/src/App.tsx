import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  connect,
  disconnect,
  getAccount,
  getWalletClient,
  watchAccount,
} from "@wagmi/core";
import {
  isAddress,
  keccak256,
  stringToHex,
  zeroAddress,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import type { Runtime } from "./config";
import {
  amount,
  date,
  errorText,
  short,
  snapshot,
  stateNames,
  units,
  unknownChain,
  type Proposal,
  type Snapshot,
} from "./model";

type Action = {
  title: string;
  explanation: string;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  token?: boolean;
};
export default function App({ runtime: r }: { runtime: Runtime }) {
  const [wallet, setWallet] = useState(() => getAccount(r.walletConfig));
  const [data, setData] = useState<{ key: string; value: Snapshot }>();
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState("");
  const [error, setError] = useState("");
  const [fieldIssue, setFieldIssue] = useState<{
    id: string;
    message: string;
  }>();
  const [status, setStatus] = useState("");
  const [tx, setTx] = useState<Hex>();
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Action>();
  const [lockMode, setLockMode] = useState<"lock" | "unlock">("lock");
  const [lockAmount, setLockAmount] = useState("");
  const [description, setDescription] = useState("");
  const [clock, setClock] = useState(Date.now());
  const dialog = useRef<HTMLDialogElement>(null);
  const key = `${wallet.address || ""}:${page}`;
  const s = data?.key === key ? data.value : undefined;
  const wrongChain = wallet.isConnected && wallet.chainId !== r.chain.id;
  const fresh = !!s && clock - s.fetchedAt < 45000;
  const ready =
    wallet.isConnected &&
    !wrongChain &&
    fresh &&
    !readError &&
    !loading &&
    !busy;
  const needs = !wallet.isConnected
    ? "Connect your wallet to take part."
    : wrongChain
      ? `Switch to ${r.chain.name} to continue.`
      : readError
        ? "Refresh and verify the deployment to continue."
        : !fresh || loading
          ? "Waiting for a fresh contract read…"
          : "";
  const explorer = r.deployment.network.explorer;
  useEffect(
    () =>
      watchAccount(r.walletConfig, {
        onChange: (account) => {
          setWallet(account);
          setReview(undefined);
          setError("");
        },
      }),
    [r],
  );
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    snapshot(r, wallet.address, page)
      .then((value) => {
        if (!cancelled) {
          setData({ key, value });
          setReadError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setReadError(errorText(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [r, key, refresh, wallet.address, page]);
  useEffect(() => {
    const id = setInterval(() => {
      setClock(Date.now());
      setRefresh((v) => v + 1);
    }, 15000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (review) dialog.current?.showModal();
    else dialog.current?.close();
  }, [review]);

  async function connectionTask(task: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await task();
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function connectWallet() {
    const connector = r.walletConfig.connectors[0];
    if (!connector || !(await connector.getProvider()))
      throw Error(
        "No browser wallet found. Install an Ethereum browser wallet, then reload this page.",
      );
    await connect(r.walletConfig, { connector });
  }
  async function switchNetwork() {
    const provider = (await wallet.connector?.getProvider()) as
      | EIP1193Provider
      | undefined;
    if (!provider) throw Error("Reconnect your wallet to switch networks.");
    const chainId = r.deployment.walletAddChain.chainId as Hex;
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId }],
      });
    } catch (e) {
      if (!unknownChain(e)) throw e;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{ ...r.deployment.walletAddChain, chainId }],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId }],
      });
    }
    if (
      Number(await provider.request({ method: "eth_chainId" })) !== r.chain.id
    )
      throw Error(`Switch to ${r.chain.name} in your wallet, then try again.`);
  }
  function proposeReview(action: Action) {
    if (!ready) return;
    setError("");
    setReview(action);
  }
  async function transact(action: Action) {
    setReview(undefined);
    setBusy(true);
    setError("");
    setTx(undefined);
    setStatus("Checking this transaction…");
    try {
      const account = getAccount(r.walletConfig);
      if (!account.address || account.chainId !== r.chain.id)
        throw Error(
          "Wallet network or account changed. Reconnect and try again.",
        );
      await snapshot(r, account.address, page);
      const target = action.token ? r.token : r.treasury;
      const { request } = await r.publicClient.simulateContract({
        address: target.address,
        abi: target.abi,
        functionName: action.functionName,
        args: action.args ?? [],
        value: action.value,
        account: account.address,
      });
      const latest = getAccount(r.walletConfig);
      if (latest.address !== account.address || latest.chainId !== r.chain.id)
        throw Error("Wallet changed during review. Try again.");
      setStatus("Confirm the transaction in your wallet.");
      const signer = await getWalletClient(r.walletConfig, {
        chainId: r.chain.id,
      });
      const hash = await signer.writeContract({ ...request, chain: r.chain });
      setTx(hash);
      setStatus("Transaction submitted. Waiting for confirmation…");
      let replacementReason = "";
      const receipt = await r.publicClient.waitForTransactionReceipt({
        hash,
        timeout: 180000,
        onReplaced: (replacement) => {
          replacementReason = replacement.reason;
          setTx(replacement.transaction.hash);
          if (replacement.reason === "cancelled")
            setStatus("A cancellation transaction replaced this request.");
        },
      });
      if (replacementReason === "cancelled" || replacementReason === "replaced")
        throw Error(
          "Your original transaction was replaced. Review the transaction link and refreshed state before trying again.",
        );
      if (receipt.status !== "success")
        throw Error(
          "Transaction reverted. Refresh state and review the request before retrying.",
        );
      setStatus("Transaction confirmed. Refreshing contract state.");
    } catch (e) {
      setError(errorText(e));
      setStatus("");
    } finally {
      setBusy(false);
      setRefresh((v) => v + 1);
    }
  }
  function formAction(
    e: FormEvent<HTMLFormElement>,
    callback: (form: FormData) => void,
  ) {
    e.preventDefault();
    setError("");
    setFieldIssue(undefined);
    try {
      callback(new FormData(e.currentTarget));
    } catch (e) {
      setError(errorText(e));
    }
  }
  function invalidField(id: string, message: string): never {
    setFieldIssue({ id, message });
    document.getElementById(id)?.focus();
    throw Error(message);
  }
  function parseAmount(input: string, decimals: number, id: string) {
    try {
      return amount(input, decimals);
    } catch (e) {
      return invalidField(id, errorText(e));
    }
  }
  function fieldAttributes(id: string) {
    return {
      "aria-invalid": fieldIssue?.id === id || undefined,
      "aria-describedby": fieldIssue?.id === id ? `${id}-error` : undefined,
      onInput: () => setFieldIssue(undefined),
    };
  }
  function fieldMessage(id: string) {
    return fieldIssue?.id === id ? (
      <p id={`${id}-error`} className="field-error small">
        {fieldIssue.message}
      </p>
    ) : null;
  }
  function lockAction() {
    if (!s) return;
    const value = parseAmount(lockAmount, s.decimals, "lock-amount");
    if (lockMode === "unlock") {
      if (s.timestamp < s.until)
        throw Error(
          `Your tokens unlock ${date(s.until)}. Wait until then and refresh.`,
        );
      if (value > s.locked)
        invalidField(
          "lock-amount",
          "Enter an amount no greater than your locked balance.",
        );
      proposeReview({
        title: `Unlock ${units(value, s.decimals)} ${s.symbol}`,
        explanation:
          "Return these tokens from the treasury to your wallet. Your future voting weight will decrease.",
        functionName: "unlock",
        args: [value],
      });
    } else {
      if (value > s.balance)
        invalidField(
          "lock-amount",
          "Enter an amount no greater than your wallet balance.",
        );
      if (s.allowance < value)
        proposeReview({
          title: `Approve ${units(value, s.decimals)} ${s.symbol}`,
          explanation: `Allow treasury ${r.treasury.address} to transfer exactly this allowance from your wallet. After confirmation, select Lock LVOT to deposit.`,
          functionName: "approve",
          token: true,
          args: [r.treasury.address, value],
        });
      else
        proposeReview({
          title: `Lock ${units(value, s.decimals)} ${s.symbol}`,
          explanation:
            "Deposit these tokens for voting weight. Voting freezes your entire locked balance until the latest vote end. Additional locks do not change votes already cast.",
          functionName: "lock",
          args: [value],
        });
    }
  }
  const lockNeedsApproval = (() => {
    try {
      return !!s && amount(lockAmount, s.decimals) > s.allowance;
    } catch {
      return true;
    }
  })();
  function vote(p: Proposal, support: boolean) {
    proposeReview({
      title: `Vote ${support ? "for" : "against"} proposal #${p.id}`,
      explanation: `Your ${units(s!.locked, s!.decimals)} ${s!.symbol} locked balance counts once. This vote cannot be changed. Your entire locked balance stays frozen until at least ${date(p.voteEnd)}.`,
      functionName: "vote",
      args: [p.id, support],
    });
  }
  function proposalCard(p: Proposal) {
    if (!s) return null;
    const total = p.forVotes + p.againstVotes;
    const percent = Number((total * 10000n) / s.quorum) / 100;
    return (
      <article className="proposal" key={String(p.id)}>
        <div className="row spread">
          <span className="eyebrow">
            Proposal {String(p.id).padStart(3, "0")}
          </span>
          <span className={`badge state-${p.state}`}>
            {stateNames[p.state] || "Unknown"}
          </span>
        </div>
        <h3>Send {units(p.amount)} ETH</h3>
        <a
          className="mono recipient"
          href={`${explorer}/address/${p.recipient}`}
          target="_blank"
          rel="noreferrer"
        >
          To {p.recipient} ↗
        </a>
        <div className="tallies">
          <div>
            <span>For</span>
            <strong>
              {units(p.forVotes, s.decimals)} <small>{s.symbol}</small>
            </strong>
          </div>
          <div>
            <span>Against</span>
            <strong>
              {units(p.againstVotes, s.decimals)} <small>{s.symbol}</small>
            </strong>
          </div>
        </div>
        <progress
          max="100"
          value={Math.min(100, percent)}
          aria-label={`Proposal ${p.id} quorum progress`}
        />
        <div className="row spread small muted">
          <span>
            {percent.toLocaleString(undefined, { maximumFractionDigits: 2 })}%
            of quorum
          </span>
          <span>
            {units(s.quorum, s.decimals)} {s.symbol} needed
          </span>
        </div>
        <p className="small">
          Voting {p.state === 0 ? "ends" : "ended"}{" "}
          <time dateTime={new Date(Number(p.voteEnd) * 1000).toISOString()}>
            {date(p.voteEnd)}
          </time>
        </p>
        <details>
          <summary>Proposal details</summary>
          <dl className="details-list">
            <dt>Description hash</dt>
            <dd className="mono">{p.descriptionHash}</dd>
            <dt>Proposed by</dt>
            <dd>
              <a
                href={`${explorer}/address/${p.proposer}`}
                target="_blank"
                rel="noreferrer"
                className="mono"
              >
                {p.proposer} ↗
              </a>
            </dd>
            <dt>Execution window, if passed</dt>
            <dd>
              {date(p.voteEnd + s.delay)} – {date(p.voteEnd + s.expiry)}{" "}
              (exclusive)
            </dd>
          </dl>
          <p className="small muted">
            Only the description hash is stored on-chain; the original text
            cannot be recovered here.
          </p>
        </details>
        {p.state === 0 && (
          <>
            <div className="row actions">
              <button
                disabled={!ready || p.voted || !s.locked}
                onClick={() => vote(p, true)}
              >
                Vote for
              </button>
              <button
                disabled={!ready || p.voted || !s.locked}
                onClick={() => vote(p, false)}
              >
                Vote against
              </button>
            </div>
            <p className="small muted">
              {p.voted
                ? "You already voted. Votes cannot be changed."
                : !wallet.isConnected
                  ? "Connect your wallet to vote."
                  : s.locked === 0n
                    ? "Lock LVOT to gain voting weight."
                    : "Voting freezes your entire locked balance until voting ends."}
            </p>
          </>
        )}
        {p.state === 3 && (
          <>
            <button
              disabled={!ready || s.treasuryBalance < p.amount}
              onClick={() =>
                proposeReview({
                  title: `Execute proposal #${p.id}`,
                  explanation: `Send ${units(p.amount)} ETH from the treasury to ${p.recipient}. This payment cannot be reversed.`,
                  functionName: "execute",
                  args: [p.id],
                })
              }
            >
              Execute payment
            </button>
            {s.treasuryBalance < p.amount && (
              <p className="small muted">
                Treasury needs {units(p.amount - s.treasuryBalance)} more ETH to
                pay this proposal.
              </p>
            )}
          </>
        )}
        {p.state === 2 && (
          <p className="small muted">
            Execution opens {date(p.voteEnd + s.delay)}. The one-day delay gives
            visibility only.
          </p>
        )}
      </article>
    );
  }
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <a href="#main" className="brand" aria-label="Lockvote home">
          <span className="brand-mark" aria-hidden="true">
            L<span>↗</span>
          </span>
          lockvote<span className="brand-tag">Collective treasury</span>
        </a>
        <div className="row wallet-controls">
          <span className="network-label">
            <span aria-hidden="true">●</span> {r.chain.name}
          </span>
          {wallet.isConnected ? (
            <>
              <a
                className="wallet-address mono"
                href={`${explorer}/address/${wallet.address}`}
                target="_blank"
                rel="noreferrer"
                title={wallet.address}
              >
                {short(wallet.address!)}
              </a>
              <button
                disabled={busy}
                onClick={() => connectionTask(() => disconnect(r.walletConfig))}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="primary"
              disabled={busy}
              onClick={() => connectionTask(connectWallet)}
            >
              {busy ? "Connecting…" : "Connect wallet"}{" "}
              <span aria-hidden="true">↗</span>
            </button>
          )}
        </div>
      </header>
      <main id="main">
        <section className="intro">
          <div>
            <p className="eyebrow">A small experiment in shared decisions</p>
            <h1>
              A treasury,
              <br />
              governed together.
            </h1>
            <p className="lead">
              Lock your LVOT. Put an idea to a vote.
              <br className="desktop-break" /> Decide where the treasury goes
              next.
            </p>
          </div>
          <div className="intro-note">
            <span className="note-mark" aria-hidden="true">
              ↗
            </span>
            <p>
              One token. One voice.
              <br />
              <strong>Every locked LVOT counts.</strong>
            </p>
            <a href="#how-it-works">
              How it works <span aria-hidden="true">↓</span>
            </a>
          </div>
        </section>
        <div className="test-notice">
          <span className="badge">Testnet experiment</span>
          <p>
            This treasury holds donated Sepolia test ETH only. LVOT votes carry
            no off-chain rights.
          </p>
        </div>
        {wrongChain && (
          <div className="notice warning">
            <p>
              Your wallet is on a different network. Switch to {r.chain.name} to
              take part.
            </p>
            <button
              disabled={busy}
              onClick={() => connectionTask(switchNetwork)}
            >
              Switch to {r.chain.name}
            </button>
          </div>
        )}
        <div className="transaction-status" role="status">
          {status}
          {tx && (
            <>
              {" "}
              <a href={`${explorer}/tx/${tx}`} target="_blank" rel="noreferrer">
                View transaction ↗
              </a>
            </>
          )}
        </div>
        {error && (
          <div role="alert" className="notice error">
            <p>{error}</p>
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {readError && (
          <div role="alert" className="notice error">
            <p>Contract reads unavailable. {readError}</p>
            <button disabled={loading} onClick={() => setRefresh((v) => v + 1)}>
              Retry refresh
            </button>
          </div>
        )}
        <section className="overview" aria-label="Treasury overview">
          <div className="treasury-stat">
            <p className="eyebrow">The shared treasury</p>
            <p className="big-number">
              {s ? units(s.treasuryBalance) : "—"} <span>ETH</span>
            </p>
            <div className="row spread">
              <span className="small">Funded by the community</span>
              <a href="#donate">Add funds ↗</a>
            </div>
          </div>
          <div className="stat">
            <span className="stat-icon" aria-hidden="true">
              ◷
            </span>
            <p className="eyebrow">Voting period</p>
            <p className="stat-number">
              3 <span>days</span>
            </p>
            <p className="small muted">Time to make your voice count</p>
          </div>
          <div className="stat">
            <span className="stat-icon" aria-hidden="true">
              ◎
            </span>
            <p className="eyebrow">Quorum</p>
            <p className="stat-number">
              {s ? units(s.quorum, s.decimals) : "1,000,000"}
            </p>
            <p className="small muted">LVOT votes · strict majority wins</p>
          </div>
        </section>
        <div className="workspace">
          <aside className="participation">
            <section className="panel">
              <div className="row spread">
                <h2>Your voting power</h2>
                <span aria-hidden="true" className="square-icon">
                  ↗
                </span>
              </div>
              <p className="power">
                {wallet.isConnected && s ? units(s.locked, s.decimals) : "—"}{" "}
                <span>LVOT locked</span>
              </p>
              <dl className="balance-list">
                <div>
                  <dt>Wallet balance</dt>
                  <dd>
                    {wallet.isConnected && s
                      ? `${units(s.balance, s.decimals)} ${s.symbol}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Treasury allowance</dt>
                  <dd>
                    {wallet.isConnected && s
                      ? `${units(s.allowance, s.decimals)} ${s.symbol}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Unlock time</dt>
                  <dd>
                    {wallet.isConnected && s
                      ? s.until > s.timestamp
                        ? date(s.until)
                        : "Available now"
                      : "Connect to view"}
                  </dd>
                </div>
              </dl>
              <div className="segment" aria-label="Token action">
                <button
                  aria-pressed={lockMode === "lock"}
                  onClick={() => setLockMode("lock")}
                >
                  Lock
                </button>
                <button
                  aria-pressed={lockMode === "unlock"}
                  onClick={() => setLockMode("unlock")}
                >
                  Unlock
                </button>
              </div>
              <form onSubmit={(e) => formAction(e, lockAction)}>
                <label htmlFor="lock-amount">
                  {lockMode === "lock" ? "Amount to lock" : "Amount to unlock"}
                </label>
                <div className="amount-field">
                  <input
                    id="lock-amount"
                    {...fieldAttributes("lock-amount")}
                    name="lockAmount"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    required
                    value={lockAmount}
                    onChange={(e) => setLockAmount(e.target.value)}
                    aria-describedby={
                      fieldIssue?.id === "lock-amount"
                        ? "lock-amount-error lock-help"
                        : "lock-help"
                    }
                  />
                  <span>LVOT</span>
                </div>
                {fieldMessage("lock-amount")}
                <p id="lock-help" className="small muted">
                  {lockMode === "lock"
                    ? "1. Approve the treasury. 2. Lock your LVOT."
                    : "Unlocking returns tokens to your wallet. Wait until your latest vote ends."}
                </p>
                <button
                  className="wide"
                  type="submit"
                  disabled={
                    !ready ||
                    (lockMode === "unlock" &&
                      !!s &&
                      (s.timestamp < s.until || !s.locked))
                  }
                >
                  {lockMode === "unlock"
                    ? "Unlock LVOT"
                    : lockNeedsApproval
                      ? "Approve LVOT"
                      : "Lock LVOT"}{" "}
                  <span aria-hidden="true">↗</span>
                </button>
              </form>
              <p className="small muted">
                {needs ||
                  "Review each transaction before signing in your wallet."}
              </p>
            </section>
            <section className="acquire">
              <span className="eyebrow">Start with LVOT</span>
              <h3>Tokens give you a say.</h3>
              <p className="small muted">
                Get LVOT by swapping Sepolia ETH in the launch pool using a
                compatible Uniswap v4 interface. Then return here to approve and
                lock.
              </p>
              <a
                href={`${explorer}/token/${r.token.address}`}
                target="_blank"
                rel="noreferrer"
              >
                View LVOT token ↗
              </a>
            </section>
          </aside>
          <section className="proposals" aria-labelledby="proposals-heading">
            <div className="row spread section-heading">
              <div>
                <span className="eyebrow">Make the next move</span>
                <h2 id="proposals-heading">
                  Proposals{" "}
                  <span className="count">{s ? String(s.count) : "—"}</span>
                </h2>
              </div>
              <button
                disabled={loading || busy}
                onClick={() => setRefresh((v) => v + 1)}
              >
                {loading ? "Refreshing…" : "Refresh state"}
              </button>
            </div>
            <details className="new-proposal">
              <summary>
                <span>＋ Create a proposal</span>
                <span className="small">100,000 LVOT locked required</span>
              </summary>
              <form
                onSubmit={(e) =>
                  formAction(e, (form) => {
                    if (!s) return;
                    const recipient = String(form.get("recipient")).trim();
                    if (
                      !isAddress(recipient) ||
                      recipient.toLowerCase() === zeroAddress
                    )
                      invalidField(
                        "recipient",
                        "Enter a valid, nonzero Ethereum recipient address.",
                      );
                    const value = parseAmount(
                      String(form.get("eth")),
                      18,
                      "proposal-eth",
                    );
                    const hash = keccak256(stringToHex(description));
                    proposeReview({
                      title: `Propose a ${units(value)} ETH payment`,
                      explanation: `Recipient: ${recipient}. Description hash: ${hash}. Voting runs for 3 days. Your description text is not published or stored by this page; share it separately with voters.`,
                      functionName: "propose",
                      args: [recipient as Address, value, hash],
                    });
                  })
                }
              >
                <label htmlFor="recipient">Recipient address</label>
                <input
                  id="recipient"
                  {...fieldAttributes("recipient")}
                  name="recipient"
                  placeholder="0x…"
                  required
                  autoComplete="off"
                />
                {fieldMessage("recipient")}
                <label htmlFor="proposal-eth">Treasury payment (ETH)</label>
                <input
                  id="proposal-eth"
                  {...fieldAttributes("proposal-eth")}
                  name="eth"
                  inputMode="decimal"
                  required
                  placeholder="0.01"
                />
                {fieldMessage("proposal-eth")}
                <label htmlFor="description">Proposal description</label>
                <textarea
                  id="description"
                  name="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  maxLength={4000}
                  rows={3}
                  aria-describedby="description-help"
                  placeholder="Explain the purpose of this payment"
                />
                <p id="description-help" className="small muted">
                  Only its Keccak-256 hash is stored on-chain. Share the exact
                  text with voters separately.
                </p>
                {description && (
                  <output className="hash small mono">
                    {keccak256(stringToHex(description))}
                  </output>
                )}
                <button
                  type="submit"
                  disabled={!ready || !s || s.locked < s.threshold}
                >
                  Review proposal
                </button>
                <p className="small muted">
                  {needs ||
                    (s && s.locked < s.threshold
                      ? `Lock at least ${units(s.threshold, s.decimals)} LVOT to propose.`
                      : "Proposing does not cast a vote or freeze your tokens.")}
                </p>
              </form>
            </details>
            {!s ? (
              <div className="empty">
                <span className="empty-symbol" aria-hidden="true">
                  ≡
                </span>
                <h3>
                  {readError
                    ? "Waiting for the network"
                    : "Reading the treasury…"}
                </h3>
                <p>Proposals and tallies come directly from the contract.</p>
              </div>
            ) : s.count === 0n ? (
              <div className="empty">
                <span className="empty-symbol" aria-hidden="true">
                  ↗
                </span>
                <h3>The next idea could be yours.</h3>
                <p>
                  No proposals yet. Lock at least 100,000 LVOT,
                  <br />
                  then propose the treasury’s first payment.
                </p>
              </div>
            ) : (
              <div className="proposal-list">
                {s.proposals.map(proposalCard)}
              </div>
            )}
            {s && s.count > 6n && (
              <nav
                className="row spread pagination"
                aria-label="Proposal pages"
              >
                <button
                  disabled={!page || loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Newer proposals
                </button>
                <span className="small">Page {page + 1}</span>
                <button
                  disabled={BigInt((page + 1) * 6) >= s.count || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Older proposals
                </button>
              </nav>
            )}
            <p className="read-status small muted">
              {s ? (
                <>
                  Read at block {String(s.block)} · {date(s.timestamp)} ·
                  refreshes every 15 seconds
                  {readError ? " · data may be stale" : ""}
                </>
              ) : (
                "Verifying the chain, deployed contracts and token…"
              )}
            </p>
          </section>
        </div>
        <section id="how-it-works" className="rules">
          <div>
            <span className="eyebrow">The rules, in the open</span>
            <h2>
              Shared funds.
              <br />
              Clear decisions.
            </h2>
          </div>
          <ol>
            <li>
              <strong>Lock to participate</strong>
              <p>
                Every locked LVOT adds voting weight. A vote freezes your entire
                lock until the latest proposal you voted on ends. More locks do
                not change an existing vote.
              </p>
            </li>
            <li>
              <strong>Vote once, with intention</strong>
              <p>
                Voting lasts 3 days. Passing needs 1,000,000 LVOT in total votes
                and more for than against. Ties fail. Whoever locks a quorum can
                pass an unopposed proposal.
              </p>
            </li>
            <li>
              <strong>Give decisions time</strong>
              <p>
                After voting ends, passed proposals wait 1 day. Anyone can
                execute before day 15 after vote end. Funds are paid first come,
                first served; they are not reserved.
              </p>
            </li>
          </ol>
        </section>
        <details id="donate" className="donate">
          <summary>
            Fund the treasury with test ETH <span aria-hidden="true">＋</span>
          </summary>
          <p className="small muted">
            Donations cannot be withdrawn. Only passed proposals can move
            treasury ETH. The one-day delay gives visibility, not a veto.
          </p>
          <form
            onSubmit={(e) =>
              formAction(e, (form) => {
                const value = parseAmount(
                  String(form.get("donation")),
                  18,
                  "donation",
                );
                proposeReview({
                  title: `Donate ${units(value)} ETH`,
                  explanation:
                    "Send Sepolia test ETH to the shared treasury. This donation is irreversible and gives no additional voting power.",
                  functionName: "donate",
                  value,
                });
              })
            }
          >
            <label htmlFor="donation">Donation (Sepolia ETH)</label>
            <div className="row">
              <input
                id="donation"
                {...fieldAttributes("donation")}
                name="donation"
                inputMode="decimal"
                placeholder="0.01"
                required
              />
              <button disabled={!ready}>Review donation</button>
            </div>
            {fieldMessage("donation")}
            <p className="small muted">{needs}</p>
          </form>
        </details>
      </main>
      <footer>
        <div>
          <a href="#main" className="brand footer-brand">
            lockvote<span aria-hidden="true">↗</span>
          </a>
          <p className="small muted">
            An open experiment on {r.chain.name}. No owner. No admin. No
            upgrades.
          </p>
        </div>
        <div className="footer-links">
          <a
            href={`${explorer}/address/${r.treasury.address}`}
            target="_blank"
            rel="noreferrer"
          >
            Treasury contract ↗
          </a>
          <a
            href={`${explorer}/address/${r.token.address}`}
            target="_blank"
            rel="noreferrer"
          >
            Token contract ↗
          </a>
          <a href="./imd-deployment.json" target="_blank" rel="noreferrer">
            Deployment record ↗
          </a>
        </div>
      </footer>
      <dialog
        ref={dialog}
        onCancel={() => setReview(undefined)}
        onClose={() => setReview(undefined)}
        aria-labelledby="review-title"
      >
        <div className="dialog-inner">
          <p className="eyebrow">Before you sign</p>
          <h2 id="review-title">{review?.title}</h2>
          <p>{review?.explanation}</p>
          <p className="small muted">
            Network: {r.chain.name} · wallet: {wallet.address}
            <br />
            Your wallet will show the gas fee. A simulation runs before the
            signature request.
          </p>
          <div className="row actions">
            <button onClick={() => setReview(undefined)} autoFocus>
              Cancel
            </button>
            <button
              className="primary"
              disabled={!ready || !review}
              onClick={() => review && transact(review)}
            >
              Confirm in wallet
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
