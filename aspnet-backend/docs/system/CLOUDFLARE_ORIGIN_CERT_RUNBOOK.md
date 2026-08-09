# Cloudflare Origin Certificate Migration Runbook

Last reviewed: 2026-08-09

Status: **Maintained operator runbook - no standing authorization**

This runbook migrates the Plesk-hosted `*.project-nexus.net` domains from
90-day Let's Encrypt certificates to a long-lived Cloudflare Origin CA
certificate. It does not authorize a production change on its own. Obtain an
explicit instruction naming the domains before running any step.

## Why

Every domain on the production host is proxied through Cloudflare, and the
`project-nexus.net` zone runs SSL/TLS mode **`strict`** (verified 2026-08-09 via
`GET /zones/{zone}/settings/ssl`). Strict mode requires a valid, trusted
certificate at the origin.

That combination creates a trap. If a Let's Encrypt certificate expires while
the zone is strict, it can never renew itself:

1. Let's Encrypt requests `/.well-known/acme-challenge/...` over HTTP.
2. Cloudflare's "Always Use HTTPS" 301s to HTTPS. Plesk's Apache vhost issues
   the same redirect independently, so disabling either one alone changes
   nothing.
3. Cloudflare tries the origin over TLS, rejects the expired certificate under
   strict mode, and returns **526** instead of the challenge token.
4. Validation fails, so no new certificate is issued, so step 3 repeats forever.

`admin.project-nexus.net` and `ie.project-nexus.net` are in exactly this state —
both expired 2026-06-06 and have been unreachable since. Both are retired, so
the impact is cosmetic, but any live domain that misses a renewal window lands
in the same hole.

**A Cloudflare Origin CA certificate removes the trap entirely, because it needs
no domain validation.** Cloudflare signs a CSR directly. There is no ACME
challenge to fail, so an expired certificate can always be replaced. Validity is
up to 15 years.

The V1 `.ie` domains already work this way: `project-nexus.ie`,
`api.project-nexus.ie`, `app.project-nexus.ie`, and `crm.project-nexus.ie`
present a Cloudflare origin certificate valid to **2041-05-02**.

## Critical constraint — read before starting

**A Cloudflare Origin CA certificate is trusted only by Cloudflare.** A browser
or monitor connecting directly to the origin will see an untrusted certificate.

Therefore:

- Every migrated hostname **must remain proxied** (orange cloud) in Cloudflare,
  permanently. Grey-clouding a migrated record breaks TLS for real visitors.
- Any monitor, health check, or integration that bypasses Cloudflare and hits
  `20.224.171.253` directly over HTTPS will fail certificate validation. Audit
  those before migrating, and point them at the public hostname instead.
- Keep the zone in Full (strict). Origin CA certificates are valid under strict
  mode; that is the entire point.

Do not migrate a hostname that must be reachable without Cloudflare.

**Two hostnames on this server are not proxied and must never be migrated.**
Verified 2026-08-09: `pairc-goodman.com` and `timebanks.us` resolve directly to
the origin `20.224.171.253`, not to Cloudflare IPs. They rely on publicly
trusted Let's Encrypt certificates, and giving them a Cloudflare origin
certificate would produce a browser trust error for every visitor. Leave both on
Let's Encrypt. Re-check proxy status before migrating any hostname:

```bash
dig +short <hostname> A     # Cloudflare IPs (104.x / 172.67.x) = proxied, safe
                            # 20.224.171.253                    = direct, DO NOT migrate
```

## Prerequisites

| Item | Value |
|---|---|
| Host | `azureuser@20.224.171.253` (see `.claude/production-server.md`) |
| API token | `/opt/nexus-php/.cloudflare-api-token` on the host, or `$CLOUDFLARE_API_TOKEN` |
| Zone ID (`project-nexus.net`) | `ab50a7ee4c5f427b7bc436db26496c7d` |
| Plesk | Obsidian 18.0.79.x, `plesk bin certificate` CLI |

The existing deploy token was verified on 2026-08-09 to be active and to reach
the Origin CA endpoint (`GET /certificates?zone_id=...` returned the current
certificate). **No separate Origin CA Key is required** — the Bearer token is
sufficient. Zone IDs for the other zones are listed in the staging repository at
`scripts/purge-cloudflare-cache.sh`.

Never echo the token into logs, commits, or shared output. Read it into a shell
variable and let it fall out of scope.

## Scope

Hostnames on this host currently using Let's Encrypt in the `project-nexus.net`
zone:

```
api.project-nexus.net        uk.project-nexus.net
platform.project-nexus.net   project-nexus.net
```

`admin.project-nexus.net` and `ie.project-nexus.net` were retired and their DNS
records were deleted from Cloudflare on 2026-08-09. They no longer resolve, so
they are out of scope and the 526 condition they exhibited is resolved.

`timebank.global`, `accessible-uk.timebank.global`, and `uk.timebank.global` are
proxied but sit in a **different zone** — repeat the procedure with that zone's
ID from `scripts/purge-cloudflare-cache.sh` in the staging repository. One
certificate does not span zones.

