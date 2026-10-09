# Data, terms and names

Not affiliated with, endorsed by or connected with Binance, Ondo Finance or Backed (xStocks).
Information only, not investment advice.

## What data this repository contains

| Path | Content | Origin |
|---|---|---|
| `data/snapshot.json` | the latest scan: lists, on-chain facts and verdicts per contract, look-alikes, the market sample, prices | BNB Smart Chain public JSON-RPC; the Binance Web3 API and Binance's keyless wallet endpoints; `api.xstocks.fi`; the Ondo token CSV — each with its read time in the file |
| `report/index.html` | the same snapshot rendered as one HTML page | generated from `data/snapshot.json` |
| `test/fixtures/bsc.mjs` | runtime bytecode of 5 contracts on chain 56 and their slot, name and symbol answers | public chain state, 2026-10-09 |
| `test/fixtures/snapshot.mjs` | a minimal snapshot built by hand for tests | made up, no real data |

No fixture holds a request signature, an API key or a header value: the pre-publication check
(`npm run check`) rejects Binance key values and signing-header values in any file.

Everything else — the code, the tests and their helpers, and the documentation — is licensed under
the Apache License, Version 2.0 (see `LICENSE` and `NOTICE`).

## Terms that apply

The chain state is public; the lists come from the issuers' and Binance's public endpoints, each
under its own terms. This repository treats the data it contains as **verification and display
data**: published so that anyone can check the verdicts and repeat the measurement, redistributable
**unmodified, together with the code**, for verification and display, **not offered for resale**.
No rights are claimed in the chain state or the third-party lists. The Apache License of the code
does not extend to this data or to any third-party names or marks. Anyone reusing the data is
responsible for their own compliance with the terms of the sources.

## How things are named

- The issuers' own words: **bStocks** are certificates; **xStocks** are tracker certificates issued
  by Backed; **Ondo Stocks** are issued by Ondo Global Markets.
- The chain is **BNB Smart Chain** (chain id 56).
- Every figure states how it was obtained, when, and from which source (`sources` in the snapshot).
- No call to buy or sell: `npm run check` rejects such wording.

## Names and marks

"Binance", "bStocks", "Ondo", "xStocks", "Backed" and related names and marks belong to their
respective owners and are used here only to identify the contracts and services this software reads.
