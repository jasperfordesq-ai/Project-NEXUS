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

createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (incoming, outgoing) => {
  const upstream = request({
    hostname: '127.0.0.1',
    port: 3000,
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
}).listen(3443);
