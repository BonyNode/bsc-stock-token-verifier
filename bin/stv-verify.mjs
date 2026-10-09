#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// Stock-linked tokens on BNB Smart Chain (bStocks, Ondo Stocks, xStocks): is this contract genuine?
//
//   stv-verify <address> [--json] [--rpc <url>[,<url>…]] [--snapshot <file>]
//   stv-verify scan [--out <file>] [--html <file> | --no-html] [--lookalikes binance|all|none]
//                   [--no-market] [--no-key] [--cache <file> | --fresh] [--rpc <url>[,…]]
//   stv-verify report [--snapshot <file>] [--out <file>]
//
// Exit codes of the single check: 0 genuine · 1 look-alike · 2 unknown · 3 none · 4 nothing could
// be read · 64 usage error · 70 internal error. Exit code 1 means "look-alike" and nothing else.

const EXIT = { genuine: 0, 'look-alike': 1, unknown: 2, none: 3 };
const EXIT_UNREAD = 4;
const EXIT_USAGE = 64;
const EXIT_INTERNAL = 70;

const USAGE = `usage: stv-verify <address> [--json] [--rpc <url>[,<url>...]] [--snapshot <file>]
       stv-verify scan [--out <file>] [--html <file> | --no-html] [--lookalikes binance|all|none]
                       [--no-market] [--no-key] [--cache <file> | --fresh] [--rpc <url>[,<url>...]]
       stv-verify report [--snapshot <file>] [--out <file>]`;

const HELP = `${USAGE}

Checks stock-linked tokens on BNB Smart Chain (chain id 56): bStocks, Ondo Stocks and xStocks.
A contract is genuine when the family's issuer list has its address AND its runtime code hash and
its EIP-1967 beacon/admin slot match the rule measured on all issuer-listed contracts.

single check (no key needed):
  <address>            live verdict for one contract, from chain state and the snapshot lists
  --json               print the full result as JSON
  --snapshot <file>    lists and rules to use (default: data/snapshot.json)

scan (writes the JSON snapshot, the primary output, and the HTML report):
  --out <file>         snapshot path (default: data/snapshot.json)
  --html <file>        report path (default: report/index.html); --no-html to skip
  --lookalikes <scope> searches: binance (tickers Binance lists, default), all (every ticker), none
  --no-market          skip the market sample (pools and aggregator quotes)
  --no-key             run without the Binance Web3 API key even if one is configured
  --cache <file>       on-chain fact cache (default: .cache/onchain.jsonl); --fresh ignores it

report:
  --snapshot <file>    snapshot to render (default: data/snapshot.json)
  --out <file>         report path (default: report/index.html)

common:
  --rpc <url>[,...]    JSON-RPC endpoints (default: STV_RPC_URLS, then built-in public endpoints)
  -h, --help           show this help

environment:
  BINANCE_W3_ENV_FILE  file with BINANCE_W3_API_KEY= and BINANCE_W3_SECRET_KEY= lines (read only
                       by the scan, never printed); or set the two variables directly
  STV_RPC_URLS         comma-separated JSON-RPC endpoints tried before the built-in ones

exit codes of the single check:
  0 genuine · 1 look-alike · 2 unknown · 3 none (no family claim) · 4 nothing could be read
  64 usage error · 70 internal error; nothing was concluded`;

class UsageError extends Error {}

const FLAGS = new Set(['--json', '--help', '-h', '--no-html', '--no-market', '--no-key', '--fresh']);
const OPTIONS = new Set(['--rpc', '--snapshot', '--out', '--html', '--lookalikes', '--cache']);

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
    } else if (FLAGS.has(arg)) flags.add(arg === '-h' ? '--help' : arg);
    else if (arg.startsWith('-')) throw new UsageError(`unknown option ${arg}`);
    else positional.push(arg);
  }
  return { flags, options, positional };
}

const say = (line) => process.stderr.write(`${line}\n`);

async function gitCommit() {
  const { execFileSync } = await import('node:child_process');
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; } catch { return null; }
}

async function runVerify({ flags, options, positional }, mods) {
  const [address] = positional;
  if (!mods.onchain.isAddress(address)) throw new UsageError(`not an EVM address: ${address.slice(0, 60)}`);
  const snapshot = mods.snapshot.readSnapshot(options['--snapshot'] || mods.snapshot.DEFAULT_SNAPSHOT);
  const result = await mods.verify.verifyAddress(address, { rpc: mods.rpc.createRpc({ urls: mods.urls }), snapshot });
  const code = result.reason === 'rpc_unavailable' ? EXIT_UNREAD : (EXIT[result.verdict] ?? EXIT_INTERNAL);
  if (flags.has('--json')) { console.log(JSON.stringify(result, null, 2)); return code; }
  const label = { bstocks: 'bStocks', ondo: 'Ondo Stocks', xstocks: 'xStocks' };
  const own = [result.symbol, result.name && `(${result.name})`].filter(Boolean).join(' ') || 'no symbol and no name';
  const headline = {
    genuine: `GENUINE ${label[result.family]} ${result.role === 'wrapper' ? 'ERC-4626 wrapper' : 'contract'} — ${own}`,
    'look-alike': `LOOK-ALIKE — claims to be ${own}, a ${label[result.family]} symbol/name, but is not the issuer's contract`,
    unknown: result.reason === 'rpc_unavailable' ? `UNKNOWN — nothing could be read (${result.error})` : `UNKNOWN — ${result.explanation}`,
    none: `NONE — ${own} makes no bStocks, Ondo or xStocks claim`,
  }[result.verdict];
  const line = (k, v) => console.log(`  ${k.padEnd(15)} ${v}`);
  console.log(`${result.address} on BNB Smart Chain (56)${result.block ? `, block ${result.block}` : ''}`);
  console.log(`Verdict: ${headline}`);
  if (result.reason !== 'rpc_unavailable') {
    line('reasons', result.reasons.join(', '));
    line('code', result.codeSize === 0 ? 'no contract code' : `${result.codeSize} bytes, keccak256 ${result.codeHash}`);
    if (result.expected?.codeHash) line('family rule', `${result.expected.codeHash} + ${result.expected.slot} ${result.expected.slotValue}`);
    if (result.beacon) line('beacon', result.beacon);
    if (result.admin) line('admin', result.admin);
    if (result.implementation) line('implementation', result.implementation);
    line('lists', result.listedBy.length ? result.listedBy.join(', ') : 'on no list');
    if (result.genuineAddress) line('genuine', `the issuer's ${result.claim.genuineSymbol} lives at ${result.genuineAddress}`);
    if (result.sharedTicker) line('shared ticker', `${result.sharedTicker.ticker} is also the underlying of ${result.sharedTicker.symbol} at ${result.sharedTicker.address}; a shared ticker is not a claim`);
  }
  console.log(`  ${'snapshot'.padEnd(15)} ${result.snapshotGeneratedAt}`);
  console.log('  Information only, not investment advice. Not affiliated with Binance, Ondo or Backed.');
  return code;
}

