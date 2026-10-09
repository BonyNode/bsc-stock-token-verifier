# Snapshot schema `stv-bsc-snapshot/1`

The JSON snapshot is the primary output of this package. `node bin/stv-verify.mjs scan` writes it
(default path `data/snapshot.json`); the HTML report and any other page are rendered from it.
`src/schema.js` holds the constants below and `validateSnapshot()`, which the scan runs before it
writes a file: a snapshot that does not match this document is never written.

## Stability

- The identifier `schema` is `"stv-bsc-snapshot/1"`. Within `/1` changes are additive only: a new
  optional field, a new reason code, a new source id. Nothing is renamed, removed or retyped.
- A breaking change gets a new identifier (`/2`) and a new section in this document.
- Consumers must ignore fields they do not know.

## Conventions

| What | Form |
|---|---|
| addresses | lowercase `0x` + 40 hex digits |
| timestamps | ISO 8601 UTC with milliseconds, e.g. `"2026-10-09T16:05:01.123Z"`. Upstream epoch values are converted to this form; a field ending in `At` is always a timestamp |
| values copied from an upstream API | kept exactly as the upstream sent them, usually a decimal **string** (`"229.68861013350693"`). Never rounded |
| values computed here | JSON **numbers**; the unit is in the field name (`Usd`, `Pct`) |
| unknown or not measured | `null`, never `0` or `""` |
| text from contracts | `name()` / `symbol()` as the contract answers them. Non-ASCII characters are written as `\uXXXX` escapes (valid JSON; any parser restores them) |

Every section carries `status` and the `source` id(s) and `fetchedAt` of the data in it.
`status` is one of:

| status | meaning |
|---|---|
| `ok` | every request of the section answered |
| `partial` | some requests failed; the failures are listed in the section (`errors`) and the items they affect carry `null` |
| `skipped` | not run; `reason` says why (`no_api_key`, `disabled`, `out_of_scope`) |
| `failed` | the source did not answer at all; `error` says why. A failed section never contains invented items |

## Top level

| Field | Type | Content |
|---|---|---|
| `schema` | string | `"stv-bsc-snapshot/1"` |
| `generatedAt` | timestamp | when the file was written |
| `generator` | object | `{ name: "stock-token-verifier", version, gitCommit }` (`gitCommit` string or `null`) |
| `chain` | object | `{ id: 56, idHex: "0x38", name: "BNB Smart Chain", block, rpcHosts }`. `block`: the block number at the start of the on-chain pass; `rpcHosts`: host names only, never a path or query |
| `notices` | object | `{ affiliation, advice, referencePrice, lookalikeCounts }` — fixed sentences a page must show next to the data (see below) |
| `sources` | Source[] | every upstream that was asked, with what came back |
| `families` | object | `{ bstocks: Family, ondo: Family, xstocks: Family }` |
| `tokens` | Token[] | every address on chain 56 that an issuer list or a Binance list puts in one of the three families |
| `lookalikes` | Lookalikes | contracts that claim a family identity on chain but are not genuine |
| `market` | Market | sampled market reality: status, pools, aggregator quotes |
| `prices` | Prices | on-chain token price against the Binance reference price |
| `summary` | Summary | the counts, per family |

`notices` (exact wording is set in `src/schema.js`):
- `affiliation` — not affiliated with Binance, Ondo or Backed;
- `advice` — information only, not investment advice;
- `referencePrice` — Binance's `referencePrice` is a per-share figure converted from the on-chain token price, not an official quote;
- `lookalikeCounts` — look-alike counts are lower bounds (the search returns at most one page per query).

## Source

| Field | Type | Content |
|---|---|---|
| `id` | string | one of the ids below |
| `surface` | string | `binance-web3-api` (keyed API at `https://web3.binance.com/build`), `binance-public` (keyless endpoints documented in `github.com/binance/binance-skills-hub`), `issuer` (Ondo, Backed), `chain` (BSC JSON-RPC) |
| `url` | string | endpoint without query string; never a signature, key or header value |
| `status` | string | as above |
| `fetchedAt` | timestamp \| null | when the last request of this source completed |
| `requests` | integer | HTTP requests made to this source during the run |
| `note` | string \| null | e.g. `"13 pages of 100"` |
| `error` | string \| null | first failure, URLs cut to scheme and host |

