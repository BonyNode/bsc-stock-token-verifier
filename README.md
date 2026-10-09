# Stock Token Verifier — BNB Smart Chain edition

**Which bStocks, Ondo Stocks and xStocks contracts on BNB Smart Chain are genuine, and which only
look like them.** An open-source verifier built on the Binance Web3 API, the issuers' own lists and
chain state: a command-line check for one address, a full scan that writes a JSON snapshot (the
primary output, schema in [docs/snapshot-schema.md](docs/snapshot-schema.md)), and a single-file
static HTML report rendered from it.

Independent open-source tool. Not affiliated with, endorsed by or connected with Binance, Ondo
Finance or Backed (xStocks). Information only, not investment advice.

- Zero dependencies. Node.js 20 or newer. No install step.
- `npm test` runs fully offline; the scan needs network, and a Binance Web3 API key for its keyed
  parts. The single-address check needs no key.
- The issuers' own words are used: bStocks are certificates; xStocks are tracker certificates
  issued by Backed; Ondo Stocks are issued by Ondo Global Markets.

## Why

Anyone can deploy a BEP-20 token called "NVIDIA xStock" with the symbol `NVDAx`. On 2026-10-09 one
search for `NVDA` on chain 56 returned, besides the issuer's `NVDAx`, twelve more contracts with
exactly that symbol and that name. Names, symbols and decimals prove nothing. What does: the address
is on the issuer's own list, and the contract at that address runs the issuer's code behind the
issuer's proxy.

