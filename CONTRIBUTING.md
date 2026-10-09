# Contributing

Thank you for helping keep stock-linked tokens on BNB Smart Chain honest. The project is
deliberately small: a verifier, a scan that writes a JSON snapshot, and a static report.

## Welcome

- **Reports of unlisted contracts using a family ticker.** Open an issue with the address and the output of
  `node bin/stv-verify.mjs <address> --json`. If the verifier gets it wrong, that is a bug.
- **Snapshot updates.** Never edit `data/snapshot.json` by hand: run `node bin/stv-verify.mjs scan`
  and paste the printed summary into the pull request. A change of a family rule (code hash, beacon
  or admin) is not merged until it is explained.
- **Schema changes.** `stv-bsc-snapshot/1` changes are additive only; see
  [docs/snapshot-schema.md](docs/snapshot-schema.md).
- **Bug fixes and tests.**

Out of scope: trading, portfolio features, price predictions.

## Ground rules

1. **No dependencies.** The package runs from a fresh clone with no install step.
2. **Tests run offline.** `npm test` must pass with no external network (loopback only). On Linux:
   `unshare -rn sh -c 'ip link set lo up && npm test'`.
3. **Be gentle with public services.** JSON-RPC batches of 20 or fewer with a pause between them; no
   `eth_getLogs` scans; at most 4 requests per second to one Binance Web3 endpoint.
4. **Say how every number was obtained.** Every section of the snapshot names its source and read time.
5. **Honest failures.** An unreachable source is a `failed` section or an `unknown` verdict, never an
   empty success.
6. **No secrets, ever.** A Binance key is read from a file or the environment inside the client
   only; it is never printed, logged, stored in a snapshot or committed. Fixtures hold no signature.
7. **Information only.** No call to buy or sell anything. English only, in code, docs and commits.

Before opening a pull request:

```sh
npm test
npm run check    # pre-publication check: no private paths, credentials or calls to buy
```

Rules about your own environment (host names, directory names, ticket numbers) do not belong in the
public check: put them in a JSON file outside the repository and run
`CHECK_CLEAN_EXTRA=/path/to/rules.json npm run check`. The format is described at the top of
`scripts/check-clean.mjs`.

## Security

Please report vulnerabilities privately through the repository's security advisory feature rather
than in a public issue.
