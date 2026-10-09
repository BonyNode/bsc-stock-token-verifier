# DevEx observations — raw log

Facts recorded while building the BNB Smart Chain edition, for the owner's own DevEx report. Each
row: UTC time, the exact request (no key, no signature, no header values), what came back. No
interpretation beyond what the response shows. Times are from the machine that made the request.

## Binance Web3 API (keyed, `https://web3.binance.com/build`)

| UTC | Request | Response | Note |
|---|---|---|---|
| 2026-10-09T15:54:26.543Z | `GET https://web3.binance.com/build/api/v1/dex/market/rwa/tokens?binanceChainId=56&platformId=bstock`, no auth headers | HTTP 401, `{"msg":"API Key is required","data":"","code":40101,"timestamp":1791561267077}`; response header `x-oc-blocked-by: AuthenticationFilter/40101` | `data` is an empty string, not `null` |
| 2026-10-09T15:54:28.223Z | `GET https://web3.binance.com/build/api/v1/dex/market/rwa/platforms?binanceChainId=56`, no auth headers | HTTP 401, same body, keys in a different order (`timestamp` first) | |
| 2026-10-09T16:07:12.779Z | `GET https://web3.binance.com/build` (curl, no browser) | HTTP 302 → `https://web3.binance.com/en/build` | |
| 2026-10-09T16:07:13.662Z | `GET https://web3.binance.com/en/build` (curl) | HTTP 202, 0-byte body, `x-amzn-waf-action: challenge`, `server: CloudFront` | the documentation cannot be read by a non-browser client; the same happened for `/build/docs` and `https://developers.binance.com/docs/web3` (HTTP 202, empty body) around 15:55Z |
| 2026-10-09T16:26:56.712Z | signed `GET /build/api/v1/dex/market/rwa/platforms?binanceChainId=56` (key with Market + Trade permissions) | HTTP 200, `code 0`, 392 ms, 2 rows: `ondo` tickerCount 459, chain 56 tokenCount 458; `bstock` tickerCount 91, chain 56 tokenCount 91 | success code is the number `0` (the keyless endpoints use the string `"000000"`) |
| 2026-10-09T16:26:57.111Z | signed `GET …/rwa/tokens?binanceChainId=56&platformId=bstock` | HTTP 200, `code 0`, 612 ms, **46 rows**; all 46 have `tags: ["alpha"]`, `statusInfo.reasonCode "TRADING"`, `marketStatus null` | rwa/platforms says 91 on chain 56; the keyless list has 91; the 45 missing rows include AAPLB, AMZNB, NFLXB, ASMLB |
| 2026-10-09T16:28:19Z–16:28:26Z | same request with `tabId=1` … `tabId=13`, `page=2`, `pageNo=2`, `pageSize=200`, `limit=200`, `cursor=46`, `offset=46` | every answer: HTTP 200, `code 0`, the same 46 rows (first CRCLB, last SOXLB) | no parameter tried returns the other 45 bStocks |
| 2026-10-09T16:26:57.728Z | signed `GET …/rwa/tokens?binanceChainId=56&platformId=ondo` | HTTP 200, `code 0`, 319 ms, **442 rows** (platforms: 458; keyless list: 458; Ondo CSV: 458) | |
| same responses | `tokenName` field | `"Circle Internet Group (bStocks)"` for the contract whose `name()` is `"Circle Internet Group Inc."`; Ondo rows end in `"(Ondo Tokenized)"` like the contract names | display name, not the on-chain name, for bStocks |
| same responses | `tokenPrice`, `referencePrice`, `tokenToShareRatio` over all 488 rows | `tokenPrice ÷ referencePrice` equals `tokenToShareRatio` in every row (largest difference 2.2e-14 %, float rounding); 264 rows have a ratio other than 1 (e.g. SOXSon 0.101695663086635307: tokenPrice 0.3592, referencePrice 3.5326) | `referencePrice` is the token price converted by the ratio; it carries no price information of its own |
| 2026-10-09T16:26:58.548Z | signed `GET …/rwa/price?binanceChainId=56&tokenContractAddresses=<NVDAB>,<NVDAon>` (comma not encoded) | HTTP 200, `code 0`, 282 ms, 2 rows with `tokenPrice`, `referencePrice`, `tokenPriceUpdatedAt` (epoch ms) | |
| 2026-10-09T16:26:58.831Z | signed `POST …/token/basic-info`, query empty, JSON body `[{"binanceChainId":"56","tokenContractAddress":"0x02fc…7436"}]` | HTTP 200, `code 40001`, `Parameter binanceChainId is required` | HTTP 200 for a parameter error |
| 2026-10-09T16:27:45.743Z / 16:27:46.064Z | same POST with body `{"binanceChainId":"56","tokenContractAddress":"…"}` / `{"binanceChainId":"56","tokenContractAddresses":"a,b"}` | HTTP 200, `code 40001`, `Parameter binanceChainId is required` | the body is not read |
| 2026-10-09T16:27:45.329Z | signed `POST …/token/basic-info?binanceChainId=56&tokenContractAddress=0x02fc…7436`, body `{}` | HTTP 200, `code 0`, one object: `creatorAddress 0x64fdaf82d69d5a8ab409331e3042042e8a178d53`, `createTime 1780655759500`, `tagList null`, `tokenName "NVIDIA (bStocks)"` | a POST whose parameters must be in the query; one address per request |
| 2026-10-09T16:28:04.735Z | same, `tokenContractAddress=<a>,<b>` (two addresses) | HTTP 200, `code 0`, `data: null` | a success code with no data, no error message |
| 2026-10-09T16:26:59.115Z | signed `GET …/token/search?chains=56&search=NVDA` | HTTP 200, `code 0`, 562 ms, exactly 50 rows; fields `tokenName` (display name, e.g. "NVIDIA (bStocks)"), `tokenSymbol`, `liquidity`, `holders`, `tagList.isRecognized` | same 50-row cap as the keyless search |
| 2026-10-09T16:26:59.679Z | signed `GET …/token/top-liquidity?binanceChainId=56&tokenContractAddress=<NVDAB>` | HTTP 200, `code 0`, 583 ms, 15 pools; 5 of them (`Bebop` ×2, `Native`, two with `protocolName null`) have `liquidityUsd null`; largest PancakeSwap V3 pool `liquidityUsd "6100745.97…"` | RFQ venues appear as pools without liquidity figures |
| 2026-10-09T16:27:00.263Z | signed `GET …/aggregator/quote?binanceChainId=56&amount=20000000000000000000&fromTokenAddress=<USDT>&toTokenAddress=<NVDAB>&userWalletAddress=0x…dead` | HTTP 200, `code 0`, 292 ms, an array of 1: `vendorName "LiquidMesh"`, `executionMode "SWAP"`, `toTokenAmount "86948320096335237"` (0.08695 NVDAB for 20 USDT → 230.02 USD per token), `priceImpactPercent "0.0000000000"`, `tradeFee "0.01037844"`, route `Kipseli 100%`, `toToken.isHoneyPot false`, `taxRate "0"` | `data` is an array of one quote |
| ~2026-10-09T16:45:24Z | signed `GET …/rwa/price?binanceChainId=56&tokenContractAddresses=<100 addresses, comma-separated>` | HTTP 414 (URI Too Long), body not JSON — twice; the third request of the same run with 65 addresses: HTTP 200, `code 0` | 100 is the documented maximum per request; at 42 characters per address the URL passes 4 KB |
| 2026-10-09T16:45:35.663Z | signed `GET …/aggregator/quote`, USDT → xStocks `NVDAx` token `0xc845…849d`, amount 20 USDT | HTTP 200, `code 40374`, `Insufficient liquidity for a quote. Please decrease the transaction amount or try again later.` | same code for 20, 100 and 1 000 USD, and for every xStocks token sampled (NVDA, AAPL, TSLA, MSFT, AMZN, GOOGL, META, SPY, QQQ, COIN); top-liquidity listed 1–5 pools for them, all `liquidityUsd` null or 0 |
| 2026-10-09T16:45:38.124Z | same, USDT → the xStocks v2 wrapper `wNVDAx` | HTTP 200, `code 40441`, `No valid quote result from any vendor, please retry later` | code not in the RFQ list of the documentation summary; same for every wrapper sampled; top-liquidity: 0 pools |
| 2026-10-09T16:45:2xZ–16:45:4xZ | quotes USDT → bStocks for the same 10 tickers at 20 / 100 / 1 000 USD | all HTTP 200, `code 0`, `vendorName "LiquidMesh"`, `executionMode "SWAP"`; `priceImpactPercent` between 0.0000 and 0.0052 for every size (e.g. NVDAB 0.0000 / 0.0000 / 0.0000214; COINB 0.0030 / 0.0052 / 0.0005) | bStocks status `TRADING` during the US regular session |
| 2026-10-09T17:01:12Z–17:02:18Z | quotes USDT → Ondo for NVDAon, AAPLon, TSLAon, MSFTon, AMZNon, GOOGLon, METAon, SPYon, QQQon, COINon at 20 / 100 / 1 000 USD (rwa/tokens status `regular` / `TRADING` for all ten) | 27 × HTTP 200 `code 0` (`vendorName "LiquidMesh"`, `executionMode "SWAP"`), 3 × `code 40374` (COINon, every size). `priceImpactPercent` at 20 / 100 / 1 000 USD: NVDAon 0.0000995 / 0.000117 / 0.000317; AMZNon 0.00859 / 0.0322 / 0.2367; GOOGLon 0.0104 / 0.0121 / 0.0663; SPYon 0.0102 / 0.3819 / 0.9306; QQQon 0.0112 / 0.0157 / 0.5224; MSFTon 0.9996 / 0.9996 / 0.9996 | MSFTon at 20 USD: 1.26e-8 tokens for 20 USDT, i.e. 1 582 985 117 USD per token against a token price near 535 USD — the quote is returned with `code 0`, not refused |
| same quotes | `priceImpactPercent` against the tokens received | SPYon at 1 000 USD: impact `0.9305537281`, effective price 11 288.92 USD per token (token ≈ 780 USD: 93.1 % worse); AMZNon at 1 000 USD: `0.2367404270`, 342.79 USD (token ≈ 261.6 USD: 23.7 % worse) | the field named "Percent" behaves as a fraction of 1 |
| 2026-10-09T16:45Z and 17:01Z (all quotes of both runs) | `executionMode` of every successful quote (bStocks and Ondo) | always `"SWAP"`, `vendorName` always `"LiquidMesh"`; no answer had an RFQ execution mode | |
| 2026-10-09T17:11:27Z–17:12:40Z (third scan) | quotes USDT → token at 20 / 100 / 1 000 USD; cost = effective price ÷ `rwa/price` tokenPrice of the same run − 1 | bStocks, all ten within +0.2 %: NVDAB +0.091 / +0.092 / +0.095 %; AAPLB +0.139 % at each size; TSLAB +0.025 / +0.033 / +0.033 %; MSFTB +0.138 / +0.142 / +0.183 %; AMZNB +0.037 %; GOOGLB −0.011 / −0.011 / −0.009 %; METAB +0.143 %; SPYB +0.168 / +0.166 / +0.169 %; QQQB +0.086 %; COINB +0.161 / +0.161 / +0.158 %. Ondo: NVDAon −0.017 / −0.016 / +0.008 %; AAPLon +0.070 %; METAon +0.056 / +0.088 / +0.088 %; TSLAon +0.059 / +0.059 / +14.7 %; GOOGLon +0.40 / +0.57 / +8.96 %; AMZNon +1.18 / +3.65 / +31.5 %; QQQon +0.69 / +1.15 / +108.5 %; SPYon +0.85 / +61.5 / +1 337 %; MSFTon about +294 million % at every size; COINon `code 40374` at every size. xStocks: `40374` for all ten tokens, `40441` for all ten v2 wrappers, at every size | all answers HTTP 200; market status `regular` |

