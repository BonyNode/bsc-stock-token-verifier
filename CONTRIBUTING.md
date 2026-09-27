# Contributing

Thank you for helping keep Stock Token verification honest. This project is deliberately small: a
registry, a verifier, and a read-only API for one chain.

## Welcome

- **Counterfeit reports.** Open an issue with the address and the output of
  `node bin/stv-verify.mjs <address> --json`. If the verifier gets it wrong, that is a bug.
- **Registry updates.** Never edit `data/stock-tokens.snapshot.json` by hand. Run
  `node scripts/rebuild-registry.mjs --rebuild --out data/stock-tokens.snapshot.json` and paste the
  printed summary into the pull request. A rebuild with any disagreement between the bytecode test
  and the creator test is not merged until the disagreement is explained. The counts in the snapshot
  file update themselves; the selection narrative does not — update `AUTHENTICITY.method` in
  `src/registry.js` and the "How the registry was built" section of the README in the same pull request.
- **Bug fixes and tests.**

Out of scope: price feeds, trading, portfolio features, other chains.

## Ground rules

1. **No dependencies.** The package runs from a fresh clone with no install step.
2. **Tests run offline.** `npm test` must pass with no external network (loopback only); checks against the real chain
   belong in `test/live.test.mjs`, behind `STV_LIVE=1`. On Linux you can prove it:
   `unshare -rn sh -c 'ip link set lo up && npm test'`.
3. **Be gentle with public nodes.** Keep batches at 8 calls or fewer with a pause between them; do not
   add `eth_getLogs` scans against public endpoints.
4. **Say how every number was obtained.** Each figure in a response carries its method, period and
   source. Chain metrics are never mixed with brokerage metrics.
5. **Names.** The assets are "Stock Tokens" — no other term for them, in any language — the chain
   is "Robinhood Chain", never abbreviated or replaced by an informal or unofficial variant of the
   name, and the issuer's stock ticker is not used. See DATA.md.
6. **Honest failures.** An unreachable source is a 503 or an `unreadable` verdict, never an empty
   success.
7. **English only**, in code, comments, docs and commit messages.

Before opening a pull request:

```sh
npm test
npm run check    # pre-publication check: no private paths, credentials or forbidden wording
```

Rules about your own environment (host names, directory names, ticket numbers) do not belong in the
public check: put them in a JSON file outside the repository and run
`CHECK_CLEAN_EXTRA=/path/to/rules.json npm run check`. The format is described at the top of
`scripts/check-clean.mjs`.

## Security

Please report vulnerabilities privately through the repository's security advisory feature rather
than in a public issue.
