// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// Client for the keyed Binance Web3 API (base https://web3.binance.com/build).
//
// Signing: X-OC-SIGN = Base64(HMAC-SHA256(timestamp + METHOD + requestPath + body, secretKey)), where
// requestPath is the FULL path including the /build prefix plus the exact query string that is sent,
// and the body of a GET is "". X-OC-TIMESTAMP is ISO 8601 with milliseconds. Leaving /build out of
// the signed path is the usual cause of 40102.
//
// Pace: the API allows 1 200 requests per 60 s per IP and per key, and 5 per second per endpoint.
// This client stays below both: at least 250 ms between two requests to the same endpoint and 60 ms
// between any two requests. HTTP 429 is retried after Retry-After (capped), at most twice.
//
// Failures are explicit: every non-success answer becomes a BinanceApiError with the HTTP status, the
// API code and message, and a kind (auth, signature, permission, rate_limited, rfq, api, schema,
// network). An answer whose shape does not match what the caller expects is a schema error, never an
// empty success. The key and secret are never logged, printed or stored in a result: the request log
// keeps time, endpoint, HTTP status, code and message only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { inspect } from 'node:util';
import { CHAIN_ID } from './chain.js';

export const W3_ORIGIN = 'https://web3.binance.com';
export const W3_PREFIX = '/build';
export const USER_AGENT = 'stock-token-verifier/0.2 (+https://github.com/BonyNode/stock-token-verifier)';

export const W3_ENDPOINTS = Object.freeze({
  rwaTokens: { method: 'GET', path: '/api/v1/dex/market/rwa/tokens', source: 'binance-w3:rwa-tokens' },
  rwaPrice: { method: 'GET', path: '/api/v1/dex/market/rwa/price', source: 'binance-w3:rwa-price' },
  rwaPlatforms: { method: 'GET', path: '/api/v1/dex/market/rwa/platforms', source: 'binance-w3:rwa-platforms' },
  basicInfo: { method: 'POST', path: '/api/v1/dex/market/token/basic-info', source: 'binance-w3:basic-info' },
  tokenSearch: { method: 'GET', path: '/api/v1/dex/market/token/search', source: 'binance-w3:token-search' },
  topLiquidity: { method: 'GET', path: '/api/v1/dex/market/token/top-liquidity', source: 'binance-w3:top-liquidity' },
  quote: { method: 'GET', path: '/api/v1/dex/aggregator/quote', source: 'binance-w3:quote' },
});

/** RFQ refusals on equity routes: answers about the market, recorded as data. */
export const RFQ_CODES = Object.freeze({
  40367: 'ONDO_MARKET_STATE_NOT_TRADABLE',
  40368: 'the RWA token must be paired with USDT on BSC',
  40369: 'BSTOCK_INVALID_TRADING_TIME',
  40374: 'RWA_INSUFFICIENT_LIQUIDITY',
  40375: 'below the minimum order of 20 USD',
});

const KIND_BY_CODE = Object.freeze({ 40101: 'auth', 40102: 'signature', 40104: 'permission' });
const HINT_BY_KIND = Object.freeze({
  auth: 'the API key is missing or unknown',
  signature: 'the signature does not match: the signed path must include the /build prefix and the exact query string sent',
  permission: 'the key lacks a permission domain: enable Market and Trading for this key',
});

export class BinanceApiError extends Error {
  constructor(message, { kind = 'api', http = null, code = null, endpoint = null } = {}) {
    super(message);
    this.name = 'BinanceApiError';
    this.kind = kind;
    this.http = http;
    this.code = code;
    this.endpoint = endpoint;
  }

  /** Errors that make every further request pointless: stop the run instead of burning the quota. */
  get fatal() { return ['auth', 'signature', 'permission'].includes(this.kind); }
}

