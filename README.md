# X PrimeFlow Stock Token Verifier — Powered by Robinhood Chain

An open-source module of X PrimeFlow (https://xprimeflow.trade), built by BonyNode

This project is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc.

Is this contract a real Stock Token? This package answers from chain state alone: a registry of the
**194 genuine Stock Tokens** on Robinhood Chain (chain id 4663, snapshot of 2026-09-20), the rule that
separated them from **92 look-alikes**, a command-line verifier, a small library and a read-only HTTP API.

Robinhood publishes the official list of its contracts at
**https://docs.robinhood.com/chain/contracts**, generated live from the on-chain asset registry.
That list is the reference. This package is an independent re-check from chain state: it does not
read the list or the asset registry contract, and reaches its own set from bytecode and creator
tests — useful when an address reaches you through a wallet, a pool or a message and you want an
answer that does not depend on a web page. A disagreement between the two is worth reporting.

- Zero dependencies. Node.js 20 or newer. No install step.
- `npm test` runs fully offline; live checks against the chain are opt-in.
- The same rule powers the Robinhood Chain showcase of X PrimeFlow: **https://xprimeflow.trade/robinhood-chain**

## Why this exists

Anyone can deploy an ERC-20 called "NVIDIA • Robinhood Token" with the symbol `NVDA`. On 2026-09-20
the chain explorer (https://robinhoodchain.blockscout.com) listed **286** contracts whose names end in
"Robinhood Token". **194** of them are Stock Tokens by the tests in
[How the registry was built](#how-the-registry-was-built), run on the same day. **92** are not — among
them a rival `NVDA`, a rival `GME` and a second `LULU`.

Nothing in a counterfeit's symbol, name or decimals gives it away, and interface checks are not
enough either: the counterfeit `LULU` at `0x9b6cc37b76037d3bfb55aebd5f5d210a82e6a85a` implements
the ERC-8056 `uiMultiplier()` and answers exactly 1.0. Only its bytecode differs.

The reverse holds as well: a ticker or a working multiplier does not make a contract a counterfeit.
Tickers are not unique, and ERC-8056 is a public draft ERC anyone may implement — a token "Frog"
with the symbol `F` is not a fake Ford. Only a contract that calls itself a Stock Token is judged as
one.

## How a contract is checked

At check time the verifier reads, in one JSON-RPC batch at the latest block:

| Fact | Call | Why |
|---|---|---|
| chain id | `eth_chainId` | must be `0x1237` (4663); an endpoint of another chain would describe another chain |
| bytecode hash | `keccak256(eth_getCode)` | Stock Tokens are beacon proxies with the beacon address embedded in their runtime code, so all 194 share one hash: `0x6c1fdd40…acd65630` |
| multiplier | `uiMultiplier()` | the live corporate-action multiplier (the call reverts on many counterfeits) |
| symbol, name | `symbol()`, `name()` | what the contract claims to be |

and then looks the address up in the registry snapshot. The verdict:

| Verdict | Meaning | CLI exit code |
|---|---|---|
| `authentic` | listed in the registry **and** the live bytecode matches the reference hash | 0 |
| `counterfeit` | the contract calls itself a Stock Token — its own `name()` ends in "Robinhood Token" — but has neither the reference bytecode nor a place in the registry; or a registry address whose live bytecode differs from the reference. The address of the genuine token with the same ticker is given when there is one | 1 |
| `unlisted` | reference bytecode, but not in the snapshot. Identical runtime bytes can be deployed by anyone, so this is not "authentic"; the issuer also adds Stock Tokens over time, so it is not "counterfeit" either | 2 |
| `none` | the contract does not call itself a Stock Token. A ticker shared with a listed Stock Token or a working ERC-8056 multiplier alone is not a claim: the shared ticker is reported as `sharesTickerWith`, the multiplier as `multiplierAnswered` | 3 |
| `unreadable` | the bytecode could not be read, so nothing was checked — a dead RPC never produces a clean verdict. A registry address that answers no bytecode at all (a node behind the deployment block, or pruned) is `unreadable` too, with the reason `code_empty` — never `counterfeit` | 4 |

The CLI exits 64 on a usage error and 70 on an internal error; exit code 1 means `counterfeit` and
nothing else.

With `--deployer` (API: `?deployer=1`) the contract creator is also read from the chain explorer
and reported next to the verdict. It never changes the verdict: for a listed address the creator is
already part of the snapshot, and for an unlisted one it is the second test a registry rebuild applies.

### How the registry was built

The candidates are the tokens whose names end in "Robinhood Token" in the token list of the chain
explorer, https://robinhoodchain.blockscout.com — 286 on 2026-09-20. Every count below was measured on
that day: tests 1 and 2 over the public JSON-RPC of Robinhood Chain at the latest block, test 3
through the explorer API (Blockscout v2). Each candidate went through:

1. **Interface:** `decimals()` is 18 and `uiMultiplier()` answers — 202 of 286 passed. On WETH and
   USDG of the same chain the multiplier call reverts, so the test does discriminate.
2. **Bytecode:** `keccak256(eth_getCode)` equals the reference hash — 194 of the 202 passed.
3. **Creator (independent cross-check):** the creator of each of the 202, looked up in the chain
   explorer. All 194 share one creator (`0x4783c67b63de2b358ac5951a7d41f47a38f3c046`); the 8
   rejected have five other creators among them.

Tests 2 and 3 split the 202 identically, with zero disagreement. The 194 carry 194 distinct symbols.

### What you can reproduce, and how

- **The bytecode test — anyone, over any RPC, at the latest block, any time after the snapshot.**
  `npm run recheck` re-reads the bytecode of all 194 addresses and compares the hashes
  (26 paced requests). On 2026-09-27 it reported 194 of 194 matching.
- **The creator test — through the explorer.** This package reads contract creators from the
  explorer API (Blockscout v2). `node scripts/rebuild-registry.mjs --rebuild` repeats the whole
  selection against it and prints the split, any disagreement between tests 2 and 3, and the
  difference from the shipped snapshot; `--out <file>` writes a new snapshot. Some networks receive
  a browser challenge instead of JSON from the explorer; the script then stops and says so.
- **The whole set — against the issuer's list.** The official list at
  https://docs.robinhood.com/chain/contracts is generated from the on-chain asset registry; compare
  the snapshot with it after any rebuild.

## Quick start

```sh
git clone https://github.com/BonyNode/stock-token-verifier && cd stock-token-verifier
node bin/stv-verify.mjs 0x1076f47f9632d726cf0ff93ad1616c45cbb8b94d
```

```
0x1076f47f9632d726cf0ff93ad1616c45cbb8b94d on Robinhood Chain (4663), block 73590409
Verdict: COUNTERFEIT — claims to be NVDA (NVIDIA • Robinhood Token), but is not a Robinhood Stock Token
  name            NVIDIA • Robinhood Token
  bytecode hash   0xb3e93523522c7151dcb0c2ad7022221cb56e7dbc8c7a304c0cc71d8e948f09e8 differs from the reference 0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630
  registry        not listed
  uiMultiplier    no answer (the call reverts)
  creator         not checked (pass --deployer; needs access to the chain explorer)
  genuine token   the real NVDA lives at 0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec
```

Options: `--json` prints the full result; `--deployer` adds the explorer lookup (`--explorer <url>`
for another Blockscout instance); `--rpc <url>[,<url>…]` chooses the endpoints; `--help` lists the
options and exit codes. Without `--rpc`, the endpoints in `STV_RPC_URLS` (comma-separated) are tried
first and two third-party public endpoints after them. The official Robinhood Chain Public RPC
(`https://rpc.mainnet.chain.robinhood.com`) is not a default: the Robinhood Chain Terms of Service
(§2.4) state that "you will use the Services solely for lawful testing, experimentation, evaluation,
and development purposes". Add it through `STV_RPC_URLS` only for such use, and bring your own
provider for anything else.

## Library

```js
import { verifyAddress, stockTokenVerdict, stockTokenByAddress, sharePriceFromTokenPrice } from './src/index.js';

const result = await verifyAddress('0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec');
result.verdict;       // 'authentic'
result.multiplierRaw; // '1000775159164630595' at the time of writing, i.e. 1.000775…
```

`stockTokenVerdict()` is pure: pass facts you read yourself (bytecode hash, multiplier, symbol,
name) and it returns the verdict with exactly the facts it was derived from.

## Read-only API

```sh
npm run serve        # PORT=8787 HOST=127.0.0.1 by default
```

| Route | Returns |
|---|---|
| `GET /api/public/robinhood-chain` | module catalogue |
| `GET /api/public/robinhood-chain/stock-tokens` | the 194 Stock Tokens with their live multipliers and the authenticity rule. The live showcase serves the same path; its answer carries extra freshness fields |
| `GET /api/public/robinhood-chain/verify/:address` | the verdict for one contract; `?deployer=1` adds the creator lookup |

Every successful answer is an envelope `{ ok, source, chain, section, asOf, partial, failed, data, ts }`.
A failing upstream answers **HTTP 503 with the reason**, never HTTP 200 with an invented empty set;
unread multipliers make the answer `partial` and are named in `failed`. No key, CORS open, GET/HEAD
only, 60 requests per minute per IP (30 on the two heavy routes; behind your own reverse proxy,
`TRUST_PROXY=1` takes the client from the rightmost `X-Forwarded-For` entry). Results are cached
for five minutes; the registry is read in batches of 8 calls with a pause between batches, below
the public node's limits, and nothing in this package uses `eth_getLogs`.

The verify answer does not name the upstream RPC endpoint, and URLs in error reasons are cut to
their scheme and host — in the API, the CLI and the library alike: a provider URL can carry a key or
a login and password. The CLI and the library keep the full URL of the endpoint that answered in `rpc`.

Responses captured from the public chain on 2026-09-27 are in [`examples/`](examples/), with their
captured values, reshaped by hand to the current response format (`stock-tokens.json` has its
`tokens` array cut to five rows).

## Share price and the multiplier

Stock Tokens never rebase. Dividends and splits are expressed by the ERC-8056 multiplier
`uiMultiplier()` (18 decimals, `1e18` = 1.0). Two prices must not be confused:

- the **token price** — what an oracle or an on-chain swap reports; the multiplier is already inside it;
- the **share price** — what one underlying share costs: `token price ÷ uiMultiplier`.

Dividing is correct; multiplying would count the dividend twice. At today's multipliers
(1.0 to 1.0051) both mistakes look like slippage, which is why the direction is pinned by tests.

## Limitations

- The registry is a snapshot of 2026-09-20. New Stock Tokens show as `unlisted` until the registry
  is rebuilt.
- The creator test needs the explorer, which may challenge automated clients on some networks.
- Multipliers are live values at the latest block; no history is collected.
- A verdict is about the identity of a contract, nothing more. It says nothing about price,
  liquidity or the backing of the asset, and it is not financial advice. No warranty.
- Nothing is read from the issuer's off-chain services, including its official list: every fact
  comes from chain state (and, optionally, the explorer).

## Data, terms and names

The snapshot and the example responses are public chain state, published so that anyone can check
the verdicts — for verification and display, not for resale; the `/stock-tokens` answer carries
`resaleOk: false`. See [DATA.md](DATA.md) for the origin of the data, the terms that apply to it and
how this project names things.

This project is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc.

## License

Everything in this repository is licensed under the [Apache License, Version 2.0](LICENSE), except
the data listed in [DATA.md](DATA.md); see also [NOTICE](NOTICE). Copyright 2026 The BonyNode Authors.

The data — `data/`, `examples/`, `test/fixtures/` and the reference values in `src/registry.js` —
is published for verification and display under the terms in [DATA.md](DATA.md) and may be
redistributed unmodified together with the code for those purposes; the Apache License does not
extend to it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Before a pull request: `npm test` and `npm run check`.
