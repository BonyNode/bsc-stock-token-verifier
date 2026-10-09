# Stock Token Verifier — BNB Smart Chain edition

**Which bStocks, Ondo Stocks and xStocks contracts on BNB Smart Chain are the issuers' own — and
which unlisted contracts use the same ticker.** An open-source verifier built on the Binance Web3
API, the issuers' own lists and chain state. It gives you a command-line check for one address, and
a full scan that writes a JSON snapshot. The snapshot is the primary output; its schema is in
[docs/snapshot-schema.md](docs/snapshot-schema.md). A single-file static HTML report is rendered
from it.

> Independent open-source tool. Not affiliated with, endorsed by or connected with Binance, Ondo
> Finance or Backed (xStocks). Information only, not investment advice. Nothing here is an offer or
> a recommendation to buy or sell anything.

- Zero dependencies. Node.js 20 or newer. No install step.
- `npm test` runs fully offline. The single-address check needs no key. The scan needs network,
  and a Binance Web3 API key for its keyed parts (a keyless mode exists).
- The issuers' own words are used: bStocks are certificates; xStocks are tracker certificates
  issued by Backed; Ondo Stocks are issued by Ondo Global Markets.

## Why

Anyone can deploy a BEP-20 token called "NVIDIA xStock" with the symbol `NVDAx`. On 2026-10-09 one
search for `NVDA` on chain 56 returned, besides the issuer's `NVDAx`, twelve more contracts with
exactly that symbol and that name. Names, symbols and decimals prove nothing. What does prove it:
the address is on the issuer's own list, and the contract at that address runs the issuer's code
behind the issuer's proxy.

Names are not even the hard case. 33 test contracts named "Testing … (Ondo Tokenized)" (symbols
`t-ABBVon`, `t-AMDon`, …) run byte-for-byte the same 824-byte proxy code as Ondo's tokens. Only
their beacon differs: `0xb3dc…cf64` instead of Ondo's `0xc046…3315`. The two whose creator was
looked up were created by addresses outside Ondo's deployers. A bytecode-hash check alone would
pass them.

## How to run

```sh
git clone https://github.com/BonyNode/bsc-stock-token-verifier && cd bsc-stock-token-verifier

# one address, no key needed (lists and rules come from data/snapshot.json)
node bin/stv-verify.mjs 0x02fca66c1d1afb4e2a7884261eb00f63598a7436
node bin/stv-verify.mjs 0xefe1798ac4d4e0ac5a6f145ea01956bae8103777 --json

# the full scan: snapshot + report
BINANCE_W3_ENV_FILE=/path/to/binance-web3.env node bin/stv-verify.mjs scan
node bin/stv-verify.mjs scan --no-key --no-market        # keyless mode

# re-render the report from a snapshot
node bin/stv-verify.mjs report --snapshot data/snapshot.json --out report/index.html

npm test          # offline
npm run check     # pre-publication check
```

The key file holds two lines, `BINANCE_W3_API_KEY=` and `BINANCE_W3_SECRET_KEY=`. You can also set
the two variables directly. The key is read only inside the client. It is never printed, logged or
written to the snapshot. To choose JSON-RPC endpoints, use `--rpc <url>[,<url>…]` or `STV_RPC_URLS`.

| Verdict (machine value) | Shown as | Meaning | CLI exit code |
|---|---|---|---|
| `genuine` | genuine | on the issuer's list; code hash and proxy slot fit the family rule; the creator is not another family's | 0 |
| `look-alike` | unlisted contract using the same ticker or name | on no list, but uses the exact symbol or the name marker of a listed contract. Sub-labelled from its own name and symbol: bridged copy, test contract, other issuer, or claimant not identified | 1 |
| `unknown` | unknown | in between: listed but outside the rule, or the rule fits but no list has it — with the reason | 2 |
| `none` | none | single check only: no family claim | 3 |
| — | unknown, `code_unreadable` | nothing could be read (RPC down) | 4 |

Usage errors exit 64, internal errors 70.

## Latest snapshot

[`data/snapshot.json`](data/snapshot.json) and [`report/index.html`](report/index.html) — see
`generatedAt`, `summary.measuredAt` and `sources` in the file for the exact times.

<!-- latest-snapshot:start -->
Scan of 2026-10-09 with the Binance Web3 API key, at commit `97b8f4b`. The on-chain pass finished
17:29:43 UTC (`summary.measuredAt`, block 126 675 998 at its start). The searches for unlisted
same-ticker contracts finished 17:37:02 UTC (`lookalikes.fetchedAt`). Quotes were taken
17:37:18–17:38:29 UTC, during the US regular session.