## Binance public endpoints (keyless, documented in github.com/binance/binance-skills-hub)

| UTC | Request | Response | Note |
|---|---|---|---|
| 2026-10-09T15:55:35.684Z | `GET https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai` | HTTP 200, 363 398 bytes, `code "000000"`, 1 938 rows. Chain 56: type 1 = 458, type 2 = 130, type 3 = 91, type 4 = 4, type 9 = 1. Chain 4663: type 5 = 194. Chain CT_501: type 1 = 451, type 2 = 139. Chain 1: type 1 = 457. Chain 8453: type 11 = 13 | the skill document says type 1 (Ondo) is "currently the only supported tokenized stock provider"; the live list has types 1, 2, 3, 4, 5, 9, 11 |
| same response | type 2 rows on chain 56 (symbols ending in `x`) | 130 rows; 128 are xStocks token addresses, 2 are xStocks ERC-4626 v2 wrapper addresses: `wPOPMTx` `0x4ebf5fd25b02022afad96e2fa25da54a246fded0`, `wTCENTx` `0x41333df9e7639188bbfca5522dc4844398af9f9e` (roles taken from `api.xstocks.fi`) | xStocks appear here although the keyed RWA endpoints document `platformId` `ondo` and `bstock` only |
| same response | type 1 rows on chain 56 against the Ondo CSV | 457 addresses in both; Binance only: `USDY` `0x608593d17a2decbbc4399e4185be4922f97ed32e`; CSV only: `USDon` `0x1f8955e640cbd9abc3c3bb408c9e2e1f5f20dfe6` | |
| same response | type 3 rows on chain 56 (bStocks) | 91 rows, each with `cs` (e.g. `MUBUSDT`) and `asset` (e.g. `MUB`) fields not described in the skill document | |
| 2026-10-09T15:59:30.462Z | `GET https://web3.binance.com/bapi/defi/v5/public/wallet-direct/buw/wallet/market/token/search/ai?keyword=NVDA&chainIds=56` | HTTP 200, exactly 50 rows. Besides the xStocks `NVDAx` at `0xc845b2894dbddd03858fd2d643b4ef725fe0849d`, 12 more contracts answer with symbol `NVDAx` and name `NVIDIA xStock`; 1 more contract with symbol `NVDAB` | 50 rows = one page; whether more exist cannot be told from the response |
| same response | display names | the search shows `NVIDIA (bStocks)` for `0x02fca66c1d1afb4e2a7884261eb00f63598a7436`, whose own `name()` is `NVIDIA Corp`; `NVIDIA (Ondo)` for the Ondo token whose `name()` ends in `(Ondo Tokenized)` | names in Binance responses are display names, not the contract's claim |
| ~2026-10-09T15:59:31Z | `GET https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/market/token/rwa/market/status/ai` | `{"marketStatus":"regular","openState":true,"nextOpen":"2026-10-09T20:01:00Z","nextClose":"2026-10-09T19:59:00Z","offhours":{"openState":false,"nextOpenTime":1791590760000,"nextCloseTime":1791762900000}}` | `offhours` = 2026-10-10T00:06:00Z → 2026-10-11T23:55:00Z; the `offhours` block is not in the skill document |

