#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// Check whether an address on Robinhood Chain is a genuine Stock Token.
//
//   node bin/stv-verify.mjs <address> [--json] [--deployer] [--explorer <url>] [--rpc <url>[,<url>…]]
//
// Exit code 1 means "counterfeit" and nothing else, so scripts can rely on it: a usage error exits
// 64, and any other failure of this program exits 70 — never 1.

const EXIT = { authentic: 0, counterfeit: 1, unlisted: 2, none: 3, unreadable: 4 };
const EXIT_USAGE = 64;
const EXIT_INTERNAL = 70;

const USAGE = 'usage: stv-verify <address> [--json] [--deployer] [--explorer <url>] [--rpc <url>[,<url>...]]';
const HELP = `${USAGE}

Checks whether <address> on Robinhood Chain (chain id 4663) is a genuine Stock Token, from chain
state read in one JSON-RPC batch at the latest block.

options:
  --json              print the full result as JSON
  --deployer          also look up the contract creator in the chain explorer (reported, never
                      changes the verdict)
  --explorer <url>    Blockscout v2 instance for --deployer (default: the public explorer of the chain)
  --rpc <url>[,...]   JSON-RPC endpoints to use, in order of preference (default: STV_RPC_URLS,
                      then the built-in public endpoints)
  -h, --help          show this help

environment:
  STV_RPC_URLS        comma-separated JSON-RPC endpoints tried before the built-in public ones

exit codes:
  0   authentic     listed in the registry and the live bytecode matches the reference
  1   counterfeit   calls itself a Stock Token but is not one
  2   unlisted      reference bytecode, but not in the registry snapshot
  3   none          does not call itself a Stock Token
  4   unreadable    the bytecode could not be read; nothing was checked
  64  usage error
  70  internal error; nothing was concluded`;

class UsageError extends Error {}

const FLAGS = new Set(['--json', '--deployer', '--help', '-h']);
const OPTIONS = new Set(['--rpc', '--explorer']);

function parseArgs(argv) {
  const flags = new Set();
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (OPTIONS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value === '' || value.startsWith('-')) throw new UsageError(`${arg} needs a value`);
      options[arg] = value;
      i += 1;
    } else if (FLAGS.has(arg)) {
      flags.add(arg === '-h' ? '--help' : arg);
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  return { flags, options, positional };
}

// The multiplier printed exactly from its raw 18-decimal integer, not through a float.
const exact = (raw) => { const s = String(raw).padStart(19, '0'); return `${s.slice(0, -18)}.${s.slice(-18)}`.replace(/\.?0+$/, ''); };

async function main(argv) {
  const { flags, options, positional } = parseArgs(argv);
  if (flags.has('--help')) { console.log(HELP); return 0; }

  // Loaded inside the error boundary: a broken checkout must exit 70, not 1.
  const [{ EXPLORER, rpcUrlsFromEnv }, { AUTHENTICITY, SNAPSHOT_DATE }, { createRpc }, { isAddress, verifyAddress }] = await Promise.all([
    import('../src/chain.js'), import('../src/registry.js'), import('../src/rpc.js'), import('../src/verify.js'),
  ]);

  if (positional.length !== 1) throw new UsageError(positional.length ? 'exactly one address, please' : 'an address is required');
  const [address] = positional;
  if (!isAddress(address)) throw new UsageError(`not an EVM address: ${address.slice(0, 60)}`);
  const urls = options['--rpc'] ? options['--rpc'].split(',').map((s) => s.trim()).filter(Boolean) : rpcUrlsFromEnv();
  if (!urls.length) throw new UsageError('--rpc lists no endpoint');

  const result = await verifyAddress(address, {
    rpc: createRpc({ urls }), withDeployer: flags.has('--deployer'), explorer: options['--explorer'] || EXPLORER,
  });

  if (flags.has('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return EXIT[result.verdict] ?? EXIT_INTERNAL;
  }

  const line = (label, value) => console.log(`  ${label.padEnd(15)} ${value}`);
  // What the contract says about itself: its own symbol and name, never the registry's company name.
  const own = [result.symbol, result.name && `(${result.name})`].filter(Boolean).join(' ') || 'no symbol and no name';
  const headline = {
    authentic: `AUTHENTIC Stock Token — ${result.symbol} (${result.underlying})`,
    counterfeit: `COUNTERFEIT — claims to be ${own}, but is not a Robinhood Stock Token`,
    unlisted: `UNLISTED — reference bytecode, but not in the ${SNAPSHOT_DATE} registry`,
    none: 'NOT A STOCK TOKEN — the contract does not call itself a Stock Token',
    unreadable: `UNREADABLE — nothing was checked (${result.error || result.reason || 'no bytecode'})`,
  }[result.verdict];
  console.log(`${result.address} on Robinhood Chain (${result.chainId})${result.block ? `, block ${result.block}` : ''}`);
  console.log(`Verdict: ${headline}`);
  if (result.verdict !== 'unreadable') {
    line('name', result.name ?? 'no answer');
    line('bytecode hash', `${result.codeHash} ${result.codeMatch ? 'matches the reference' : `differs from the reference ${result.expectedCodeHash}`}`);
    line('registry', result.listed ? `listed (snapshot ${SNAPSHOT_DATE}, ${AUTHENTICITY.genuine} genuine)` : 'not listed');
    line('uiMultiplier', result.multiplierRaw === null ? 'no answer (the call reverts)' : `${exact(result.multiplierRaw)}${result.multiplierRaw === '1000000000000000000' ? ' (no corporate action yet)' : ' (corporate action applied)'}`);
    if (result.deployerChecked) line('creator', `${result.deployer} ${result.deployerMatch ? 'is the Stock Token deployer' : 'is NOT the Stock Token deployer'}`);
    else if (result.deployerError) line('creator', `not checked: ${result.deployerError}`);
    else line('creator', 'not checked (pass --deployer; needs access to the chain explorer)');
    if (result.genuineAddress) line('genuine token', `the real ${result.sharesTickerWith[0]?.symbol ?? result.symbol} lives at ${result.genuineAddress}`);
    else for (const twin of result.sharesTickerWith) line('shared ticker', `${twin.symbol} is also the ticker of the Stock Token at ${twin.address} (${twin.underlying}); a shared ticker is not a claim`);
  }
  return EXIT[result.verdict] ?? EXIT_INTERNAL;
}

function fail(error) {
  if (error instanceof UsageError) {
    console.error(`stv-verify: ${error.message}\n${USAGE}`);
    process.exit(EXIT_USAGE);
  }
  console.error(`stv-verify: internal error, nothing was concluded: ${String(error?.message || error).slice(0, 300)}`);
  process.exit(EXIT_INTERNAL);
}

process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
main(process.argv.slice(2)).then((code) => process.exit(code), fail);