`pairc-goodman.com` and `timebanks.us` are **excluded** — they are not proxied
through Cloudflare. See the constraint above.

## Status — two zones migrated

Completed 2026-08-09. Every proxied hostname on this server now holds a
Cloudflare origin certificate valid to **2041-08-05**.

**Zone `project-nexus.net`** — certificate `cloudflare-origin-net-20260809`:

| Hostname | Verified after migration |
|---|---|
| `platform.project-nexus.net` | 200, retirement notice renders |
| `project-nexus.net` | 200 |
| `uk.project-nexus.net` | 200, `<title>Home - Project NEXUS Community</title>` |
| `api.project-nexus.net` | `/health` returns `{"status":"healthy"}` |

**Zone `timebank.global`** (zone `7ac1e69f5a1fdc7894236548adf7be1e`, also
`strict`) — certificate `cloudflare-origin-tbg-20260809`:

| Hostname | Verified after migration |
|---|---|
| `accessible-uk.timebank.global` | 200, `<title>Accessible - Project NEXUS Accessible</title>` |
| `uk.timebank.global` | 200, `<title>NEXUS — Community Timebanking Platform</title>` |
| `timebank.global` | 200, same title; `www.` variant still 301s as before |

These serve live user-facing sites owned by a different repository, so they were
migrated one at a time, least critical first, with the rendered page title
checked each time rather than only a status code.

Remaining on Let's Encrypt, deliberately or pending:

- `pairc-goodman.com`, `timebanks.us` — **excluded permanently**, not proxied.
- `accessible.project-nexus.ie` — the one `.ie` host not on the 2041 certificate
  its siblings already use. Same procedure, `project-nexus.ie` zone.

Both migrations were preceded by the same check: nothing on the host reaches
these hostnames without passing through Cloudflare. The only references found in
running containers were a `SENDGRID_FROM_EMAIL` address, the .NET API's
`Cors__AllowedOrigins` / `Fido2__Origins` strings, and the V1 PHP stack's
`ALLOWED_ORIGINS` list — all of them validation values, none opening a TLS
connection.

**Why this is low risk for live sites.** Visitors and API clients terminate TLS
at Cloudflare's edge certificate, which is unchanged by this work. Only the
Cloudflare-to-origin hop uses the origin certificate. Client-side certificate
pinning, mobile apps, and third-party integrations are therefore unaffected,
provided they reach the site through Cloudflare rather than the origin IP.

## Pilot result — executed 2026-08-09

The pilot ran on `platform.project-nexus.net` and **succeeded**. This procedure
is proven against this environment, not theoretical.

| | Before | After |
|---|---|---|
| Plesk certificate | `Lets Encrypt platform.project-nexus.net` | `cloudflare-origin-net-20260809` |
| Origin issuer | Let's Encrypt YR2 | CloudFlare Origin SSL Certificate Authority |
| Expiry | 2026-10-13 (65 days) | **2041-08-05 (15 years)** |
| Through Cloudflare | HTTP/2 200 | HTTP/2 200 |

The certificate covers `project-nexus.net` and `*.project-nexus.net`, so the
same Plesk entry can be assigned to the remaining hostnames without a new CSR.
Cloudflare accepted it immediately under Full (strict), confirming that origin
certificates satisfy strict mode. All other domains were re-verified unchanged
afterwards.

Notes from the run:

- `plesk bin certificate --list` shows the entry with `CA` = `N`. That is
  expected — a Cloudflare origin certificate needs no intermediate chain,
  because Cloudflare trusts its own origin CA directly. It is not an error.
- Verify the certificate and private key match before installing. The modulus
  check in step 4 below catches a mismatched pair before it reaches Apache.

## Procedure

Run one hostname first — `platform.project-nexus.net` is the safest pilot, since
it is retired but publicly reachable, so a mistake is visible without harming a
live service. Do not batch until the pilot verifies.

### 1. Snapshot current state

```bash
sudo plesk bin certificate --list -domain project-nexus.net
echo | openssl s_client -connect 20.224.171.253:443 -servername platform.project-nexus.net 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

Record which certificate each domain uses (`plesk bin site --info <domain>`)
so any step can be reversed.

### 2. Generate a private key and CSR on the host

The key is generated locally and never leaves the server. Cloudflare only ever
sees the CSR.

```bash
cd /root
umask 077
openssl req -new -newkey rsa:2048 -nodes \
  -keyout cf-origin-net.key \
  -out cf-origin-net.csr \
  -subj "/CN=project-nexus.net"
```

### 3. Request the certificate from Cloudflare

Covers the apex and all subdomains, so it serves every hostname in the zone.

```bash
T=$(sudo cat /opt/nexus-php/.cloudflare-api-token | tr -d '[:space:]')
CSR=$(cat /root/cf-origin-net.csr)