## The Ondo quotes at larger sizes (investigated 2026-10-09T17:23Z, US regular session)

Question: are the +14.7 % … +1 337 % costs at 1 000 USD (and MSFTon at every size) caused by the
placeholder wallet, by amount units, or by thin liquidity? 29 signed requests, 17:23:02Z–17:23:21Z.

| UTC | Request | Response | Reading |
|---|---|---|---|
| 17:23:07.562Z | quote USDT → SPYon, 1 000 USD, **without** `userWalletAddress` | HTTP 200, `code 40001`, `userWalletAddress is required for RFQ (Ondo) quote` | the API itself says Ondo quotes are meant to be RFQ quotes for a user wallet |
| 17:23:07.948Z / 17:23:08.505Z | same with `userWalletAddress=0x…0001` / `0x…dead` | both HTTP 200 `code 0`, identical answers: `vendorName "LiquidMesh"`, `executionMode "SWAP"`, route `Pancakeswap V3 100.00%`, `toTokenAmount "88582468681134219"`, `priceImpactPercent "0.9305537281"` → 11 288.92 USD per token against a token price of 785.12 | the choice between two neutral addresses changes nothing; a wallet eligible for Ondo's RFQ (a real, onboarded user) cannot be tested by this tool |
| 17:23:09.048Z | quote USDT → MSFTon, 20 USD, without wallet | `code 40001`, same message | |
| 17:23:09.330Z / 17:23:09.864Z | same with `0x…0001` / `0x…dead` | `code 0`; routes `Rfq Halfmoon → Uniswap V4` (2 hops via USDC) / `Rfq Halfmoon → Rfq Halfmoon → Uniswap V4` (3 hops via WBNB, USDC); both `priceImpactPercent "0.9996010001"`, `toTokenAmount "12634231323"` (1.26e-8 MSFTon for 20 USDT) | the last leg is a Uniswap V4 pool priced about 3 million times off; the aggregator returns it with `code 0` |
| 17:23:10Z–17:23:13Z | SPYon size ladder 20 / 50 / 100 / 200 / 500 / 1 000 USD (`0x…dead`) | always route `Pancakeswap V3 100.00%`, one hop; cost against the token price +0.88 / +3.44 / +61.6 / +200.7 / +626.4 / +1 337.9 %; `priceImpactPercent` 0.0102 / 0.0347 / 0.3819 / 0.6679 / 0.8625 / 0.9306 | a smooth, monotonic rise on one AMM route: a thin pool, not a unit error |
| 17:23:14Z–17:23:17Z | AMZNon size ladder, same sizes | route changes with size: Topaz CL + PancakeSwap (20) → `Rfq Newworld`/`Rfq Halfmoon` + PancakeSwap V2 (50–500) → `Rfq Bebop 100.00%` direct (1 000); cost +1.21 / +2.14 / +3.69 / +6.79 / +16.07 / **+0.096 %** | the same 1 000 USD quote cost +31.5 % twelve minutes earlier (17:11Z): RFQ makers join and leave the route minute by minute |
| 17:23:18Z–17:23:20Z | NVDAon size ladder (control) | cost +0.005 / +0.014 / +0.019 / +0.034 / +0.059 / +0.070 %; at 500 and 1 000 USD the route is `Rfq Neptunex` to NVDAB, then `Uniswap V4` NVDAB → NVDAon | the cheapest Ondo route ran through the bStocks token |
| 17:23:21Z | `top-liquidity` for SPYon, AMZNon, MSFTon, NVDAon | 5 / 4 / 4 / 9 pools; **every** `liquidityUsd` is `null` and every `liquidityAmount[].tokenAmount` is `null`; protocols `Bebop`, `Native` (RFQ venues) or `null`, plus a pool against USDon | the PancakeSwap V3 pool that carried the SPYon route is not among them; the pools endpoint gives no depth to compare with |
| all quotes of the day | `executionMode` | always `"SWAP"`, even when every leg of `dexRouterList` is an `Rfq …` venue | RFQ makers appear as route legs inside a SWAP answer |

