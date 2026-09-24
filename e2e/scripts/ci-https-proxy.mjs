// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:https';

const [keyPath, certPath] = process.argv.slice(2);
if (!keyPath || !certPath) {
  throw new Error('Pass the temporary CI TLS key and certificate paths');
}

const frontendPort = Number(process.env.NEXUS_E2E_FRONTEND_PORT || 3000);
const apiPort = Number(process.env.NEXUS_E2E_API_PORT || frontendPort);
const listenPort = Number(process.env.NEXUS_E2E_PROXY_PORT || 3443);
const listenHost = process.env.NEXUS_E2E_PROXY_HOST;
for (const port of [frontendPort, apiPort, listenPort]) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid HTTPS proxy port');
  }
}

createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (incoming, outgoing) => {
  // Production's browser-auth middleware requires HTTPS and an exact Host/Origin
  // match. Route API calls straight to the candidate API so the frontend proxy
  // cannot strip the test origin's port from Host.
  const apiRequest = incoming.url?.startsWith('/api/')
    || incoming.url?.startsWith('/version.php')
    || incoming.url?.startsWith('/health.php');
  const targetPort = apiRequest ? apiPort : frontendPort;
  const upstream = request({
    hostname: '127.0.0.1',
    port: targetPort,
    path: incoming.url,
    method: incoming.method,
    headers: { ...incoming.headers, 'x-forwarded-proto': 'https' },
  }, (response) => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(outgoing);
  });
  upstream.on('error', () => {
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end();
  });
  incoming.pipe(upstream);
}).listen(listenPort, listenHost);