curl -s -X POST "https://api.cloudflare.com/client/v4/certificates" \
  -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" \
  --data "$(python3 -c "
import json,sys
print(json.dumps({
  'hostnames': ['project-nexus.net', '*.project-nexus.net'],
  'requested_validity': 5475,
  'request_type': 'origin-rsa',
  'csr': open('/root/cf-origin-net.csr').read()
}))")" > /root/cf-origin-net.response.json

python3 -c "
import json
d = json.load(open('/root/cf-origin-net.response.json'))
print('success:', d['success'])
if d['success']:
    open('/root/cf-origin-net.crt','w').write(d['result']['certificate'])
    print('expires:', d['result']['expires_on'])
else:
    print(d['errors'])
"
```

`requested_validity: 5475` is 15 years. Valid values are 7, 30, 90, 365, 730,
1095, and 5475 days.

Before installing, confirm the certificate matches the key. A mismatched pair
will break TLS for the domain the moment Apache reloads.

```bash
sudo bash -c '
C=$(openssl x509 -in /root/cf-origin-net.crt -noout -modulus | openssl md5)
K=$(openssl rsa  -in /root/cf-origin-net.key -noout -modulus | openssl md5)
[ "$C" = "$K" ] && echo "MATCH - safe to install" || echo "MISMATCH - DO NOT INSTALL"'
```

### 4. Import into the Plesk subscription

The `project-nexus.net` subscription's repository does **not** currently contain
an origin certificate — verified 2026-08-09 — so it must be imported there even
though the `.ie` subscription already has one. Certificates are per-subscription.

```bash
sudo plesk bin certificate --create "cloudflare-origin-net-$(date +%Y%m%d)" \
  -domain project-nexus.net \
  -key-file /root/cf-origin-net.key \
  -cert-file /root/cf-origin-net.crt
```

### 5. Assign to one domain and reload

```bash
sudo plesk bin site --update platform.project-nexus.net \
  -certificate-name "cloudflare-origin-net-$(date +%Y%m%d)"

sudo apachectl configtest && sudo systemctl reload apache2
```

Always `configtest` before reloading, and use `reload`, never `restart` — a
restart drops connections for every other domain on the host.

### 6. Verify the pilot

```bash
# origin presents the new certificate
echo | openssl s_client -connect 20.224.171.253:443 -servername platform.project-nexus.net 2>/dev/null \
  | openssl x509 -noout -issuer -dates

# Cloudflare still accepts the origin under strict mode
curl -sI https://platform.project-nexus.net/ | head -1
```

The issuer should now read `CloudFlare Origin SSL Certificate Authority`, and
the public request must still return its normal status. **If the public request
returns 526, the origin certificate was not accepted — roll back immediately
(step 8) rather than continuing.**

Also confirm at least one unrelated domain is unaffected:

```bash
curl -sI https://uk.project-nexus.net/ | head -1
```

### 7. Repeat per hostname

Only after the pilot verifies. Reuse the same certificate; no new CSR is needed.

```bash
for d in api.project-nexus.net uk.project-nexus.net project-nexus.net; do
  sudo plesk bin site --update "$d" -certificate-name "cloudflare-origin-net-YYYYMMDD"
done
sudo apachectl configtest && sudo systemctl reload apache2
```

Verify each through Cloudflare before moving to the next.

### 8. Rollback

Every Let's Encrypt certificate stays in the repository, so rollback is
reassignment:

```bash
sudo plesk bin site --update platform.project-nexus.net \
  -certificate-name "Lets Encrypt platform.project-nexus.net"
sudo apachectl configtest && sudo systemctl reload apache2
```

Rollback is safe while the Let's Encrypt certificate is still unexpired. Once it
expires, the deadlock in "Why" applies and rollback stops being an option — so
do not leave a half-migrated host sitting for weeks.

### 9. Clean up

```bash
shred -u /root/cf-origin-net.key /root/cf-origin-net.csr \
         /root/cf-origin-net.response.json
```

Keep `/root/cf-origin-net.crt` if useful; the certificate is not secret. The
private key now lives in Plesk's repository, so the loose copy should not
persist. Do not commit any of these files.

## After migration

- Let's Encrypt renewal for migrated hostnames becomes irrelevant. Plesk may
  still attempt renewals; those attempts are harmless but can be turned off
  per-domain to stop failure emails.
- Re-audit expiry periodically. The command is in
  `.claude/production-server.md`.
- Migrated hostnames must stay orange-clouded forever. Record that wherever DNS
  changes are reviewed.

## Unblocking admin and ie without migrating

If the two retired domains only need their retirement notice visible, migrating
them via this runbook is the cleanest fix, because origin certificates skip
validation entirely and the deadlock does not apply.

The alternatives all require a Cloudflare change and are listed in
`.claude/production-server.md`: temporarily grey-cloud the record, temporarily
relax the zone to Full (non-strict), or exempt `/.well-known/acme-challenge/*`
from Always Use HTTPS. Deleting the two DNS records is also reasonable, since
the services behind them no longer exist.