Source ids:

| id | surface | what |
|---|---|---|
| `bsc-rpc` | chain | `eth_getCode`, `eth_getStorageAt`, `eth_call` on chain 56 |
| `xstocks-api` | issuer | `https://api.xstocks.fi/api/v2/public/assets` (all pages; BSC deployments) |
| `xstocks-price` | issuer | `https://api.xstocks.fi/api/v2/public/assets/{symbol}/price-data` (token quote, no timestamp) |
| `ondo-csv` | issuer | the token CSV linked from `https://docs.ondo.finance/addresses` |
| `binance-w3:rwa-tokens` | binance-web3-api | `GET /api/v1/dex/market/rwa/tokens` (platformId `bstock` and `ondo`) |
| `binance-w3:rwa-price` | binance-web3-api | `GET /api/v1/dex/market/rwa/price` |
| `binance-w3:basic-info` | binance-web3-api | `POST /api/v1/dex/market/token/basic-info` (creator) |
| `binance-w3:token-search` | binance-web3-api | `GET /api/v1/dex/market/token/search` |
| `binance-w3:top-liquidity` | binance-web3-api | `GET /api/v1/dex/market/token/top-liquidity` |
| `binance-w3:quote` | binance-web3-api | `GET /api/v1/dex/aggregator/quote` |
| `binance-public:stock-list` | binance-public | `GET /bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai` |
| `binance-public:market-status` | binance-public | `GET …/market/token/rwa/market/status/ai` |
| `binance-public:token-search` | binance-public | `GET /bapi/defi/v5/public/wallet-direct/buw/wallet/market/token/search/ai` |

## Family

| Field | Type | Content |
|---|---|---|
| `id` | string | `bstocks`, `ondo`, `xstocks` |
| `label` | string | `bStocks`, `Ondo Stocks`, `xStocks` |
| `wording` | string | the issuer's own term: bStocks are certificates, xStocks are tracker certificates, Ondo Stocks |
| `issuerList` | string | source id that defines membership: `ondo-csv`, `xstocks-api`; for bStocks `binance-w3:rwa-tokens`, or `binance-public:stock-list` when the run had no API key (no separate issuer registry for bStocks was found) |
| `crossChecks` | string[] | other source ids that list the family |
| `claimMarkers` | object | what makes a contract claim this family on chain: `{ symbolPattern, nameMarker }` (`nameMarker` is `null` for bStocks, whose `name()` carries no marker) |
| `fingerprint` | Fingerprint | the measured rule |
| `notes` | string[] | facts found while building the family, e.g. a Binance list entry that is a wrapper, not the token |

### Fingerprint

| Field | Type | Content |
|---|---|---|
| `measuredAt` | timestamp | when the on-chain pass finished |
| `block` | integer | block at the start of the pass |
| `method` | string | how the rule was derived |
| `roles` | object | `{ token: RoleRule }`, plus `wrapper: RoleRule` for xStocks (ERC-4626 v2 wrappers) |

RoleRule:

| Field | Type | Content |
|---|---|---|
| `codeHash` | string | keccak256 of the runtime code shared by the issuer-listed contracts of this role |
| `codeSize` | integer | bytes |
| `proxyKind` | string | `beacon` or `transparent` |
| `slot` | string | the EIP-1967 slot that is part of the rule: `beacon` or `admin` |
| `slotValue` | string | its value (an address) shared by the members |
| `members` | integer | listed contracts of this role that match both |
| `implementations` | `{ address, count }[]` | distribution of the EIP-1967 implementation slot (reported, not part of the rule: an issuer may upgrade tokens one by one) |
| `outliers` | integer | listed contracts of this role with code that matches neither the hash nor the slot |