Names are not even the hard case. 33 contracts named "Testing … (Ondo Tokenized)" (symbols
`t-ABBVon`, `t-AMDon`, …) run byte-for-byte the same 824-byte proxy code as Ondo's tokens; only
their beacon differs (`0xb3dc…cf64` instead of Ondo's `0xc046…3315`), and the two whose creator
was looked up were created by addresses outside Ondo's deployers. A bytecode-hash check alone
would pass them.

## Latest snapshot

[`data/snapshot.json`](data/snapshot.json) (schema `stv-bsc-snapshot/1`) and the report
[`report/index.html`](report/index.html), scan of 2026-10-09 with the Binance Web3 API key:
on-chain pass finished 17:04:00 UTC (`summary.measuredAt`, block 126 672 570 at its start),
look-alike searches finished 17:11:15 UTC (`lookalikes.fetchedAt`), quotes 17:11:27–17:12:40 UTC
during the US regular session, snapshot written 17:12:40 UTC.

| Family | Listed on chain 56 | Genuine | Unknown | Look-alikes found (lower bound) |
|---|---|---|---|---|
| bStocks | 91 | 91 | 0 | ≥ 653 |
| Ondo Stocks | 459 | 450 (333 stocks, 117 ETFs) | 9: 7 portfolio tokens on a second beacon and 2 dollar tokens (USDon, USDY) | ≥ 1 114 |
| xStocks | 2 638 (1 319 tokens + 1 319 v2 wrappers) | 2 638 | 0 | ≥ 488 |

782 searches, 164 of them returned a full page. Market sample (USDT → token, the same ten tickers
in each family), cost against the Binance token price of the same run:

- bStocks: +0.0 % to +0.2 % at 20, 100 and 1 000 USD for all ten;
- Ondo: within 1.2 % at 20 USD for 8 of 10, but +9 % to +1 337 % at 1 000 USD for GOOGLon,
  TSLAon, AMZNon, QQQon and SPYon, a route at millions of percent for MSFTon, and COINon refused
  (40374);
- xStocks: every quote refused — 40374 for the tokens, 40441 ("no valid quote from any vendor")
  for the v2 wrappers.

Every number in the snapshot carries its source and read time (`sources`, and `fetchedAt` per
section).

## How a contract is judged

A contract is **genuine** when all of these hold:

1. **Issuer list** — the address is in the family's list: the xStocks public API
   (`api.xstocks.fi`, BinanceSmartChain deployments: the token and its ERC-4626 v2 wrapper), the
   Ondo token CSV linked from `docs.ondo.finance/addresses`, or — bStocks have no separate issuer
   registry — Binance's own bStocks list.
2. **Code hash** — `keccak256(eth_getCode)` equals the code hash shared by the issuer-listed
   contracts of that family and role.
3. **Proxy slot** — the EIP-1967 `beacon` (beacon proxies: bStocks, Ondo) or `admin` (transparent
   proxies: xStocks token and wrapper) slot equals the one they share. Proxy bytecode is generic —
   anyone can deploy the same bytes — the slot names the issuer's beacon or admin.
4. **Creator** — where checked, the contract creator reported by the Binance Web3 API
   (`token/basic-info`) is one of the addresses that created contracts fitting the rule.

The rules are not typed in: the scan **derives** them from the issuer-listed contracts on chain (the
dominant code hash per family and role, then the beacon/admin shared by more than half of them). A
listed contract that does not fit is reported as **unknown** with its reason, never forced to either
side. The implementation slot is reported, not required: an issuer may upgrade tokens one by one.

A **look-alike** is on no list and claims a family on chain: its own `name()` carries the family
marker (`xStock`, `(Ondo Tokenized)`), or its `symbol()` is exactly the symbol of a genuine contract
(case included) and its name backs it (repeats the symbol, or shares a distinctive word with the
genuine contract's name). A shared ticker alone (`NVDA`) is not a claim. The look-alike count is a
lower bound: each search returns at most one page of 50.

| Verdict | Meaning | CLI exit code |
|---|---|---|
| `genuine` | on the issuer list, code hash and proxy slot fit the family rule (creator, when checked, too) | 0 |
| `look-alike` | on no list, copies the family's name marker or a genuine symbol | 1 |
| `unknown` | in between: listed but outside the rule, or the rule fits but no list has it — with the reason | 2 |
| `none` | single check only: no family claim | 3 |
| — | nothing could be read (RPC down): `unknown` with `code_unreadable` | 4 |

Usage errors exit 64, internal errors 70.

## Quick start

```sh
git clone https://github.com/BonyNode/stock-token-verifier && cd stock-token-verifier

# one address, no key needed (lists and rules come from data/snapshot.json)
node bin/stv-verify.mjs 0x02fca66c1d1afb4e2a7884261eb00f63598a7436
node bin/stv-verify.mjs 0xefe1798ac4d4e0ac5a6f145ea01956bae8103777 --json

# the full scan: snapshot + report (Binance Web3 API key optional; without it the keyed parts are skipped)
BINANCE_W3_ENV_FILE=/path/to/binance-web3.env node bin/stv-verify.mjs scan
node bin/stv-verify.mjs scan --no-key --no-market        # keyless mode

# re-render the report from a snapshot
node bin/stv-verify.mjs report --snapshot data/snapshot.json --out report/index.html
```

The key file holds two lines, `BINANCE_W3_API_KEY=` and `BINANCE_W3_SECRET_KEY=`; the variables can
also be set directly. The key is read only inside the client and never printed, logged or written to
the snapshot. `--rpc <url>[,<url>…]` or `STV_RPC_URLS` choose the JSON-RPC endpoints.

## Binance Web3 API integration

Base `https://web3.binance.com/build`; every request is signed:
`X-OC-SIGN = Base64(HMAC-SHA256(timestamp + METHOD + requestPath + body))` with the `/build` prefix
and the exact query string in `requestPath`, `X-OC-TIMESTAMP` in ISO 8601 with milliseconds.

| Endpoint | Used for |
|---|---|
| `GET /api/v1/dex/market/rwa/platforms` | how many bStocks and Ondo tokens Binance counts on chain 56 |
| `GET /api/v1/dex/market/rwa/tokens` (`platformId` bstock, ondo) | the Binance RWA lists, market status per token, `tokenToShareRatio` |
| `GET /api/v1/dex/market/rwa/price` | on-chain token price and Binance reference price (batches of 100) |
| `POST /api/v1/dex/market/token/basic-info` | contract creator, one address per request |
| `GET /api/v1/dex/market/token/search` | look-alike search, one query per underlying ticker |
| `GET /api/v1/dex/market/token/top-liquidity` | deepest pools of sampled genuine contracts |
| `GET /api/v1/dex/aggregator/quote` | USDT → token quotes at $20 / $100 / $1,000; RFQ refusals recorded as data |

Pace: at least 250 ms between requests to one endpoint and 60 ms between any two (limits: 5 per
second per endpoint, 1 200 per minute). HTTP 429 is retried after `Retry-After`. 40101/40102/40104
stop the keyed part at once and say why; an RFQ refusal (40367, 40368, 40369, 40374, 40375) is a
fact about the market at that moment. An answer without the fields the code relies on is a schema
error, never an empty success. Keyless Binance endpoints documented in Binance's skills repository
(`github.com/binance/binance-skills-hub`) are used as a cross-check and for the keyless mode, always
under their own source ids.

`referencePrice`: Binance documents it as a per-share figure converted from the on-chain token price,
not an official quote. Measured on 2026-10-09 over 488 rows, `tokenPrice ÷ referencePrice` equals
`tokenToShareRatio` in every row: it is shown next to the token price, never as the price of the share.

Frictions met while building it — exact requests, codes and times — are logged in
[docs/devex-observations.md](docs/devex-observations.md).

## Before and after

This repository started on 2026-09-27 (commit `cda3767`) as the Robinhood Chain edition: one chain
(4663), one issuer, a registry of 194 Stock Tokens selected by one bytecode hash and one creator, a
CLI, a small library and a read-only HTTP API.

The BNB Smart Chain edition (from 2026-10-09):

- **Kept:** the zero-dependency design, Keccak-256, the batched JSON-RPC client with failover and
  `assertChainId` (now `0x38`), the rule "a symbol proves nothing, the address and the code do", the
  honest-failure discipline (a dead source is never an empty success), the pre-publication check.
- **Replaced:** one hard-coded hash and creator → rules derived per issuer family and role from the
  issuers' own lists; a fixed registry file → a scan that rebuilds the lists every run; the verdict
  set → `genuine / look-alike / unknown / none` with machine-readable reasons.
- **New:** the Binance Web3 API client (signing, pacing, 429 handling, explicit errors), the
  xStocks and Ondo list readers, the look-alike scan, the market sample (pools and aggregator
  quotes), the token-price vs reference-price comparison, the snapshot schema and validator, the
  static HTML report, a resumable on-chain fact cache.
- **Dropped:** the HTTP API server and the ERC-8056 multiplier helpers of the Robinhood Chain
  edition, and its chain-specific naming rules.

## Limitations

- Lists are what the issuers and Binance publish at scan time; a token added later shows as
  `unknown` (fingerprint without listing) until the next scan.
- The xStocks API lists the same addresses for every EVM network; the scan checks each on chain 56.
- Creators are read for every bStocks and Ondo contract and for the xStocks contracts Binance lists
  (and their pairs) — `basic-info` takes one address per request. Other xStocks contracts carry
  `creator_not_checked`.
- Look-alike counts are lower bounds (one page of 50 per search, only the queries in the method).
- Quotes are a sample, taken once, at the time shown; RFQ availability depends on market hours.
- A verdict is about the identity of a contract only: nothing about price, liquidity, backing or
  redemption. No warranty.

## Data sources

BNB Smart Chain public JSON-RPC (`eth_getCode`, `eth_getStorageAt`, `eth_call`); the Binance Web3
API; Binance's keyless wallet endpoints; `api.xstocks.fi`; the Ondo token CSV. Every source, its
endpoint, request count, status and read time is listed in the snapshot's `sources`. See
[DATA.md](DATA.md) for the terms that apply to the data in this repository.

## License

Code: [Apache License, Version 2.0](LICENSE). Data: see [DATA.md](DATA.md) and [NOTICE](NOTICE).
Copyright 2026 The BonyNode Authors.