Units ruled out: the same amount encoding (USDT, 18 decimals) gives correct prices for every bStocks
size and for Ondo at 20 USD; the distortions (×14.4, ×2.9 million) are not powers of ten.

Interpretation used in the snapshot: a successful quote whose cost against the token price of the
same run is 5 % or more is marked `representative: false`. It is a real answer of the aggregator
for a placeholder wallet at that moment, but it says more about a thin or mispriced pool on the
route than about the price an eligible wallet would be quoted. The report prints "quote not
representative" with the reason instead of the number; the raw answer stays in the snapshot.

## Brief vs live chain

| UTC | Request | Response | Note |
|---|---|---|---|
| 2026-10-09T~15:58Z | `eth_getStorageAt` EIP-1967 implementation slot of xStocks `AEHRx` `0x9443176f5224ef669847524b35eb5c1d80ecac3f` (bsc-dataseed.bnbchain.org) | `0xd865ce1b07540b5ede20e8298f48da69770fe22e` | the research sample had `0x65c40d62…` for another xStocks token: the implementation is not one value across the family |

## Other sources (not Binance)

| UTC | Request | Response | Note |
|---|---|---|---|
| 2026-10-09T15:56:39Z | `GET https://api.xstocks.fi/api/v2/public/assets?page=0&pageSize=100` with Python `urllib` default User-Agent | HTTP 403 | curl and Node.js `fetch` get HTTP 200 for the same URL |
| 2026-10-09T~15:56Z | `GET https://api.xstocks.fi/api/v2/public/assets?pageSize=500` | HTTP 400 `{"error":"Validation error","details":[{"field":"pageSize","message":"Number must be less than or equal to 100"}]}` | |
| 2026-10-09T15:56:53Z–15:57:22Z | all pages, `pageSize=100` | 13 pages, 1 272 assets; every asset lists a `BinanceSmartChain` deployment with `address` and `wrapperAddressV2` | page 0 lists all 11 networks for every asset |
| 2026-10-09T16:51:30Z | the same walk (second scan) | 14 pages, 1 319 assets (47 more than 54 minutes earlier); all 2 638 BSC addresses (token + v2 wrapper) have contract code on chain 56 | |
| 2026-10-09T16:15:45Z–16:20:35Z | `eth_getCode` + EIP-1967 slots for 3 094 listed addresses (bsc-dataseed.bnbchain.org, batches of 20) | every address has code; bStocks 91/91 one code hash + one beacon; Ondo 450/458 one code hash + one beacon (7 portfolio tokens share a second beacon `0x16ba…93d8`, USDon is a transparent proxy); xStocks tokens 1 272/1 272 one code hash + one admin, two implementations (1 106 / 166); wrappers 1 272/1 272 one code hash + one admin + one implementation | 1 188 JSON-RPC requests, 290 s |
| 2026-10-09T~16:04Z | `GET https://api.xstocks.fi/api/v2/public/assets/NVDAx/price-data` | `{"quote":229.3645}` | no timestamp in the answer |
| 2026-10-09T15:57:54.645Z | Ondo token CSV via the Dropbox link on `https://docs.ondo.finance/addresses` (`dl=1`) | HTTP 200, `content-type: application/binary`, 458 rows, all with a BSC address; Type: Stock 333, ETF 117, Portfolio 7, Currency 1 | |
| 2026-10-09T15:53Z | `1rpc.io/bnb`, `binance.llamarpc.com` (batch `eth_chainId` + `eth_blockNumber`) | HTTP 502 / no answer | `bsc-dataseed.bnbchain.org`, `bsc-dataseed1.binance.org`, `bsc-rpc.publicnode.com`, `bsc.drpc.org` answered `0x38` |
