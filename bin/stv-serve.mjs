#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 The BonyNode Authors
// SPDX-License-Identifier: Apache-2.0
//
// Start the read-only API.  PORT (default 8787), HOST (default 127.0.0.1), STV_RPC_URLS (optional),
// TRUST_PROXY=1 behind your own reverse proxy.
import { API_BASE, createApiServer } from '../src/server.js';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST || '127.0.0.1';
const server = createApiServer({ trustProxy: process.env.TRUST_PROXY === '1' });
// A failure to listen is an operator's problem, not a crash: one line, no stack.
server.on('error', (error) => {
  const reason = {
    EADDRINUSE: `port ${port} on ${host} is already in use — stop the other process or set PORT`,
    EACCES: `no permission to listen on port ${port} on ${host} — choose a port above 1023 or set PORT`,
    EADDRNOTAVAIL: `address ${host} is not available on this machine — set HOST`,
  }[error.code] || String(error.message || error);
  console.error(`stv-serve: ${reason}`);
  process.exit(1);
});
server.listen(port, host, () => {
  const { port: bound } = server.address();
  console.log(`listening on http://${host}:${bound}${API_BASE}`);
});
