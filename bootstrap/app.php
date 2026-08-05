<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Sentry\Laravel\Integration;

$app = Application::configure(basePath: dirname(__DIR__))
    // Laravel 12 enables listener auto-discovery in Application::configure().
    // This app uses an explicit EventServiceProvider map; leaving discovery on
    // registers the same listeners twice and sends duplicate emails.
    ->withEvents(false)
    ->withProviders([
        \App\Providers\AppServiceProvider::class,
        \App\Providers\RouteServiceProvider::class,
        \App\Providers\EventServiceProvider::class,
        \App\Providers\BroadcastServiceProvider::class,
        \App\Providers\HorizonServiceProvider::class,
    ])
    ->withCommands([
        __DIR__ . '/../app/Console/Commands',
    ])
    ->withSchedule(function (Schedule $schedule) {
        // SINGLE source of truth for scheduling — do NOT also define in Kernel.php.
        // CronJobRunner::runAll() has internal time-checking that determines which
        // tasks to execute. We schedule it every minute and let it handle the rest.
        $schedule->call(function () {
            $runner = app(\App\Services\CronJobRunner::class);
            $runner->runAll();
        })
            ->everyMinute()
            ->name('nexus:run-all')
            // Must stay below the 30-min cron:run-all cache-lock TTL in
            // CronJobRunner::runAll() so the mutex expires before the lock.
            ->withoutOverlapping(30);

        $schedule->call(function () {
            \App\Services\JobExpiryNotificationService::notifyExpiringSoon();
        })
            ->dailyAt('08:00')
            ->name('job-expiry-notifications')
            ->withoutOverlapping();

        $schedule->command('safeguarding:clear-expired-monitoring')
            ->daily()
            ->withoutOverlapping()
            ->name('safeguarding-clear-expired-monitoring');

        // SLO watch (docs/SLO.md): evaluate the exchange-completion success rate
        // daily and alert (log → Sentry → Slack) + exit non-zero when breached,
        // so a money-path regression is VISIBLE before users complain.
        // NB: the four monitors below (slo-check, stripe-check-stuck-webhooks,
        // gdpr-check-overdue-requests, backup-verify) intentionally exit non-zero
        // when they DETECT a problem — that exit code is a signal for a human
        // running them by hand. They MUST run in the background: a *foreground*
        // scheduled command with a non-zero exit makes Laravel's ScheduleRunCommand
        // throw "Scheduled command [...] failed with exit code [1]" and report THAT
        // to Sentry, a second context-free error on top of the real captureMessage
        // alert (Sentry issue 128022136, which fired daily off the GDPR pager).
        // runInBackground() bypasses that throw (vendor guard is `&& ! $event->
        // runInBackground`) while preserving both the real alert and the manual-run
        // exit code. Guarded by PagerCommandsRunInBackgroundTest — keep it.
        $schedule->command('slo:check')
            ->dailyAt('07:30')
            ->withoutOverlapping()
            ->onOneServer()
            ->runInBackground()
            ->name('slo-check');

        // Stuck-Stripe-webhook pager (B3): a webhook event left in 'failed'
        // status means a payment/refund Stripe gave up retrying (~3 days) — silent
        // money-state drift. Alert (log → Sentry → Slack) + non-zero exit daily.
        $schedule->command('stripe:check-stuck-webhooks')
            ->dailyAt('07:45')
            ->withoutOverlapping()
            ->onOneServer()
            ->runInBackground()
            ->name('stripe-check-stuck-webhooks');

        // Overdue-GDPR-request pager: data-subject requests are created as
        // pending rows actioned MANUALLY by an admin (no automated processor),
        // so a request nobody opens silently breaches the GDPR Art.12(3) one-
        // month deadline. Alert (log → Sentry → Slack) + non-zero exit daily,
        // warning a few days before the 30-day deadline. Does not process them.
        $schedule->command('gdpr:check-overdue-requests')
            ->dailyAt('07:50')
            ->withoutOverlapping()
            ->onOneServer()
            ->runInBackground()
            ->name('gdpr-check-overdue-requests');

        // Alarm delivery heartbeat (watcher-of-the-watcher): the three breach
        // alarms above only fire when something is wrong, so a silently-broken
        // Sentry/Slack delivery path would go unnoticed. This fires a benign
        // weekly heartbeat through the SAME legs (log → Sentry → Slack); if it
        // ever stops arriving, alarm delivery itself is broken. Always exits 0.
        $schedule->command('monitoring:alarm-selftest')
            ->weeklyOn(1, '07:55')
            ->withoutOverlapping()
            ->onOneServer()
            ->name('monitoring-alarm-selftest');

        // Backup dead-man's switch: the nightly backup script only writes a
        // local log, so a stopped cron / unreachable DB / full disk would let
        // backups silently lapse until a restore is needed and there's nothing
        // to restore. This alarms (log -> Sentry -> Slack + non-zero exit) if the
        // newest nexus_db_*.sql.gz is missing, zero-byte, or > ~26h old. Runs
        // mid-morning, well after the 02:00 nightly backup window + retries.
        $schedule->command('backup:verify')
            ->dailyAt('09:30')
            ->withoutOverlapping()
            ->onOneServer()
            ->runInBackground()
            ->name('backup-verify');

        // Tenant data retention disposal (IT-Data-03) — off-peak nightly pass
        $schedule->command('retention:enforce')
            ->dailyAt('03:30')
            ->withoutOverlapping()
            ->onOneServer()
            ->name('retention-enforce');

        // Volunteer burnout-risk assessment — refreshes wellbeing alerts off the
        // read path (the dashboard GET no longer writes vol_wellbeing_alerts).
        $schedule->command('volunteering:assess-wellbeing')
            ->dailyAt('04:00')
            ->withoutOverlapping()
            ->onOneServer()
            ->name('volunteering-assess-wellbeing');

        $schedule->command('safeguarding:sla-escalate')
            ->everyFifteenMinutes()
            ->withoutOverlapping()
            ->onOneServer()
            ->name('safeguarding-sla-escalate');

        $schedule->command('events:expire-waitlist-offers --limit=250')
            ->everyMinute()
            ->withoutOverlapping(10)
            ->onOneServer()
            ->name('events-expire-waitlist-offers');

        $schedule->command('events:queue-reminders --limit=200')
            ->everyMinute()
            ->withoutOverlapping(10)
            ->onOneServer()
            ->name('events-queue-reminders');

        $schedule->command('events:process-notification-outbox --limit=50')
            ->everyMinute()
            ->withoutOverlapping(10)
            ->onOneServer()
            ->name('events-process-notification-outbox');

        $schedule->command('events:process-broadcasts --limit=50')
            ->everyMinute()
            ->withoutOverlapping(10)
            ->onOneServer()
            ->name('events-process-broadcasts');

        $schedule->command('events:process-federation --limit=50')
            ->everyMinute()
            ->withoutOverlapping(10)
            ->onOneServer()
            ->name('events-process-federation');

        // Retry durable podcast storage deletions. Domain rows never lose the
        // last object pointer before this ledger confirms cleanup succeeded.
        $schedule->command('podcasts:dispatch-media-cleanup --limit=100')
            ->everyMinute()
            ->withoutOverlapping(10)
            ->onOneServer()
            ->name('podcasts-dispatch-media-cleanup');

        $schedule->command('events:materialize-recurrences')
            ->hourly()
            ->withoutOverlapping(55)
            ->onOneServer()
            ->name('events-materialize-recurrences');

        // Surface federated transactions stuck in 'pending' (saga safety-net).
        $schedule->job(new \App\Jobs\ReconcileFederationPendingTxJob())
            ->everyFiveMinutes()
            ->name('federation-reconcile-pending-tx')
            ->withoutOverlapping(10);

        // Queue worker liveness: dispatch a heartbeat through a real worker…
        $schedule->call(function () {
            \Illuminate\Support\Facades\Cache::put(
                \App\Console\Commands\VerifyQueueLiveness::DISPATCHED_AT_KEY,
                now()->getTimestamp(),
                \App\Jobs\QueueHeartbeatJob::STAMP_TTL_SECONDS
            );
            \App\Jobs\QueueHeartbeatJob::dispatch();
        })
            ->everyFiveMinutes()
            ->name('queue-heartbeat-dispatch');

        // …and alarm (log + Sentry, 6h throttle) when heartbeats stop coming
        // back. Runs in the scheduler container, independent of the workers
        // it watches — "Horizon master alive" is NOT proof jobs process
        // (see the 2026-06-06→11 outage).
        $schedule->command('queue:verify-liveness')
            ->everyTenMinutes()
            ->withoutOverlapping()
            ->name('queue-verify-liveness');

        // Proactive email-deliverability pager: runs the existing
        // EmailMonitorService warning checks and pushes critical/warning issues
        // to Slack (SLACK_EMAIL_ALERTS_WEBHOOK) so delivery problems surface
        // before users report them. De-dupes identical issue sets internally,
        // so hourly cadence will not spam a persistent problem.
        $schedule->command('email:health-alert')
            ->hourly()
            ->withoutOverlapping()
            ->onOneServer()
            ->name('email-health-alert');

        // Self-healing safety net for the activation/welcome email (H5): if the
        // queue worker is dead or a send fails, new signups never get their
        // verification link and are silently locked out. This re-sends ONLY to
        // recent users with NO activation email on record (the command excludes
        // anyone who already received an 'activation' or 'email_verification'
        // email), so a healthy system sends nothing here.
        $schedule->command('emails:resend-stuck-activations --since=7days --limit=100')
            ->hourly()
            ->withoutOverlapping()
            ->onOneServer()
            ->name('emails-resend-stuck-activations');

        $schedule->command('safeguarding:purge-message-copies')
            ->weekly()
            ->withoutOverlapping()
            ->name('safeguarding-purge-message-copies');

        // Tier 2b governance — annual review of safeguarding preferences.
        // Runs monthly on the 1st at 06:00 (tenant-local is ambiguous for cross-
        // timezone platforms, so we pick a quiet server-time slot).
        $schedule->command('safeguarding:review-flags')
            ->monthlyOn(1, '06:00')
            ->withoutOverlapping()
            ->name('safeguarding-review-flags');

        // Community vetting confirmations have an explicit review date. Notify
        // active brokers/admins before renewal and immediately after expiry.
        $schedule->command('safeguarding:vetting-renewals')
            ->dailyAt('06:15')
            ->withoutOverlapping()
            ->onOneServer()
            ->name('safeguarding-vetting-renewals');

        // Announce podcast episodes whose scheduled publish time has arrived —
        // notifies subscribers + posts the feed activity. Deferred from publish
        // time so future-scheduled episodes aren't announced before they're live.
        $schedule->command('podcasts:release-due')
            ->everyFiveMinutes()
            ->withoutOverlapping()
            ->onOneServer()
            ->name('podcasts-release-due');

        // AG59 — Regional analytics monthly PDF reports for paid subscriptions.
        $schedule->command('regional-analytics:generate-monthly')
            ->monthlyOn(1, '06:00')
            ->withoutOverlapping()
            ->name('regional-analytics-generate-monthly');

        $schedule->command('federation:sync-partners')
            ->hourly()
            ->withoutOverlapping()
            ->name('federation-sync-partners');

        $schedule->command('federation:purge-external-logs')
            ->daily()
            ->withoutOverlapping()
            ->name('federation-purge-external-logs');

        // Prune federation aggregate query log (12-month retention) daily at 02:00.
        $schedule->command('federation:prune-aggregate-logs')
            ->dailyAt('02:00')
            ->withoutOverlapping()
            ->name('federation-prune-aggregate-logs');

        $schedule->command('federation:expire-cc-validations')
            ->everyMinute()
            ->withoutOverlapping(2)
            ->name('federation-expire-cc-validations');

        // AG55 — daily expiry of Verein cross-invitations (30-day window)
        $schedule->command('verein-federation:expire-invitations')
            ->daily()
            ->withoutOverlapping()
            ->name('verein-federation-expire-invitations');

        // AG54 — Verein membership dues lifecycle commands
        $schedule->command('verein:mark-overdue')
            ->dailyAt('05:00')
            ->withoutOverlapping()
            ->name('verein-mark-overdue-dues');

        $schedule->command('verein:send-dues-reminders')
            ->dailyAt('06:00')
            ->withoutOverlapping()
            ->name('verein-send-dues-reminders');

        // Annual run on Jan 1 at 02:00 — idempotent, regenerating skips rows already present.
        $schedule->command('verein:generate-annual-dues')
            ->yearlyOn(1, 1, '02:00')
            ->withoutOverlapping()
            ->name('verein-generate-annual-dues');

        $schedule->command('sitemap:generate')
            ->dailyAt('04:00')
            ->withoutOverlapping()
            ->name('sitemap-generate');

        $schedule->call(function () {
            app(\App\Services\FeedService::class)->publishScheduledPosts();
        })
            ->everyMinute()
            ->name('feed:publish-scheduled-posts')
            ->withoutOverlapping(5);

        $schedule->command('groups:publish-scheduled')
            ->everyFiveMinutes()
            ->withoutOverlapping()
            ->name('groups-publish-scheduled');

        $schedule->command('groups:dispatch-webhooks')
            ->everyMinute()
            ->withoutOverlapping(5)
            ->name('groups-dispatch-webhooks');

        $schedule->command('groups:check-inactive')
            ->dailyAt('03:30')
            ->withoutOverlapping()
            ->name('groups-check-inactive');

        $schedule->command('groups:prune-exports')
            ->dailyAt('04:15')
            ->withoutOverlapping()
            ->name('groups-prune-exports');

        $schedule->command('listings:process-search-alerts')
            ->hourly()
            ->withoutOverlapping()
            ->name('listings-process-search-alerts');

        $schedule->command('caring:nudges-dispatch')
            ->dailyAt('07:30')
            ->withoutOverlapping()
            ->name('caring-nudges-dispatch');

        $schedule->command('caring:hour-transfers-retry')
            ->everyFiveMinutes()
            ->withoutOverlapping(10)
            ->name('caring-hour-transfers-retry');

        // AG90 — Personalised civic digest dispatch (email + push).
        // Daily run at 07:00 for members opted into daily cadence; monthly run
        // on the 1st at 07:30. Both have idempotency guards inside the command
        // (last_sent_at per user) so re-running within the cadence window is a
        // no-op.
        $schedule->command('caring:civic-digest-dispatch --cadence=daily')
            ->dailyAt('07:00')
            ->withoutOverlapping(60)
            ->runInBackground()
            ->name('caring-civic-digest-daily');

        $schedule->command('caring:civic-digest-dispatch --cadence=monthly')
            ->monthlyOn(1, '07:30')
            ->withoutOverlapping(60)
            ->runInBackground()
            ->name('caring-civic-digest-monthly');

        // Listings: auto-unfeature listings whose featured_until has passed
        $schedule->call(function () {
            app(\App\Services\ListingFeaturedService::class)->processExpiredFeatured();
        })
            ->hourly()
            ->name('listings:process-expired-featured')
            ->withoutOverlapping(5);

        // Marketplace: expire stale offers (pending/countered past their expires_at)
        $schedule->call(function () {
            \App\Services\MarketplaceOfferService::expireStaleOffers();
        })
            ->hourly()
            ->name('marketplace:expire-stale-offers')
            ->withoutOverlapping(5);

        $schedule->command('marketplace:retry-report-notifications')
            ->everyFiveMinutes()
            ->withoutOverlapping(10)
            ->name('marketplace-retry-report-notifications');

        $schedule->command('marketplace:expire-pending-orders')
            ->everyFiveMinutes()
            ->withoutOverlapping(10)
            ->onOneServer()
            ->name('marketplace-expire-pending-orders');

        $schedule->command('marketplace:expire-listings')
            ->everyFifteenMinutes()
            ->withoutOverlapping(10)
            ->onOneServer()
            ->name('marketplace-expire-listings');

        $schedule->command('marketplace:complete-orders')
            ->everyFifteenMinutes()
            ->withoutOverlapping(10)
            ->onOneServer()
            ->name('marketplace-complete-orders');

        // Jobs: send interview reminders (24h and 1h before)
        $schedule->call(function () {
            \App\Services\JobInterviewService::sendReminders();
        })
            ->everyFifteenMinutes()
            ->name('jobs:interview-reminders')
            ->withoutOverlapping(10);

        // Marketplace: deactivate expired promotions
        $schedule->call(function () {
            \App\Services\MarketplacePromotionService::deactivateExpired();
        })
            ->hourly()
            ->name('marketplace:deactivate-expired-promotions')
            ->withoutOverlapping(5);

        // Marketplace: auto-release escrow holds past their release_after date
        $schedule->call(function () {
            \App\Services\MarketplaceEscrowService::processAutoReleases();
        })
            ->hourly()
            ->name('marketplace:process-escrow-releases')
            ->withoutOverlapping(5);

        // Marketplace: auto-acknowledge DSA reports older than 24h (MKT6)
        $schedule->call(function () {
            \App\Services\MarketplaceReportService::processUnacknowledged();
        })
            ->hourly()
            ->name('marketplace:process-unacknowledged-reports')
            ->withoutOverlapping(5);

        // Identity: fallback-poll stuck Stripe Identity sessions.
        // Stripe Identity webhooks are unreliable — users who leave the
        // verification page before webhook delivery get stuck in pending
        // forever. This hourly poll catches them.
        $schedule->command('nexus:identity:poll-stuck')
            ->hourly()
            ->withoutOverlapping()
            ->runInBackground()
            ->name('identity-poll-stuck');

        // Subscriptions: send 7-day renewal reminder to tenant admins
        $schedule->call(function () {
            \App\Services\StripeSubscriptionService::sendRenewalReminders();
        })
            ->dailyAt('09:00')
            ->name('subscriptions:renewal-reminders')
            ->withoutOverlapping(5);

        // Subscriptions: send trial-ending reminders (7-day and 1-day before expiry)
        $schedule->call(function () {
            \App\Services\StripeSubscriptionService::sendTrialEndingReminders();
        })
            ->dailyAt('10:00')
            ->name('subscriptions:trial-ending-reminders')
            ->withoutOverlapping(5);

        // H6: Prune unbounded logging tables (cron_logs 90d, error_404_log 30d,
        // activity_log 180d, api_logs 30d, federation_api_logs 30d) daily at 03:00.
        $schedule->command('nexus:prune-logs')
            ->dailyAt('03:00')
            ->withoutOverlapping()
            ->runInBackground()
            ->name('nexus-prune-logs');

        // Prune match-notification dedup markers older than 30 days.
        // The hot-match cron writes to match_notification_sent to avoid re-emailing
        // the same user about the same listing; rows are dropped after the 30-day TTL.
        $schedule->command('nexus:prune-match-notifications')
            ->dailyAt('03:15')
            ->withoutOverlapping()
            ->runInBackground()
            ->name('nexus-prune-match-notifications');

        // Onboarding nurture sequence — Day 2, Day 5, Day 7 emails to new users
        $schedule->call(function () {
            \App\Services\OnboardingNurtureService::sendDueNurtureEmails();
        })
            ->dailyAt('08:00')
            ->name('onboarding:nurture-sequence')
            ->withoutOverlapping(30);

        // AG61 — KI-Agenten Autonomous Agent Framework
        // Runs for all tenants that have agent_config.enabled=1
        $schedule->command('agents:dispatch --tenant=all')
            ->dailyAt('02:00')
            ->withoutOverlapping(60)
            ->runInBackground()
            ->name('ki-agents-dispatch');

        // AG61 — KI-Agenten new framework: hourly run of every enabled
        // `agent_definitions` row across tenants. Idempotent — disabled
        // definitions are skipped automatically by AgentRunner.
        $schedule->command('agents:run')
            ->hourly()
            ->withoutOverlapping(15)
            ->runInBackground()
            ->name('ag61-agents-run');

        // Horizon metrics snapshots — required for the Horizon dashboard charts.
        // Without periodic snapshots the wait-time and throughput graphs stay empty.
        $schedule->command('horizon:snapshot')
            ->everyFiveMinutes()
            ->name('horizon-snapshot');

        // Prerender freshness — three-layer model. See react-frontend/CLAUDE.md.
        //   Layer 2 (minute): drift detector compares sitemap <lastmod> vs
        //   snapshot mtimes and enqueues HIGH-priority recaches. Catches every
        //   code path that bypasses Eloquent observers (raw DB, migrations,
        //   queue jobs that use the query builder).
        // After every prerender scheduled task finishes, stamp the cache so
        // the health endpoint can detect "scheduler stopped firing" silently.
        $stampOk = fn(string $name) => function () use ($name) {
            \Illuminate\Support\Facades\Cache::put('prerender:sched:' . $name . ':last_ok_at', time(), 86400);
        };

        $schedule->command('prerender:detect-drift')
            ->everyTwoMinutes()
            ->withoutOverlapping(5)
            ->runInBackground()
            ->onSuccess($stampOk('prerender-detect-drift'))
            ->name('prerender-detect-drift');

        //   Layer 3 (hour/day floor): TTL-based recache. Bounded by config
        //   so a single tick can't flood the queue. Backstop for content
        //   the drift detector + observers don't reach.
        $schedule->command('prerender:auto-recache')
            ->cron('*/20 * * * *')
            ->withoutOverlapping(15)
            ->runInBackground()
            ->onSuccess($stampOk('prerender-auto-recache'))
            ->name('prerender-auto-recache');

    })
    ->withRouting(
        // Routes loaded by RouteServiceProvider (no /api prefix).
        // Only register the health-check here to avoid double-loading.
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        // EnsureCorsHeaders runs as the outermost middleware to guarantee
        // CORS headers on ALL responses, including 401/403 from auth middleware.
        $middleware->prepend(\App\Http\Middleware\EnsureCorsHeaders::class);
        // Prepended after CORS so this becomes the true outer edge and can
        // preserve the Events contract Vary token on success and error paths.
        $middleware->prepend(\App\Http\Middleware\NegotiateEventsContract::class);
        $middleware->append(\App\Http\Middleware\AssignRequestId::class);

        $middleware->api(prepend: [
            \App\Http\Middleware\SecurityHeaders::class,
            \App\Http\Middleware\ResolveTenant::class,
            \App\Http\Middleware\CheckMaintenanceMode::class,
            \App\Http\Middleware\SetLocale::class,
            \App\Http\Middleware\SeoRedirectMiddleware::class,
        ], append: ['throttle:api']);

        $middleware->alias([
            'auth' => \App\Http\Middleware\Authenticate::class,
            'admin' => \App\Http\Middleware\EnsureIsAdmin::class,
            'broker-or-admin' => \App\Http\Middleware\EnsureIsBrokerOrAdmin::class,
            'super-admin' => \App\Http\Middleware\EnsureIsSuperAdmin::class,
            // Subtree tier of the super panel: platform super-admins AND super-admins
            // of a tenant that has children, the latter confined to their own subtree.
            // 🔴 Only for endpoints that already scope themselves — see the class docblock.
            'super-panel' => \App\Http\Middleware\EnsureSuperPanelAccess::class,
            'federation.api' => \App\Http\Middleware\FederationApiAuth::class,
            'federation.external' => \App\Http\Middleware\EnsureExternalFederationEnabled::class,
            'partner.api' => \App\Http\Middleware\PartnerApiAuth::class,
            'partner.api.enabled' => \App\Http\Middleware\EnsurePartnerApiEnabled::class,
            'onboarding-required' => \App\Http\Middleware\EnsureOnboardingComplete::class,
            'feature' => \App\Middleware\TenantFeatureMiddleware::class,
            'group.tab' => \App\Middleware\GroupTabFeatureMiddleware::class,
            'module' => \App\Middleware\TenantModuleMiddleware::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        // Accessible (GOV.UK) frontend: HTML error pages with layout + AGPL
        // attribution instead of the bare Laravel defaults. Registered FIRST so
        // accessible requests are skinned before the API JSON renderables below
        // (TooManyRequests/ModelNotFound would otherwise answer them with JSON).
        // Returns null for non-accessible requests, falling through unchanged.
        $exceptions->renderable(function (\Throwable $e, \Illuminate\Http\Request $request) {
            if (!\App\Support\AccessibleErrorPage::handles($request)) {
                return null;
            }
            $status = \App\Support\AccessibleErrorPage::statusFor($e);

            return $status === null ? null : \App\Support\AccessibleErrorPage::render($request, $status);
        });

        // JSON error responses for API — see App\Exceptions\Handler
        $exceptions->renderable(function (\Illuminate\Validation\ValidationException $e) {
            return response()->json([
                'errors' => [
                    ['code' => 'validation_failed', 'message' => __('api.validation_failed'), 'details' => $e->errors()],
                ],
                'success' => false,
            ], 422, ['API-Version' => '2.0']);
        });

        $exceptions->renderable(function (\Illuminate\Auth\AuthenticationException $e) {
            return response()->json([
                'errors' => [
                    ['code' => 'auth_required', 'message' => __('api.auth_required_detail')],
                ],
                'success' => false,
            ], 401, ['API-Version' => '2.0']);
        });

        $exceptions->renderable(function (\Illuminate\Database\Eloquent\ModelNotFoundException $e) {
            $model = class_basename($e->getModel());
            return response()->json([
                'errors' => [
                    ['code' => 'not_found', 'message' => __('api.not_found', ['model' => $model])],
                ],
                'success' => false,
            ], 404, ['API-Version' => '2.0']);
        });

        $exceptions->renderable(function (\Symfony\Component\HttpKernel\Exception\TooManyRequestsHttpException $e) {
            return response()->json([
                'errors' => [
                    ['code' => 'rate_limited', 'message' => __('api.rate_limit_exceeded')],
                ],
                'success' => false,
                'retry_after' => $e->getHeaders()['Retry-After'] ?? null,
            ], 429, ['API-Version' => '2.0']);
        });

        // Symfony Console CLI-input noise — not application bugs. These fire
        // when an operator types a bad artisan command (`artisan tinker` with
        // tinker uninstalled, `artisan x --columns` with no such option, etc.).
        // Filtering them out of Sentry keeps the dashboard signal-to-noise high.
        $exceptions->dontReport([
            \Symfony\Component\Console\Exception\CommandNotFoundException::class,
            \Symfony\Component\Console\Exception\RuntimeException::class,
        ]);

        // Sentry — captures unhandled exceptions and wires tracing context.
        // Driven by config/sentry.php (which reads SENTRY_DSN_PHP from .env).
        Integration::handles($exceptions);
    })
    ->create();

// NOTE: App\Core\Database now delegates directly to DB::connection()->getPdo()
// so no explicit bridge setup is needed.

return $app;
