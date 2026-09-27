// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// Live check of one address: reads the facts from the chain in ONE batch of six calls, then hands
// them to the pure verdict. Optionally asks the chain explorer for the contract creator.
import { CHAIN_ID, EXPLORER } from './chain.js';
import { hexToBytes, keccak256Hex, selector } from './keccak.js';
import { assertChainId, createRpc, hexToNumber, hideUrlSecrets } from './rpc.js';
import { stockTokenVerdict } from './verdict.js';

export const SEL = Object.freeze({
  uiMultiplier: selector('uiMultiplier()'), // 0xa60bf13d
  symbol: selector('symbol()'),             // 0x95d89b41
  name: selector('name()'),                 // 0x06fdde03
});

export const isAddress = (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);

/** Whole bytes of 0x-hex: an odd digit count is malformed, not something to hash or decode. */
const isHexBytes = (value) => typeof value === 'string' && /^0x(?:[0-9a-f]{2})*$/i.test(value);

/**
 * ABI-decode a `string` return value (or a legacy bytes32 one). Anything malformed → null.
 * The string comes back whole, up to 256 bytes: the Stock Token claim is the END of name(), and a
 * shortened name would hide it (the genuine SPCX name alone is 77 bytes).
 */
export function decodeAbiString(hex) {
  if (!isHexBytes(hex) || hex.length < 66) return null;
  const bytes = hexToBytes(hex);
  const text = (slice) => new TextDecoder().decode(slice).replace(/\0+$/, '') || null;
  if (bytes.length === 32) return text(bytes);
  const offset = Number(BigInt(`0x${hex.slice(2, 66)}`));
  if (!Number.isSafeInteger(offset) || offset + 32 > bytes.length) return null;
  const length = Number(BigInt(`0x${hex.slice(2 + offset * 2, 2 + offset * 2 + 64)}`));
  const start = offset + 32;
  if (!Number.isSafeInteger(length) || length > 256 || start + length > bytes.length) return null;
  return text(bytes.subarray(start, start + length));
}

export const VERIFY_METHOD = 'one JSON-RPC batch at the latest block: eth_chainId (must be 4663), eth_blockNumber, '
  + 'eth_getCode (keccak256 of the answer is compared with the reference hash), and eth_call to uiMultiplier(), '
  + 'symbol() and name(). The address is then looked up in the registry snapshot. With the deployer option, the '
  + 'contract creator is read from the chain explorer and reported next to the verdict';

/** Contract creator from a Blockscout v2 instance; tolerant of the field names across versions. */
export async function lookupCreator(address, { explorer = EXPLORER, fetchImpl = globalThis.fetch, timeoutMs = 12_000 } = {}) {
  const response = await fetchImpl(`${explorer}/api/v2/addresses/${address.toLowerCase()}`, {
    headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`explorer answered HTTP ${response.status}`);
  let json;
  try { json = await response.json(); } catch { throw new Error('explorer answered something other than JSON (a browser challenge?)'); }
  const creator = json?.creator_address_hash ?? json?.creator_address?.hash ?? null;
  if (creator != null && !isAddress(creator)) throw new Error('explorer answered a malformed creator address');
  return creator ? creator.toLowerCase() : null;
}

/**
 * @param {string} address
 * @param {object} [options]
 * @param {object} [options.rpc]           a client from createRpc(); built from STV_RPC_URLS by default
 * @param {boolean} [options.withDeployer] also ask the explorer for the contract creator
 */
export async function verifyAddress(address, { rpc = createRpc(), withDeployer = false, explorer = EXPLORER, fetchImpl = globalThis.fetch } = {}) {
  if (!isAddress(address)) throw new TypeError(`not an EVM address: ${String(address).slice(0, 60)}`);
  const to = address.toLowerCase();
  const base = { chainId: CHAIN_ID, address: to, method: VERIFY_METHOD, checkedAt: new Date().toISOString() };

  let answers;
  try {
    answers = await rpc.batch([
      { method: 'eth_chainId' },
      { method: 'eth_blockNumber' },
      { method: 'eth_getCode', params: [to, 'latest'] },
      { method: 'eth_call', params: [{ to, data: SEL.uiMultiplier }, 'latest'] },
      { method: 'eth_call', params: [{ to, data: SEL.symbol }, 'latest'] },
      { method: 'eth_call', params: [{ to, data: SEL.name }, 'latest'] },
    ]);
    assertChainId(answers[0]);
  } catch (error) {
    return { ...base, ...stockTokenVerdict({ address: to, codeHash: null }), reason: 'rpc_unavailable', error: hideUrlSecrets(error?.message || error).slice(0, 200) };
  }

  const [, blockAnswer, codeAnswer, mulAnswer, symbolAnswer, nameAnswer] = answers;
  const code = isHexBytes(codeAnswer?.result) ? codeAnswer.result : null;
  // A revert of uiMultiplier() is an answer, not a failure: counterfeit minimal proxies revert here.
  const mul = typeof mulAnswer?.result === 'string' && mulAnswer.result.length > 2 ? mulAnswer.result : null;
  const symbol = decodeAbiString(symbolAnswer?.result);
  const name = decodeAbiString(nameAnswer?.result);

  let deployer = null;
  let deployerError = null;
  if (withDeployer && code && code !== '0x') {
    try { deployer = await lookupCreator(to, { explorer, fetchImpl }); } catch (error) { deployerError = hideUrlSecrets(error?.message || error).slice(0, 160); }
    // An answer without a creator is not a measurement: never report it as a mismatch.
    if (deployer === null && deployerError === null) deployerError = 'the explorer reported no creator for this address';
  }

  const verdict = stockTokenVerdict({
    address: to, codeHash: code == null ? null : keccak256Hex(code), uiMultiplier: mul, symbol, name, deployer,
  });
  return {
    ...base,
    ...verdict,
    block: hexToNumber(blockAnswer?.result),
    isContract: code == null ? null : code !== '0x',
    // The full endpoint URL, for local use (CLI, library). The HTTP API does not pass it on: an
    // operator's provider URL can carry a key in its path.
    rpc: rpc.answeredBy,
    deployerChecked: withDeployer && !!code && code !== '0x' && deployerError === null,
    ...(deployerError ? { deployerError } : {}),
    ...(code == null ? { reason: 'code_unread' } : {}),
    // A registry address that answered no bytecode at all (see stockTokenVerdict).
    ...(code === '0x' && verdict.verdict === 'unreadable' ? { reason: 'code_empty' } : {}),
  };
}
