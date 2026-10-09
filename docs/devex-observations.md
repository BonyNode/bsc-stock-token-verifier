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
| 2026-10-09T~16:04Z | `GET https://api.xstocks.fi/api/v2/public/assets/NVDAx/price-data` | `{"quote":229.3645}` | no timestamp in the answer |
| 2026-10-09T15:57:54.645Z | Ondo token CSV via the Dropbox link on `https://docs.ondo.finance/addresses` (`dl=1`) | HTTP 200, `content-type: application/binary`, 458 rows, all with a BSC address; Type: Stock 333, ETF 117, Portfolio 7, Currency 1 | |
| 2026-10-09T15:53Z | `1rpc.io/bnb`, `binance.llamarpc.com` (batch `eth_chainId` + `eth_blockNumber`) | HTTP 502 / no answer | `bsc-dataseed.bnbchain.org`, `bsc-dataseed1.binance.org`, `bsc-rpc.publicnode.com`, `bsc.drpc.org` answered `0x38` |
