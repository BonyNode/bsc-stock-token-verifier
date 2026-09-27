// Data, not code: the terms in DATA.md apply to this file, and the Apache License of the code does
// not extend to it. The helpers that serve this data to the tests are in test/helpers.mjs.
//
// Live chain snapshots taken with eth_getCode / eth_call on 2026-09-20 (multipliers re-read on
// 2026-09-27: unchanged). Nothing here is invented: keccak256 is computed over these exact strings,
// so changing one character moves the hash away from the reference.

/** Genuine NVDA: a beacon proxy; the beacon address is embedded in the runtime code. */
export const NVDA = {
  addr: '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec',
  code: '0x6080604052600a600c565b005b60186014601a565b609d565b565b5f7f000000000000000000000000e10b6f6b275de231345c20d14ab812db62151b006001600160a01b0316635c60da1b6040518163ffffffff1660e01b8152600401602060405180830381865afa1580156076573d5f5f3e3d5ffd5b505050506040513d601f19601f820116820180604052508101906098919060ba565b905090565b365f5f375f5f365f845af43d5f5f3e80801560b6573d5ff35b3d5ffd5b5f6020828403121560c9575f5ffd5b81516001600160a01b038116811460de575f5ffd5b939250505056fea2646970667358221220e296a217a10765339b402e91ead95bcbcf74e678d7c756705f097d88cc2554b064736f6c63430008210033',
  mul: '0x0000000000000000000000000000000000000000000000000de377b4760af643', // 1.000775159164630595
  symbol: 'NVDA', name: 'NVIDIA • Robinhood Token',
};

/** Counterfeit NVDA: a 45-byte minimal proxy to a foreign implementation; uiMultiplier() reverts. */
export const FAKE_NVDA = {
  addr: '0x1076f47f9632d726cf0ff93ad1616c45cbb8b94d',
  code: '0x363d3d373d3d3d363d73efb48df35de6c77e2a297d32fa338b519d3f9f025af43d82803e903d91602b57fd5bf3',
  mul: null, symbol: 'NVDA', name: 'NVIDIA • Robinhood Token',
};

/** Counterfeit LULU: its multiplier answers exactly 1e18 — it defeats every heuristic but the bytecode. */
export const FAKE_LULU = {
  addr: '0x9b6cc37b76037d3bfb55aebd5f5d210a82e6a85a',
  codeHash: '0x369fcf4b8bd0d32b89871cc631d8da7b69f9e014351500dbd93e98501cd0da83',
  mul: '0xde0b6b3a7640000', symbol: 'LULU', name: 'Lululemon • Robinhood Token',
};

/** Counterfeit with no twin in the registry: the ticker FOMO belongs to no genuine Stock Token. */
export const FAKE_FOMO = {
  addr: '0x7dbab44f52c2cb0d2152add95b8f3d7faef9c4f9',
  codeHash: '0x8ac410b77a9c9ae9d08cb934743c6c8b92a6563a37e207b33f3358e092b593cf',
  mul: '0xde0b6b3a7640000', symbol: 'FOMO', name: 'Formation Metals Inc. • Robinhood Token',
};

/** USDG on the same chain: not a Stock Token, 6 decimals, uiMultiplier() reverts. */
export const USDG = {
  addr: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
  codeHash: '0x864cc9ad53b338b82da1f7cab85ab0b3d5c8861acb422b6fec63cf36234f36a6',
  symbol: 'USDG', name: 'Global Dollar',
};

/** uiMultiplier() answers read live (decimal raw values). */
export const MULTIPLIERS = {
  NVDA: { addr: '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec', mul: '1000775159164630595' },
  SPY: { addr: '0x117cc2133c37b721f49de2a7a74833232b3b4c0c', mul: '1001717991187472003' },
  SGOV: { addr: '0x92fd66527192e3e61d4ddd13322aa222de86f9b5', mul: '1005101770003214918' },
  TSLA: { addr: '0x322f0929c4625ed5bad873c95208d54e1c003b2d', mul: '1000000000000000000' },
};