| Family | Listed on chain 56 | Genuine | Unknown | Unlisted, same ticker or name (lower bound) |
|---|---|---|---|---|
| bStocks | 91 | 91 | 0 | ≥ 651 |
| Ondo Stocks | 459 | 450 (333 stocks, 117 ETFs) | 9: 7 portfolio tokens on a second beacon and 2 dollar tokens (USDon, USDY) | ≥ 1 113 |
| xStocks | 2 638 (1 319 tokens + 1 319 v2 wrappers) | 2 638 | 0 | ≥ 489 |

The 2 253 unlisted same-ticker contracts, by what their own names say: 28 bridged copies, 33 test
contracts, 42 naming another issuer, and 2 150 not identified. They were found by 782 searches,
164 of which returned a full page.

The market sample takes the same ten tickers in each family and quotes USDT → token. Each cost is
measured against the Binance token price of the same run:

- **bStocks:** within +0.6 % at 20, 100 and 1 000 USD for all ten.
- **Ondo:** within 1.4 % at 20 USD for 8 of 10. COINon was refused (40374). 9 of the 30 cells are
  marked "quote not representative" — mostly at 1 000 USD, and every size for MSFTon (see the
  report and `docs/devex-observations.md`).
- **xStocks:** every quote was refused — 40374 for the tokens, 40441 ("no valid quote from any
  vendor") for the v2 wrappers.
<!-- latest-snapshot:end -->

## How a contract is judged

A contract is **genuine** when all of these hold:

1. **Issuer list.** The address is in the family's list:
   - xStocks: the xStocks public API (`api.xstocks.fi`), BinanceSmartChain deployments — the token
     and its ERC-4626 v2 wrapper;
   - Ondo: the token CSV linked from `docs.ondo.finance/addresses`;
   - bStocks: Binance's own bStocks list, since bStocks have no separate issuer registry.
2. **Code hash.** `keccak256(eth_getCode)` equals the code hash shared by the issuer-listed
   contracts of that family and role.
3. **Proxy slot.** The EIP-1967 `beacon` slot (beacon proxies: bStocks, Ondo) or `admin` slot
   (transparent proxies: xStocks token and wrapper) equals the one they share. Proxy bytecode is
   generic — anyone can deploy the same bytes — so it is the slot that names the issuer's beacon or
   admin.
4. **Creator.** Where checked, the creator reported by the Binance Web3 API (`token/basic-info`)
   is not a known creator of *another* family. The creator is a cross-check, reported next to the
   verdict, and is built from the same contracts the rule fits. Ondo used six deployers on
   2026-10-09. A creator that is missing, or simply not among the family's known creators, is
   recorded as a reason and does not change the verdict.

The rules are not typed in. The scan **derives** them from the issuer-listed contracts on chain:
first the dominant code hash per family and role, then the beacon or admin shared by more than half
of those contracts. A listed contract that does not fit is reported as **unknown** with its reason,
never forced to either side. The implementation slot is reported, not required: an issuer may
upgrade tokens one by one.

An **unlisted contract using the same ticker or name** is on no list and makes the claim on chain,
in one of two ways:
- its own `name()` carries the family marker (`xStock`, `(Ondo Tokenized)`);
- its `symbol()` is exactly the symbol of a listed contract (case included), and its name backs
  it: it repeats the symbol, or shares a distinctive word with the listed contract's name.

What it is is read only from its own name and symbol: a bridged copy (Wormhole and the like), a
test contract, another issuer, or not identified. This describes a claim, not an intent. A shared
ticker alone (`NVDA`) is not a claim. The count is a lower bound: each search returns at most one
page of 50.

## Binance Web3 API integration

The base URL is `https://web3.binance.com/build`, and every request is signed:
`X-OC-SIGN = Base64(HMAC-SHA256(timestamp + METHOD + requestPath + body))`. The `requestPath`
includes the `/build` prefix and the exact query string; `X-OC-TIMESTAMP` is ISO 8601 with
milliseconds.

| Endpoint | Used for |
|---|---|
| `GET /api/v1/dex/market/rwa/platforms` | how many bStocks and Ondo tokens Binance counts on chain 56 |
| `GET /api/v1/dex/market/rwa/tokens` (`platformId` bstock, ondo) | the Binance RWA lists, market status per token, `tokenToShareRatio` |
| `GET /api/v1/dex/market/rwa/price` | on-chain token price and Binance reference price (batches of 50) |
| `POST /api/v1/dex/market/token/basic-info` | contract creator, one address per request |
| `GET /api/v1/dex/market/token/search` | the same-ticker search, one query per underlying ticker |
| `GET /api/v1/dex/market/token/top-liquidity` | pools of sampled genuine contracts |
| `GET /api/v1/dex/aggregator/quote` | USDT → token quotes at $20 / $100 / $1,000 |

**Pace.** At least 250 ms between requests to one endpoint, and 60 ms between any two. The limits
are 5 per second per endpoint and 1 200 per minute. HTTP 429 is retried after `Retry-After`.

**Errors.** Codes 40101, 40102 and 40104 stop the keyed part at once and say why. An RFQ refusal
(40367, 40368, 40369, 40374, 40375) or "no valid quote from any vendor" (40441) is recorded as a
fact about the market at that moment. An answer without the fields the code relies on is a schema
error, never an empty success.

**Keyless endpoints.** The keyless Binance endpoints documented in Binance's skills repository
(`github.com/binance/binance-skills-hub`) serve as a cross-check and for the keyless mode. Their
data always carries its own source ids.

**Quotes.** Each successful quote is compared with the token price of the same run. A quote 5 % or
more away from that price is marked `representative: false` and shown as "quote not
representative". On 2026-10-09 such quotes came from routes through thin or mispriced pools, found
for a placeholder wallet. Ondo's RFQ quotes need a user wallet, which this tool does not have. The
raw answer stays in the snapshot.

**`referencePrice`.** Binance documents it as a per-share figure converted from the on-chain token
price, not an official quote. Measured over 488 rows, `tokenPrice ÷ referencePrice` equals
`tokenToShareRatio` in every row. So it is shown next to the token price, never as the price of the
share.

Frictions met while building it — exact requests, codes and times — are logged in
[docs/devex-observations.md](docs/devex-observations.md).

## Before and after

**Before.** This repository started on 2026-09-27 (commit `cda3767`) as the Robinhood Chain
edition: one chain (4663) and one issuer. It held a registry of 194 Stock Tokens selected by one
bytecode hash and one creator, a CLI, a small library and a read-only HTTP API.

**After.** The BNB Smart Chain edition, built from 2026-10-09:

- **Kept:**
  - the zero-dependency design and Keccak-256;
  - the batched JSON-RPC client with failover and `assertChainId` (now `0x38`);
  - the rule "a symbol proves nothing, the address and the code do";
  - the honest-failure discipline: a dead source is never an empty success;
  - the pre-publication check.
- **Replaced:**
  - one hard-coded hash and creator → rules derived per issuer family and role from the issuers'
    own lists;
  - a fixed registry file → a scan that rebuilds the lists on every run;
  - the verdict set → genuine, unlisted same-ticker, unknown and none, with machine-readable reasons.
- **New:**
  - the Binance Web3 API client: signing, pacing, 429 handling, explicit errors;
  - the xStocks and Ondo list readers;
  - the same-ticker search;
  - the market sample: pools and aggregator quotes, with a representativeness flag;
  - the token-price vs reference-price comparison;
  - the snapshot schema and its validator;
  - the static HTML report;
  - a resumable on-chain fact cache.
- **Dropped:** from the Robinhood Chain edition, the HTTP API server, the ERC-8056 multiplier
  helpers and its chain-specific naming rules.

## Data sources

- BNB Smart Chain public JSON-RPC: `eth_getCode`, `eth_getStorageAt`, `eth_call`;
- the Binance Web3 API;
- Binance's keyless wallet endpoints;
- `api.xstocks.fi`;
- the Ondo token CSV.

The snapshot's `sources` lists every source with its endpoint, request count, status and read time.
See [DATA.md](DATA.md) for the terms that apply to the data in this repository.

## Limitations

- **Lists change.** They are what the issuers and Binance publish at scan time. A token added later
  shows as `unknown` (fingerprint without listing) until the next scan. The xStocks list grew from
  1 272 to 1 319 assets within one hour on 2026-10-09.
- **Binance's keyed list is short.** `rwa/tokens` returned 46 of the 91 bStocks and 442 of the 458
  Ondo tokens that `rwa/platforms` counts. The complete keyless list defines bStocks membership.
- **xStocks addresses repeat across networks.** The xStocks API lists the same addresses for every
  EVM network; the scan checks each one on chain 56.
- **Creators are partial for xStocks.** They are read for every bStocks and Ondo contract. For
  xStocks they are read only for the contracts Binance lists and their pairs, because
  `basic-info` takes one address per request. The other xStocks contracts carry
  `creator_not_checked`.
- **Same-ticker counts are lower bounds.** One page of 50 per search, and only the queries listed
  in the method.
- **Quotes are a sample.** They are taken once, at the time shown, for a placeholder wallet. RFQ
  availability depends on market hours and on the wallet.
- **Identity only.** A verdict is about the identity of a contract: nothing about price, liquidity,
  backing or redemption. No warranty.

## License

Code: [Apache License, Version 2.0](LICENSE). Data: see [DATA.md](DATA.md) and [NOTICE](NOTICE).
Copyright 2026 The BonyNode Authors.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Before a pull request: `npm test` and `npm run check`.
