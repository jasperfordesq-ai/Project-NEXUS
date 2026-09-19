<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Prerender engine configuration.
 *
 * `ttl` maps route patterns to maximum snapshot age in seconds. The
 * auto-recache cron enqueues a low-priority re-render for any snapshot whose
 * age exceeds the TTL for its matched pattern. Most specific pattern wins.
 *
 * Pattern semantics:
 *   `/blog/*`   — direct children of /blog (e.g. /blog/foo, NOT /blog/foo/bar)
 *   `/blog/**`  — every descendant of /blog
 *   `/`         — homepage only (exact match)
 *   `default`   — fallback for routes not matched by anything else
 */
return [
    'ttl' => [
        // Homepage refreshes often — anything below it can change.
        '/'             => 6 * 3600,

        // Index pages bounce when their underlying collections change.
        // Blog reads are public and use an author-free editorial projection.
        '/blog'         => 12 * 3600,
        '/blog/**'      => 7 * 24 * 3600,

        // Other member-authored feature routes require authentication and are
        // deliberately absent. PrerenderService rejects them independently.
        '/page/*'       => 7 * 24 * 3600,

        // Legal / static pages — rarely change, refresh monthly.
        '/about'        => 30 * 24 * 3600,
        '/help'         => 30 * 24 * 3600,
        '/contact'      => 30 * 24 * 3600,
        '/faq'          => 30 * 24 * 3600,
        '/terms'        => 30 * 24 * 3600,
        '/privacy'      => 30 * 24 * 3600,
        '/cookies'      => 30 * 24 * 3600,
        '/accessibility'=> 30 * 24 * 3600,
        '/acceptable-use' => 30 * 24 * 3600,
        '/community-guidelines' => 30 * 24 * 3600,
        '/trust-and-safety' => 30 * 24 * 3600,
        '/account-deletion' => 30 * 24 * 3600,
        '/child-safety' => 30 * 24 * 3600,
        '/timebanking-guide' => 30 * 24 * 3600,
        '/changelog'    => 7 * 24 * 3600,
        '/features'     => 30 * 24 * 3600,

        // Safety net for routes we forgot to enumerate.
        'default'       => 7 * 24 * 3600,
    ],

    // Shared secret for the /invalidate webhook. External systems POST with
    // either Bearer <token> OR an X-Nexus-Signature: <hex-HMAC-SHA256> header
    // over the raw body. Empty string disables the external path; the admin
    // session fallback still works for the in-app UI.
    'webhook_token' => env('PRERENDER_WEBHOOK_TOKEN', ''),

    // A platform-wide (tenant_id IS NULL) prerender job that has not reached a
    // terminal state suppresses the 2-minute drift sweep by design: piling
    // per-tenant recaches on top of an authoritative rebuild fights it. That
    // guard had no time bound, so a job that could never finish turned the
    // pause into a permanent, silent stop — three global jobs sat 'queued'
    // from roughly 2026-08-11 to 2026-09-06 while the sweep reported success
    // every two minutes and nothing was re-rendered platform-wide.
    //
    // This is that bound. A block older than this is stuck, not busy: the
    // drift sweep exits FAILURE (so its scheduler-liveness stamp goes stale)
    // and PrerenderService::health() reports it red. A 'running' job that
    // renewed its worker lease inside the same window is exempt — it really is
    // rendering snapshots, so a long-but-progressing rebuild never cries wolf.
    'authoritative_block_alert_seconds' => (int) env('PRERENDER_AUTHORITATIVE_BLOCK_ALERT_SECONDS', 1800),

    // 🔴 Starvation guard for the claim order. claimNextJob() sorts strictly by
    // priority, so a steady supply of PRIORITY_HIGH work starves every lower
    // priority row behind it — for ever, not just for a while.
    //
    // That is not hypothetical. Between 2026-09-16 11:17 and 2026-09-19 the
    // drift sweep enqueued one priority-3 job roughly every 2.3 minutes while
    // the host processor could only claim one every ~3 minutes (each render
    // takes 150-180s). The priority-3 backlog therefore never emptied once,
    // 1,420 priority-3 jobs were claimed in three days, and exactly 2
    // priority-5 jobs were — both in the final minute before the backlog
    // closed over. Jobs #7125, #7126 (the platform master) and #8035
    // (hour-timebank) sat 'queued' and unclaimable for days.
    //
    // It froze those tenants' snapshots completely, because both freshness
    // loops skip a tenant that has any queued/claimed/running job: the starved
    // job suppressed the only sweeps that would have displaced it. Master's
    // crawler-served pages stayed pinned to one commit through three deploys.
    //
    // A job that has waited longer than this is claimed ahead of newer work
    // whatever its priority, oldest first. Priority still decides everything
    // inside the window; the guarantee this adds is only that waiting ends.
    'starvation_promote_seconds' => (int) env('PRERENDER_STARVATION_PROMOTE_SECONDS', 1800),

    // How long a single tenant's queued/claimed/running job may suppress that
    // tenant's freshness sweeps before the sweep calls it stuck rather than
    // busy. Same reasoning as authoritative_block_alert_seconds above, applied
    // per tenant instead of platform-wide — that guard existed and this one did
    // not, which is why a three-day freeze reported SUCCESS every two minutes.
    'tenant_block_alert_seconds' => (int) env('PRERENDER_TENANT_BLOCK_ALERT_SECONDS', 7200),

    'auto_recache' => [
        // Cap the work the cron generates so a single tick can't blow up the
        // queue. The cron itself runs at a fixed interval (see deploy notes);
        // these caps bound the per-tick fan-out.
        'max_tenants_per_run'      => 10,
        'max_routes_per_tenant'    => 50,
        // Minimum age before we'll auto-enqueue a recache, even if the TTL
        // says stale. Stops flapping after a content-change hook fires.
        'min_stale_seconds'        => 5 * 60,
        // Skip enqueueing if there's already a queued or running job for the
        // tenant. Prevents pile-up if processor is slow.
        'skip_if_tenant_has_active_job' => true,
    ],
];