/** A credentials holder whose key and secret are not enumerable: JSON, console and inspect show nothing. */
function credentialsObject(apiKey, secretKey) {
  const out = { ok: true };
  Object.defineProperty(out, 'apiKey', { value: apiKey, enumerable: false });
  Object.defineProperty(out, 'secretKey', { value: secretKey, enumerable: false });
  Object.defineProperty(out, 'toJSON', { value: () => ({ ok: true, key: '[redacted]' }), enumerable: false });
  Object.defineProperty(out, inspect.custom, { value: () => '{ ok: true, key: [redacted] }', enumerable: false });
  return Object.freeze(out);
}

/**
 * Credentials from BINANCE_W3_API_KEY / BINANCE_W3_SECRET_KEY, or from a KEY=VALUE file named by
 * BINANCE_W3_ENV_FILE. Read lazily, only when a caller asks; the values never leave the returned
 * object. Without them: { ok: false, reason } with reason no_api_key, key_file_missing or
 * key_file_unreadable — never the file content.
 */
export function loadCredentials({ env = process.env, file = env.BINANCE_W3_ENV_FILE, readFile = fs.readFileSync } = {}) {
  let keyId = env.BINANCE_W3_API_KEY || null;
  let keySecret = env.BINANCE_W3_SECRET_KEY || null;
  if ((!keyId || !keySecret) && file) {
    let text;
    try { text = readFile(file, 'utf8'); } catch (error) { return { ok: false, reason: error?.code === 'ENOENT' ? 'key_file_missing' : 'key_file_unreadable' }; }
    for (const line of String(text).split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?(BINANCE_W3_API_KEY|BINANCE_W3_SECRET_KEY)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (m[1] === 'BINANCE_W3_API_KEY' && !keyId) keyId = value;
      if (m[1] === 'BINANCE_W3_SECRET_KEY' && !keySecret) keySecret = value;
    }
  }
  if (!keyId || !keySecret) return { ok: false, reason: 'no_api_key' };
  return credentialsObject(keyId, keySecret);
}

/** Base64(HMAC-SHA256(timestamp + METHOD + requestPath + body, secretKey)). */
export function signRequest({ secretKey, timestamp, method, requestPath, body = '' }) {
  return crypto.createHmac('sha256', String(secretKey)).update(`${timestamp}${String(method).toUpperCase()}${requestPath}${body}`).digest('base64');
}

/**
 * The query string exactly as it is sent AND signed: parameters in the given order, values
 * percent-encoded except the comma, which separates list values (tokenContractAddresses=a,b,c).
 */