## Token

One entry per address. Ordered by family, then symbol.

| Field | Type | Content |
|---|---|---|
| `address` | string | |
| `family` | string | family id |
| `role` | string | `token`, or `wrapper` (xStocks ERC-4626 v2 wrapper) |
| `pairAddress` | string \| null | xStocks: the wrapper of a token, the token of a wrapper |
| `symbol`, `name` | string \| null | on-chain `symbol()`, `name()` |
| `decimals` | integer \| null | on-chain `decimals()` |
| `underlyingTicker` | string \| null | from the issuer list |
| `assetClass` | string \| null | `stock`, `etf`, `portfolio`, `currency`, `other` — when a list says so |
| `listedBy` | string[] | source ids that list this address on chain 56 |
| `onchain` | object | `{ readAt, block, codeSize, codeHash, beacon, implementation, admin }` (`codeSize` 0 = no code; slot values `null` when zero) |
| `creator` | object | `{ status, address, source, fetchedAt }`; `status`: `ok`, `not_checked`, `no_answer`, `failed` |
| `checks` | object | `{ issuerList, hasCode, codeHash, proxy, creator }`: `true`, `false`, or `null` (not measured) |
| `verdict` | string | `genuine` or `unknown` (see Verdicts) |
| `reasons` | string[] | reason codes, in the order the rule applies them |
| `explanation` | string | one English sentence built from the reasons |

## Lookalikes

| Field | Type | Content |
|---|---|---|
| `status`, `reason`, `error` | | as above |
| `source` | string | `binance-w3:token-search` or `binance-public:token-search` |
| `fetchedAt` | timestamp \| null | when the last search completed |
| `method` | string | which queries were run and how a claim is decided |
| `queries` | integer | searches run |
| `pageCap` | integer | the most rows one search returns |
| `fullPages` | integer | searches that came back with exactly `pageCap` rows: more may exist |
| `lowerBound` | boolean | `true` whenever `fullPages > 0` or a query failed |
| `counts` | object | `{ bstocks, ondo, xstocks, total }` |
| `items` | Lookalike[] | |
| `otherIssuerClaims` | object[] | `{ address, symbol, name, query }`: contracts on chain 56 that claim an issuer outside the three families (e.g. a name ending in "(Coinbase)"); counted, not judged |

Lookalike:

| Field | Type | Content |
|---|---|---|
| `address` | string | |
| `symbol`, `name` | string \| null | on-chain `symbol()`, `name()` (what the contract claims) |
| `claims` | object | `{ family, by, genuineSymbol, genuineAddress }`; `by`: `["symbol"]`, `["name"]` or both |
| `onchain` | object \| null | `{ readAt, codeSize, codeHash }` |
| `search` | object | `{ query, liquidityUsd, holders, launchPlatform }` as the search reported them (strings or `null`) |
| `verdict` | string | `look-alike` |
| `reasons` | string[] | |

## Market

Sampled, never the whole set: requests to the aggregator are expensive and equity routes are RFQ.

| Field | Type | Content |
|---|---|---|
| `status`, `reason`, `error` | | as above |
| `sources` | string[] | source ids used |
| `fetchedAt` | timestamp \| null | |
| `method` | string | sample rule, sizes, quote direction |
| `sizesUsd` | number[] | `[20, 100, 1000]` |
| `quoteToken` | object | `{ symbol: "USDT", address, decimals }` |
| `walletPlaceholder` | string \| null | the neutral address passed as `userWalletAddress` (RFQ routes require one); never a real user wallet |
| `sessions` | object[] | market-wide state when sampled: `{ family, source, fetchedAt, openState, marketStatus, reasonCode, nextOpenAt, nextCloseAt }` |
| `items` | MarketItem[] | |

MarketItem: `{ address, family, symbol, status, pools, quotes }`

