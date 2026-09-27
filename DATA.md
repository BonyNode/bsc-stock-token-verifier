# Data, terms and names

This project is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc.

## What data this repository contains

| Path | Content | Origin |
|---|---|---|
| `data/stock-tokens.snapshot.json` | 194 addresses, symbols and underlying names of Stock Tokens, with the counts of the selection | public state of Robinhood Chain, read on 2026-09-20 over public JSON-RPC (`eth_getCode`, `eth_call`), plus contract creators from the chain explorer |
| `src/registry.js` | the reference values in it: the reference bytecode hash (`CODE_HASH`) and the creator address (`DEPLOYER`) | the same measurement |
| `examples/*.json` | responses of the API in this repository | captured on 2026-09-27 from the public chain, reshaped by hand to the current response format with the captured values kept |
| `test/fixtures/chain.mjs` | the whole file: runtime bytecode of 2 contracts, bytecode hashes of 3 more, their `symbol()`, `name()` and `uiMultiplier()` answers, and live multipliers of 4 Stock Tokens (NVDA among them again) — 8 distinct contracts in all | public chain state, 2026-09-20 (multipliers re-read on 2026-09-27) |

Underlying names are the prefixes of the tokens' own `name()` answers (for example
"NVIDIA • Robinhood Token" → "NVIDIA").

Robinhood publishes its own official list of contracts at https://docs.robinhood.com/chain/contracts,
generated live from the on-chain asset registry. The snapshot here is an independent re-check from
chain state and is not taken from that list.

Everything else in this repository — the code, the tests and their helpers (`test/helpers.mjs`),
and the documentation — is licensed under the Apache License, Version 2.0 (see `LICENSE` and
`NOTICE`).

## Terms that apply

Robinhood Chain publishes terms of service for its services — among them the public RPC,
node snapshots and documentation: https://docs.robinhood.com/chain/terms-of-service. They restrict
distributing or selling their services and materials, creating derivative works from them, and
using them to build a competing product or service.

This repository therefore treats the chain data it contains as **verification and display data**:

- it is published so that anyone can check the verdicts and repeat the measurement;
- it may be redistributed **unmodified, together with the code of this repository**, for
  verification and display;
- it is **not offered for resale** — the API's `/stock-tokens` answer carries `resaleOk: false`;
- no rights are claimed in the chain state itself: the addresses, bytecode and call answers are
  public state of Robinhood Chain that anyone can read from the chain;
- the Apache License, Version 2.0 of the code does **not** extend to this data — `data/`,
  `examples/`, `test/fixtures/` and the reference values in `src/registry.js` — or to any
  third-party names or marks. This file sets the only terms for the data: verification and display,
  not resale.

Anyone reusing the data is responsible for their own compliance with the terms above.

## How things are named

- The assets are called **Stock Tokens** — the issuer's required term. The family of words meaning
  "securities issued as tokens" is not used for them, in any language, and the pre-publication check
  (`npm run check`) enforces this in six languages.
- The chain is always called **Robinhood Chain**, in full; `npm run check` rejects abbreviations and
  other informal or unofficial variants of the name.
- The issuer's own stock ticker is not mentioned in material about the chain.
- Every figure states how it was computed, over what period and from which source, and chain
  metrics are never mixed with brokerage metrics.

## Names and marks

"Robinhood" and related names and marks belong to their respective owners and are used here only to
identify the chain this software reads.