async function runScanCommand({ flags, options }, mods) {
  const { loadCredentials, createBinanceWeb3 } = mods.w3;
  let w3 = null;
  let w3Reason = 'disabled';
  if (!flags.has('--no-key')) {
    const credentials = loadCredentials();
    if (credentials.ok) w3 = createBinanceWeb3({ credentials });
    else w3Reason = credentials.reason;
  }
  say(`scan: Binance Web3 API ${w3 ? 'key present' : `not used (${w3Reason})`}`);
  const cacheFile = flags.has('--fresh') ? null : (options['--cache'] || new URL('../.cache/onchain.jsonl', import.meta.url).pathname);
  const scope = options['--lookalikes'] || 'binance';
  if (!['binance', 'all', 'none'].includes(scope)) throw new UsageError('--lookalikes takes binance, all or none');
  const { snapshot, fatal } = await mods.scan.runScan({
    rpc: mods.rpc.createRpc({ urls: mods.urls }), pub: mods.pub.createBinancePublic(), w3, w3Reason,
    cacheFile, lookalikeScope: scope, market: !flags.has('--no-market'), say, gitCommit: await gitCommit(),
  });
  const out = mods.snapshot.writeSnapshot(options['--out'] || mods.snapshot.DEFAULT_SNAPSHOT, snapshot);
  say(`snapshot written: ${out}`);
  if (!flags.has('--no-html')) {
    const html = options['--html'] || new URL('../report/index.html', import.meta.url).pathname;
    mods.report.writeReport(html, snapshot);
    say(`report written: ${html}`);
  }
  for (const [family, c] of Object.entries(snapshot.summary.families)) {
    say(`  ${family.padEnd(8)} listed ${c.listed}, genuine ${c.genuine}, unknown ${c.unknown}, no code ${c.noCode}, look-alikes ${c.lookalikes}${snapshot.summary.lookalikes.lowerBound ? ' (lower bound)' : ''}`);
  }
  if (fatal) say(`Binance Web3 API stopped the keyed part: ${fatal.kind} — ${fatal.message}`);
  return 0;
}

async function runReport({ options }, mods) {
  const snapshot = mods.snapshot.readSnapshot(options['--snapshot'] || mods.snapshot.DEFAULT_SNAPSHOT);
  const out = options['--out'] || new URL('../report/index.html', import.meta.url).pathname;
  mods.report.writeReport(out, snapshot);
  say(`report written: ${out}`);
  return 0;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.flags.has('--help')) { console.log(HELP); return 0; }
  // Loaded inside the error boundary: a broken checkout must exit 70, not 1.
  const [chain, rpc, onchain, snapshot, verify, scan, report, w3, pub] = await Promise.all([
    import('../src/chain.js'), import('../src/rpc.js'), import('../src/onchain.js'), import('../src/snapshot.js'),
    import('../src/verify.js'), import('../src/scan.js'), import('../src/report.js'), import('../src/binance-web3.js'), import('../src/binance-public.js'),
  ]);
  const urls = args.options['--rpc'] ? args.options['--rpc'].split(',').map((s) => s.trim()).filter(Boolean) : chain.rpcUrlsFromEnv();
  if (!urls.length) throw new UsageError('--rpc lists no endpoint');
  const mods = { chain, rpc, onchain, snapshot, verify, scan, report, w3, pub, urls };
  const [command] = args.positional;
  if (command === 'scan' || command === 'report') {
    if (args.positional.length !== 1) throw new UsageError(`${command} takes no positional argument`);
    return command === 'scan' ? runScanCommand(args, mods) : runReport(args, mods);
  }
  if (args.positional.length !== 1) throw new UsageError(args.positional.length ? 'exactly one address, please' : 'an address, scan or report is required');
  return runVerify(args, mods);
}

function fail(error) {
  if (error instanceof UsageError) {
    console.error(`stv-verify: ${error.message}\n${USAGE}`);
    process.exit(EXIT_USAGE);
  }
  console.error(`stv-verify: internal error, nothing was concluded: ${String(error?.message || error).replace(/\b([a-z][a-z0-9+.-]*):\/\/(?:[^\s/?#]*@)?([^\s/?#)]+)[^\s)]*/gi, '$1://$2').slice(0, 300)}`);
  process.exit(EXIT_INTERNAL);
}

process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
main(process.argv.slice(2)).then((code) => process.exit(code), fail);