- `status`: `{ source, fetchedAt, openState, marketStatus, reasonCode, nextOpenAt, nextCloseAt }` or `null`
- `pools`: `{ source, fetchedAt, status, count, liquidityUsdTotal, top: [{ protocolName, poolAddress, liquidityUsd }] }`. An empty pool list does not mean untradable: equity liquidity is quoted by RFQ
- `quotes`: one per size: `{ sizeUsd, direction: "USDT->token", amountInRaw, fetchedAt, status: "ok" | "error", code, message, toTokenAmount, priceImpactPercent, dexes, isHoneyPot, taxRate, effectivePriceUsd }`. An RFQ refusal (`40367`, `40369`, `40374`, `40375`, `40368`) is `status: "error"` with its code: data about the market, not a failure of the run

## Prices

| Field | Type | Content |
|---|---|---|
| `status`, `reason`, `error`, `fetchedAt` | | as above |
| `sources` | string[] | |
| `caveat` | string | the `notices.referencePrice` sentence |
| `items` | PriceItem[] | |

PriceItem: `{ address, family, symbol, source, fetchedAt, tokenPrice, referencePrice, tokenPriceUpdatedAt, multiplier, tokenToShareRatio, tokenOverReference, tokenOverReferenceVsMultiplierPct, label }`

- `tokenPrice`, `referencePrice`, `multiplier`, `tokenToShareRatio`: upstream strings or `null`
- `tokenOverReference`: number, `tokenPrice ÷ referencePrice`
- `tokenOverReferenceVsMultiplierPct`: number, how far that ratio sits from the listed multiplier, in percent
- `label`: `"on-chain token price vs Binance reference price"`; for xStocks `"xStocks token quote (issuer API, no timestamp)"`, where `referencePrice` is `null`

## Summary

`{ measuredAt, keyUsed, families: { bstocks: Counts, ondo: Counts, xstocks: Counts }, lookalikes: { total, lowerBound } }`

Counts: `{ listed, noCode, genuine, unknown, lookalikes, byRole }`

- `listed` — addresses in the family's issuer list (and Binance lists) on chain 56;
- `noCode` — listed, but no contract at that address on chain 56 (never genuine);
- `genuine`, `unknown` — verdicts over the listed addresses that have code;
- `lookalikes` — from the look-alike section;
- `byRole` — the same counts split by `token` / `wrapper` (xStocks only, otherwise `null`).

## Verdicts

| verdict | meaning |
|---|---|
| `genuine` | the address is in the family's issuer list **and** its runtime code hash and its proxy slot (beacon or admin) equal the family rule for its role; when the creator was checked, it matches as well |
| `look-alike` | not genuine, and the contract claims a family identity on chain: its `symbol()` equals the symbol of a genuine contract of the family (case-insensitive), or its `name()` carries the family marker |
| `unknown` | neither can be said: listed but the code or slot differs (an outlier, reported rather than forced), the fingerprint matches but the address is not listed, the creator differs, or nothing could be read |
| `none` | single-address check only: the contract makes no family claim and is not listed |

## Reason codes

| code | meaning |
|---|---|
| `issuer_list` | listed by the family's issuer list |
| `not_in_issuer_list` | not listed by it (other lists may still list it; see `listedBy`) |
| `binance_list` | listed by a Binance list (keyed or keyless) |
| `no_code` | no contract code at the address on chain 56 |
| `code_unreadable` | the RPC did not answer; nothing was compared |
| `code_hash_match` / `code_hash_mismatch` | runtime code hash against the family rule for the role |
| `proxy_match` / `proxy_mismatch` | beacon or admin slot against the family rule |
| `creator_match` / `creator_mismatch` / `creator_not_checked` | creator from `binance-w3:basic-info` against the family's creator |
| `fingerprint_without_listing` | the code and slot match a family, but no list has the address |
| `claims_symbol` | `symbol()` equals a genuine family symbol |
| `claims_name` | `name()` carries the family marker |
| `shares_ticker` | single-address check: a ticker shared with a family token, which alone is not a claim |