export function encodeQuery(query = {}) {
  return Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v)).replace(/%2C/gi, ',')}`)
    .join('&');
}

/** The path that is both requested and signed: /build + endpoint path + ?query. */
export const requestPathOf = (path, query) => { const qs = encodeQuery(query); return `${W3_PREFIX}${path}${qs ? `?${qs}` : ''}`; };

function retryAfterMs(value, nowMs) {
  if (value == null || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - nowMs);
}

function errorFor(json, http, endpoint) {
  const code = json?.code == null ? null : Number(json.code);
  const msg = String(json?.msg ?? json?.message ?? '').slice(0, 200);
  let kind = KIND_BY_CODE[code] || (RFQ_CODES[code] ? 'rfq' : (http === 429 ? 'rate_limited' : 'api'));
  if (http === 401 && kind === 'api') kind = 'auth';
  const hint = HINT_BY_KIND[kind] ? ` (${HINT_BY_KIND[kind]})` : '';
  return new BinanceApiError(`HTTP ${http}, code ${code ?? 'none'}: ${msg || 'no message'}${hint}`, { kind, http, code, endpoint });
}

const isSuccess = (http, json) => http >= 200 && http < 300
  && (json.code === 0 || json.code === '0' || json.code === '000000' || (json.code === undefined && json.success === true));

/**
 * @param {object} options
 * @param {object} options.credentials   from loadCredentials()
 * @param {Function} [options.fetchImpl]
 * @param {Function} [options.now]        ms clock (tests inject one)
 * @param {Function} [options.sleep]
 */
export function createBinanceWeb3({
  credentials, fetchImpl = globalThis.fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => { setTimeout(r, ms); }),
  recvWindow = 5000, endpointGapMs = 250, globalGapMs = 60, maxRetries = 2, timeoutMs = 20_000, maxRetryWaitMs = 30_000,
} = {}) {
  if (!credentials?.ok) throw new BinanceApiError('no Binance Web3 API key: set BINANCE_W3_ENV_FILE or BINANCE_W3_API_KEY and BINANCE_W3_SECRET_KEY', { kind: 'auth' });
  const { apiKey, secretKey } = credentials;
  const lastByPath = new Map();
  let lastAny = 0;
  const log = [];
  const counts = {};

  async function pace(path) {
    const t = now();
    const wait = Math.max(0, (lastByPath.get(path) ?? -Infinity) + endpointGapMs - t, lastAny + globalGapMs - t);
    if (wait > 0) await sleep(wait);
    const at = now();
    lastByPath.set(path, at);
    lastAny = at;
  }

  /** One API call → the `data` of a success answer; anything else throws a BinanceApiError. */
  async function request(name, { query = {}, body = null } = {}) {
    const ep = W3_ENDPOINTS[name];
    if (!ep) throw new TypeError(`unknown endpoint ${name}`);
    const requestPath = requestPathOf(ep.path, query);
    const bodyText = ep.method === 'GET' ? '' : JSON.stringify(body ?? {});
    for (let attempt = 0; ; attempt += 1) {
      await pace(ep.path);
      const timestamp = new Date(now()).toISOString();
      const headers = {
        'X-OC-APIKEY': apiKey,
        'X-OC-TIMESTAMP': timestamp,
        'X-OC-SIGN': signRequest({ secretKey, timestamp, method: ep.method, requestPath, body: bodyText }),
        'X-OC-RECV-WINDOW': String(recvWindow),
        accept: 'application/json',
        'user-agent': USER_AGENT,
        ...(ep.method === 'GET' ? {} : { 'content-type': 'application/json' }),
      };
      counts[ep.source] = (counts[ep.source] || 0) + 1;
      const entry = { at: timestamp, method: ep.method, endpoint: ep.path, http: null, code: null, msg: null, ms: null };
      log.push(entry);
      const started = now();
      let response;
      try {
        response = await fetchImpl(`${W3_ORIGIN}${requestPath}`, { method: ep.method, headers, ...(ep.method === 'GET' ? {} : { body: bodyText }), signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        entry.msg = `network: ${String(error?.message || error).slice(0, 120)}`;
        throw new BinanceApiError(`network error: ${String(error?.message || error).slice(0, 160)}`, { kind: 'network', endpoint: ep.path });
      }
      entry.http = response.status;
      entry.ms = now() - started;
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* handled below */ }
      entry.code = json?.code ?? null;
      entry.msg = json ? String(json.msg ?? json.message ?? '').slice(0, 160) || null : `non-JSON answer (${text.length} bytes)`;
      if (response.status === 429) {
        if (attempt < maxRetries) {
          const wait = retryAfterMs(response.headers?.get?.('retry-after'), now()) ?? 1000 * (attempt + 1);
          await sleep(Math.min(wait, maxRetryWaitMs));
          continue;
        }
        throw new BinanceApiError(`HTTP 429 after ${attempt + 1} attempts: rate limited`, { kind: 'rate_limited', http: 429, code: json?.code ?? null, endpoint: ep.path });
      }
      if (!json || typeof json !== 'object') {
        throw new BinanceApiError(`HTTP ${response.status}: the answer is not JSON`, { kind: response.ok ? 'schema' : 'api', http: response.status, endpoint: ep.path });
      }
      if (!isSuccess(response.status, json)) throw errorFor(json, response.status, ep.path);
      if (!('data' in json)) throw new BinanceApiError(`HTTP ${response.status}: success answer without a data field`, { kind: 'schema', http: response.status, endpoint: ep.path });
      return json.data;
    }
  }

  return { request, log, counts, get requests() { return log.length; } };
}

// ── Response readers ────────────────────────────────────────────────────────────────────────────
// The documented field names were read through a summary of the documentation, not byte-verified;
// each reader therefore checks the fields it relies on and throws a schema error naming the keys it
// saw (never values) when they are absent.

/** A list from `data`: the array itself, or the first array under a usual wrapper key. */
export function asList(data, endpoint) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['list', 'tokens', 'items', 'rows', 'data', 'result', 'records']) if (Array.isArray(data[key])) return data[key];
  }
  throw new BinanceApiError(`${endpoint}: expected a list, got ${data === null ? 'null' : typeof data} with keys ${Object.keys(data || {}).slice(0, 12).join(',') || 'none'}`, { kind: 'schema', endpoint });
}

const addr = (v) => (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : null);
const str = (v) => (v === undefined || v === null || v === '' ? null : String(v));
const pick = (obj, ...keys) => { for (const k of keys) if (obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== '') return obj[k]; return null; };

function requireField(rows, field, endpoint) {
  if (rows.length && !rows.some((r) => r && typeof r === 'object' && field in r)) {
    throw new BinanceApiError(`${endpoint}: no row has the field ${field}; keys seen: ${Object.keys(rows[0] || {}).slice(0, 20).join(',')}`, { kind: 'schema', endpoint });
  }
}

/** rwa/tokens rows → normalised entries. */
export function readRwaTokens(data) {
  const ep = W3_ENDPOINTS.rwaTokens.path;
  const rows = asList(data, ep);
  requireField(rows, 'tokenContractAddress', ep);
  return rows.map((r) => ({
    address: addr(r.tokenContractAddress),
    platformId: str(r.platformId),
    symbol: str(r.tokenSymbol),
    decimals: r.decimals == null ? null : Number(r.decimals),
    underlyingTicker: str(r.underlyingTicker),
    tokenToShareRatio: str(r.tokenToShareRatio),
    tokenPrice: str(r.tokenPrice),
    referencePrice: str(r.referencePrice),
    volume24H: str(r.volume24H),
    marketCap: str(r.marketCap),
    status: r.statusInfo && typeof r.statusInfo === 'object' ? {
      openState: typeof r.statusInfo.openState === 'boolean' ? r.statusInfo.openState : null,
      marketStatus: str(r.statusInfo.marketStatus),
      reasonCode: str(r.statusInfo.reasonCode),
      nextOpenTime: r.statusInfo.nextOpenTime ?? null,
      nextCloseTime: r.statusInfo.nextCloseTime ?? null,
    } : null,
  })).filter((r) => r.address);
}

/** rwa/price rows → { address, tokenPrice, referencePrice, tokenPriceUpdatedAt }. */
export function readRwaPrice(data) {
  const ep = W3_ENDPOINTS.rwaPrice.path;
  const rows = asList(data, ep);
  requireField(rows, 'tokenContractAddress', ep);
  return rows.map((r) => ({
    address: addr(r.tokenContractAddress),
    tokenPrice: str(r.tokenPrice),
    referencePrice: str(r.referencePrice),
    tokenPriceUpdatedAt: r.tokenPriceUpdatedAt ?? null,
  })).filter((r) => r.address);
}

/**
 * token/basic-info → [{ address, creator, createTime, isRecognized }]. Measured 2026-10-09: the API
 * takes binanceChainId and ONE tokenContractAddress in the query of the POST (a body is ignored) and
 * answers one object; a comma-separated list answers code 0 with data null.
 */
export function readBasicInfo(data) {
  const ep = W3_ENDPOINTS.basicInfo.path;
  if (data === null) return [];
  const rows = Array.isArray(data) ? data : (data && typeof data === 'object' && 'tokenContractAddress' in data ? [data] : asList(data, ep));
  requireField(rows, 'tokenContractAddress', ep);
  return rows.map((r) => ({
    address: addr(r.tokenContractAddress),
    creator: addr(pick(r, 'creatorAddress', 'creator')),
    createTime: r.createTime ?? null,
    isRecognized: typeof r?.tagList?.isRecognized === 'boolean' ? r.tagList.isRecognized : null,
  })).filter((r) => r.address);
}

/** token/search rows → { address, symbol, name, liquidityUsd, holders }. */
export function readTokenSearch(data) {
  const ep = W3_ENDPOINTS.tokenSearch.path;
  const rows = asList(data, ep);
  requireField(rows, 'tokenContractAddress', ep);
  return rows.filter((r) => String(pick(r, 'binanceChainId', 'chainId', 'chainIndex') ?? CHAIN_ID) === String(CHAIN_ID)).map((r) => ({
    address: addr(r.tokenContractAddress),
    symbol: str(pick(r, 'tokenSymbol', 'symbol')),
    name: str(pick(r, 'tokenName', 'name')),
    liquidityUsd: str(pick(r, 'liquidity', 'liquidityUsd')),
    holders: str(pick(r, 'holders', 'holderCount')),
    launchPlatform: null,
    isRecognized: typeof r?.tagList?.isRecognized === 'boolean' ? r.tagList.isRecognized : null,
  })).filter((r) => r.address);
}

/** top-liquidity rows → pools. */
export function readTopLiquidity(data) {
  const ep = W3_ENDPOINTS.topLiquidity.path;
  const rows = data === null || (Array.isArray(data) && data.length === 0) ? [] : asList(data, ep);
  return rows.map((r) => ({
    protocolName: str(pick(r, 'protocolName', 'dexName')),
    poolAddress: addr(pick(r, 'poolAddress', 'pool')) ?? str(pick(r, 'poolAddress', 'pool')),
    liquidityUsd: str(pick(r, 'liquidityUsd', 'liquidity')),
  }));
}

/** aggregator/quote → the fields the market section keeps. */
export function readQuote(data) {
  const ep = W3_ENDPOINTS.quote.path;
  const q = Array.isArray(data) ? data[0] : data;
  if (!q || typeof q !== 'object' || !('toTokenAmount' in q)) {
    throw new BinanceApiError(`${ep}: no toTokenAmount in the answer; keys seen: ${Object.keys(q || {}).slice(0, 20).join(',') || 'none'}`, { kind: 'schema', endpoint: ep });
  }
  const routes = Array.isArray(q.dexRouterList) ? q.dexRouterList : [];
  const dexes = [...new Set(routes.flatMap((r) => {
    const names = [pick(r, 'dexName', 'protocolName')];
    for (const sub of [r?.subRouterList, r?.dexProtocol].flat().filter(Boolean)) names.push(pick(sub, 'dexName', 'protocolName'));
    return names;
  }).filter(Boolean).map(String))];
  return {
    vendorName: str(q.vendorName),
    executionMode: str(q.executionMode),
    tradeFee: str(q.tradeFee),
    toTokenAmount: str(q.toTokenAmount),
    fromTokenAmount: str(q.fromTokenAmount),
    priceImpactPercent: str(pick(q, 'priceImpactPercent', 'priceImpactPercentage')),
    dexes,
    isHoneyPot: typeof q?.toToken?.isHoneyPot === 'boolean' ? q.toToken.isHoneyPot : null,
    taxRate: str(q?.toToken?.taxRate),
    toTokenDecimals: q?.toToken?.decimal != null ? Number(q.toToken.decimal) : (q?.toToken?.decimals != null ? Number(q.toToken.decimals) : null),
  };
}
