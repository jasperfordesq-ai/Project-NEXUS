<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Routing\Route as RoutingRoute;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Tests\Laravel\Feature\Security\Support\AccessSweepTestCase;

/**
 * E-122 stage 0 — route-table surname sweep.
 *
 * Owner rule (10 Nov 2026): "No surnames should be anywhere on the site apart
 * from for admins."
 *
 * WHAT IT DOES
 * ------------
 * Seeds one community with people whose surnames are invented single tokens
 * (`Zqxsurname…`), gives them one record of every fixture type the access
 * sweeps know how to create plus a handful of relationships with the viewer,
 * then calls EVERY member-facing GET route under `api/` as an ordinary member
 * of that community. A response body that contains a seeded surname other than
 * the viewer's own is a leak.
 *
 * Stage 0 changes no application behaviour and many routes leak today, so the
 * gate is a SHRINK-ONLY BASELINE, enforced in both directions (the same rule
 * as scripts/check-db-column-references.mjs):
 *
 *   - a route that leaks and is NOT in the baseline fails        (a new leak)
 *   - a route in the baseline that no longer leaks fails         (remove it)
 *   - a route in the baseline that no longer exists fails        (remove it)
 *
 * The baseline is `baselines/surname-sweep-baseline.json` beside this file:
 * `"GET <route uri>" => {surnames: [which seeded people], fields: [JSON paths]}`.
 * It holds route names and field paths only — never a response body.
 *
 * 🔴 THE BASELINE MAY ONLY SHRINK. An entry is removed by the commit that fixes
 * the route; nothing is ever added to make a red run green. To rewrite the file
 * after a fix, run the sweep with the variable set (inside the container):
 *
 *   docker exec -e SURNAME_SWEEP_WRITE_BASELINE=shrink -e MAIL_MAILER=array \
 *     -e BROADCAST_CONNECTION=null \
 *     -e APP_KEY="base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=" \
 *     nexus-php-app php vendor/bin/phpunit \
 *     tests/Laravel/Feature/Security/SurnameSweepTest.php --no-coverage
 *
 * `shrink` can only REMOVE entries, and only those the run proved fixed (the
 * route answered 2xx with data that names a seeded person, and no surname). A
 * baseline route that stopped leaking because it stopped being exercised
 * (fixture rot, a 4xx, an empty list) is NOT removed: that is a broken proof,
 * not a fix, and the sweep says so. `grow` exists for exactly one case — better
 * fixtures made the sweep reach a route that was ALREADY leaking — and whoever
 * uses it must read every added line in the diff. It is never the answer to a
 * leak introduced by a change.
 *
 * A ROUTE THAT WAS NOT EXERCISED IS NEVER COUNTED AS CLEAN
 * ---------------------------------------------------------
 * Only a 2xx response carrying data can prove anything, and only a body that
 * NAMES a seeded person (their invented first name is in it) proves that a
 * name was shaped correctly. The sweep prints, every run: routes registered,
 * routes outside this pass and why, routes called, 2xx-with-data, how many of
 * those named a seeded person, 2xx-empty, 3xx/4xx/5xx by code, threw, and not
 * called by reason. The baseline also records coverage floors; a run that
 * exercises fewer routes than the floor fails, so fixture rot cannot turn this
 * into a vacuous pass.
 *
 * HONEST LIMITS
 * -------------
 *  - GET only. Write responses that echo an author, notification text, push
 *    and broadcast payloads, e-mails, CSV/PDF built in a queue, the search
 *    index and admin-warmed caches are later stages of the E-122 plan.
 *  - Staff routes (admin, broker, super-admin, super-panel, tenant-super-admin),
 *    the partner API and external federation are excluded here — surnames are
 *    allowed or separately tested there. The admin guard test below pins that
 *    an admin still sees them.
 *  - Path parameters that are not record ids (slug, token, code, …) cannot be
 *    filled and are reported as not called.
 *  - The Caring Community feature is deliberately left OFF (owner rule: alpha,
 *    never turned on), so its routes are reported as feature-off.
 *  - Internal federation needs a second federated community and is not seeded.
 *  - The viewer's own surname is ignored everywhere (the task's rule); whether
 *    it should appear only on "my account" routes is not asserted here.
 */
class SurnameSweepTest extends AccessSweepTestCase
{
    use DatabaseTransactions;

    private const BASELINE_FILE = __DIR__ . '/baselines/surname-sweep-baseline.json';

    /** Seeded people other than the viewer: label => [first name, surname]. */
    private const PEOPLE = [
        'owner' => ['Zqxfirstowner', 'Zqxsurnameowner'],       // owns one record of every fixture type
        'other' => ['Zqxfirstother', 'Zqxsurnameother'],       // the other party in the viewer's own things
        'contact' => ['Zqxfirstcontact', 'Zqxsurnamecontact'], // contact person of an organisation account
        'blocked' => ['Zqxfirstblocked', 'Zqxsurnameblocked'], // a member the viewer has blocked
        'factory' => ['Zqxfirstfactory', 'Zqxsurnamefactory'], // every person a factory created on the side
    ];

    private const VIEWER = ['Zqxfirstself', 'Zqxsurnameself'];

    private const ORGANISATION_NAME = 'Zqx Helping Hands';

    /** Route middleware that puts a route in a different pass. Class => why. */
    private const OTHER_PASS_MIDDLEWARE = [
        \App\Http\Middleware\EnsureIsAdmin::class => 'staff gate: admin',
        \App\Http\Middleware\EnsureIsBrokerOrAdmin::class => 'staff gate: broker-or-admin',
        \App\Http\Middleware\EnsureIsSuperAdmin::class => 'staff gate: super-admin',
        \App\Http\Middleware\EnsureSuperPanelAccess::class => 'staff gate: super-panel',
        \App\Http\Middleware\EnsureIsTenantSuperAdmin::class => 'staff gate: tenant-super-admin',
        \App\Http\Middleware\PartnerApiAuth::class => 'partner API (off in production; E-122 stage 8)',
        \App\Http\Middleware\EnsurePartnerApiEnabled::class => 'partner API (off in production; E-122 stage 8)',
        \App\Http\Middleware\FederationApiAuth::class => 'external federation (off in production; E-122 stage 8)',
        \App\Http\Middleware\EnsureExternalFederationEnabled::class => 'external federation (off in production; E-122 stage 8)',
    ];

    /** Features never switched on by this sweep. */
    private const FEATURES_LEFT_OFF = ['caring_community'];

    /**
     * Non-id path parameters this sweep can still fill, because the route also
     * accepts the record's numeric id there.
     */
    private const ID_ACCEPTING_PARAMS = ['idOrSlug'];

    /**
     * Routes whose single path parameter the shared fixture maps cannot place,
     * resolved here so the published figures of the other sweeps do not move.
     * Path before the parameter (after api/v2/) => fixture key.
     */
    private const EXTRA_PREFIX_FIXTURES = [
        'group-chatrooms' => 'group_chatroom',
    ];

    /**
     * Parameterless routes that answer nothing (or 400) without a query string.
     * They are requested bare AND with this query. `{key}` is the owner's
     * fixture id of that type; `{owner}` is the owner's user id. The search
     * term is the shared prefix of every seeded FIRST name — never a surname.
     */
    private const QUERIES = [
        'GET api/v2/search' => 'q=Zqxfirst',
        'GET api/v2/search/suggestions' => 'q=Zqxfirst',
        'GET api/v2/users/search' => 'q=Zqxfirst',
        'GET api/v2/wallet/user-search' => 'q=Zqxfirst',
        'GET api/v2/mentions/search' => 'q=Zqxfirst',
        'GET api/v2/jobs/talent-search' => 'q=Zqxfirst',
        'GET api/v2/skills/members' => 'q=Zqxfirst',
        'GET api/v2/comments' => 'target_type=post&target_id={feed_post}',
        'GET api/v2/gamification/profile' => 'user_id={owner}',
    ];

    private int $ownerUserId = 0;

    /** @var array<string,int|string> */
    private array $ownerIds = [];

    /** @var array<string,int|string> */
    private array $viewerIds = [];

    /** @var array<string,int> table => rows planted */
    private array $planted = [];

    /** @var list<string> */
    private array $plantFailures = [];

    protected function setUp(): void
    {
        parent::setUp();

        // Hundreds of requests from one client in seconds would only measure the
        // rate limiter, which has its own tests.
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);

        // No GET route may reach an outside service from a test run.
        Http::preventStrayRequests();
        Cache::flush();
    }

    // ================================================================
    // The sweep
    // ================================================================

    public function test_no_member_facing_get_route_shows_another_members_surname_beyond_the_baseline(): void
    {
        $routes = $this->classifyGetRoutes();
        $inPass = array_filter($routes, static fn (array $r): bool => $r['pass'] === 'member');
        $this->assertNotEmpty($inPass, 'Route enumeration produced nothing — the sweep would pass vacuously.');

        $viewer = $this->seedCommunity();

        $results = [];
        foreach ($inPass as $key => $route) {
            $results[$key] = $this->exerciseRoute($route, $viewer);
        }
        ksort($results);

        $summary = $this->summarise($routes, $results);
        $this->printSummary($summary, $results);
        $this->writeRouteEvidence($summary, $results);

        $leaks = array_filter($results, static fn (array $r): bool => $r['surnames'] !== []);
        $baseline = $this->readBaseline();

        $mode = (string) getenv('SURNAME_SWEEP_WRITE_BASELINE');
        if ($mode !== '' && $mode !== '0') {
            $baseline = $this->writeBaseline($mode, $baseline, $results, $summary);
        }

        $known = $baseline['known_leaks'];

        // GATE 1 — a leak that is not in the baseline is a NEW leak.
        $new = [];
        foreach ($leaks as $key => $r) {
            if (! array_key_exists($key, $known)) {
                $new[] = $key . ' -> ' . implode(',', $r['surnames']) . ' in ' . implode(' | ', array_slice($r['fields'], 0, 4));
            }
        }
        $this->assertSame([], $new, sprintf(
            "%d member-facing GET route(s) show another member's surname and are not in the baseline. "
            . 'Fix the route (first name / organisation name for non-admins). The baseline may only shrink; '
            . 'do not add to it. See the class docblock.',
            count($new)
        ));

        // GATE 2 — a baseline entry that no longer leaks must be accounted for.
        $fixed = [];
        $unexercised = [];
        $gone = [];
        foreach (array_keys($known) as $key) {
            if (! array_key_exists($key, $routes)) {
                $gone[] = $key;
            } elseif (! isset($results[$key])) {
                $unexercised[] = $key . ' (now outside the member pass: ' . $routes[$key]['pass'] . ')';
            } elseif ($results[$key]['surnames'] === []) {
                if ($results[$key]['outcome'] === 'data' && $results[$key]['names_a_seeded_person']) {
                    $fixed[] = $key;
                } else {
                    $unexercised[] = $key . ' (' . $results[$key]['outcome'] . ' ' . $results[$key]['status_label'] . ')';
                }
            }
        }
        $this->assertSame([], $gone, 'Baseline entries name routes that no longer exist. Remove them from ' . basename(self::BASELINE_FILE) . '.');
        $this->assertSame([], $fixed, 'These baseline routes no longer leak a surname. Remove them from '
            . basename(self::BASELINE_FILE) . ' in the same commit as the fix (or run with SURNAME_SWEEP_WRITE_BASELINE=shrink).');
        $this->assertSame([], $unexercised, 'These baseline routes did not leak on this run, but NOT because they were fixed: '
            . 'they were no longer exercised with a seeded person in the body. That is a broken proof. '
            . 'Repair the fixtures; do not remove the entries.');

        // GATE 3 — coverage floors, so fixture rot cannot make this vacuous.
        foreach ($baseline['coverage_floor'] as $counter => $floor) {
            $this->assertGreaterThanOrEqual(
                (int) $floor,
                $summary[$counter] ?? 0,
                "Coverage counter '{$counter}' fell below its recorded floor. The sweep is exercising fewer routes than it did — fix the fixtures."
            );
        }

        $this->assertGreaterThan(0, $summary['served_with_data'], 'No route returned data — nothing was proved.');
    }

    /**
     * E-122 stage 4 — the same sweep, after STAFF have been everywhere first.
     *
     * Since the central rule was switched on, a name is built for whoever is
     * looking. A payload that is cached for the whole community and built
     * while an administrator or broker is looking would therefore hold
     * surnames, and be handed to the next member (Explore did exactly that).
     * So an administrator and then a broker call every member-facing route,
     * nothing is flushed, and the member pass is run on top of whatever they
     * left behind. No route may leak that is not already in the baseline.
     *
     * One-directional on purpose: this pass never shrinks or rewrites the
     * baseline, and it does not care which baseline routes still leak.
     */
    public function test_a_member_sees_no_new_surname_after_staff_have_warmed_every_cache(): void
    {
        $routes = $this->classifyGetRoutes();
        $inPass = array_filter($routes, static fn (array $r): bool => $r['pass'] === 'member');
        $this->assertNotEmpty($inPass);

        $viewer = $this->seedCommunity();

        foreach ([['role' => 'admin'], ['role' => 'broker']] as $staffAttributes) {
            $staff = $this->actAs($staffAttributes + [
                'first_name' => 'Zqxfirststaff',
                'last_name' => 'Zqxstaffnotscanned',
                'name' => 'Zqxfirststaff Zqxstaffnotscanned',
            ]);
            TenantContext::setById($this->testTenantId);
            foreach ($inPass as $route) {
                $this->exerciseRoute($route, $staff);
            }
        }

        // Back to the ordinary member — with every cache as staff left it.
        auth()->forgetGuards();
        $this->flushHeaders();
        \Laravel\Sanctum\Sanctum::actingAs($viewer, ['*']);
        TenantContext::setById($this->testTenantId);

        $known = $this->readBaseline()['known_leaks'];
        $new = [];
        $withData = 0;
        foreach ($inPass as $key => $route) {
            $r = $this->exerciseRoute($route, $viewer);
            if ($r['outcome'] === 'data') {
                $withData++;
            }
            if ($r['surnames'] !== [] && ! array_key_exists($key, $known)) {
                $new[] = $key . ' -> ' . implode(',', $r['surnames']) . ' in ' . implode(' | ', array_slice($r['fields'], 0, 4));
            }
        }

        $this->assertGreaterThan(100, $withData, 'The member pass returned data on too few routes to prove anything.');
        $this->assertSame([], $new, sprintf(
            '%d member-facing GET route(s) show a member a surname ONLY after staff have loaded them first: '
            . 'a payload shared by the whole community is being built with the names staff may see. '
            . 'Build it inside NameAudience::withPublicNames().',
            count($new)
        ));
    }

    // ================================================================
    // Guards that must stay green through every later E-122 stage
    // ================================================================

    /**
     * The erasure guard. If a member's own account stops carrying their
     * surname, an edit-profile form can post an empty one back and wipe it.
     */
    public function test_a_member_still_sees_their_own_surname_on_their_own_account_and_profile(): void
    {
        $viewer = $this->actAs([
            'role' => 'member',
            'first_name' => self::VIEWER[0],
            'last_name' => self::VIEWER[1],
            'name' => self::VIEWER[0] . ' ' . self::VIEWER[1],
        ]);
        TenantContext::setById($this->testTenantId);

        foreach (['/v2/users/me', '/v2/users/' . $viewer->id] as $uri) {
            $response = $this->apiGet($uri);
            $response->assertStatus(200);

            $found = $this->valuesForKey((array) $response->json(), 'last_name');
            $this->assertContains(
                self::VIEWER[1],
                $found,
                "GET {$uri} no longer returns the member's own last_name. A client that prefills an edit form from this would erase the surname."
            );
            $this->assertStringContainsString(self::VIEWER[1], (string) $response->getContent());
        }
    }

    public function test_an_admin_still_sees_surnames_on_the_admin_member_list(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
            'first_name' => self::PEOPLE['owner'][0],
            'last_name' => self::PEOPLE['owner'][1],
            'name' => implode(' ', self::PEOPLE['owner']),
        ]);
        TenantContext::setById($this->testTenantId);

        $this->actAs(['role' => 'admin']);
        TenantContext::setById($this->testTenantId);

        $list = $this->apiGet('/v2/admin/users?search=' . self::PEOPLE['owner'][0] . '&per_page=100');
        $list->assertStatus(200);
        $this->assertStringContainsString(
            self::PEOPLE['owner'][1],
            (string) $list->getContent(),
            'The admin member list no longer shows a surname. Admins are the one audience allowed to see them.'
        );

        $detail = $this->apiGet('/v2/admin/users/' . $member->id);
        $detail->assertStatus(200);
        $this->assertStringContainsString(
            self::PEOPLE['owner'][1],
            (string) $detail->getContent(),
            'The admin member record no longer shows a surname.'
        );
    }

    // ================================================================
    // Route table
    // ================================================================

    /**
     * Every registered GET route, keyed "GET <uri>", with the pass it belongs to.
     *
     * @return array<string,array{uri:string,pass:string,features:list<string>,action:string}>
     */
    private function classifyGetRoutes(): array
    {
        $router = app('router');
        $out = [];

        foreach (Route::getRoutes() as $route) {
            /** @var RoutingRoute $route */
            if (! in_array('GET', $route->methods(), true)) {
                continue;
            }

            $uri = $route->uri();
            $key = 'GET ' . $uri;
            if (isset($out[$key])) {
                continue;
            }

            $pass = 'member';
            $features = [];

            if (! str_starts_with($uri, 'api/')) {
                $pass = 'not under api/ (framework, sitemap, storage, newsletter tracking)';
            } else {
                foreach ($router->gatherRouteMiddleware($route) as $middleware) {
                    if (! is_string($middleware)) {
                        continue;
                    }
                    [$class, $argument] = array_pad(explode(':', $middleware, 2), 2, '');
                    $class = ltrim($class, '\\');

                    if (isset(self::OTHER_PASS_MIDDLEWARE[$class])) {
                        $pass = self::OTHER_PASS_MIDDLEWARE[$class];
                        break;
                    }
                    if ($class === \App\Middleware\TenantFeatureMiddleware::class && $argument !== '') {
                        $features[] = $argument;
                    }
                }
            }

            $out[$key] = ['uri' => $uri, 'pass' => $pass, 'features' => $features, 'action' => $route->getActionName()];
        }

        ksort($out);

        return $out;
    }

    // ================================================================
    // Fixtures
    // ================================================================

    private function seedCommunity(): User
    {
        $tenantId = $this->testTenantId;
        $maxUserIdBefore = (int) DB::table('users')->max('id');

        // Every feature a member-facing route is gated on, except the ones the
        // owner has ruled must never be turned on.
        $features = array_keys(\App\Services\TenantFeatureConfig::FEATURE_DEFAULTS);
        foreach ($this->classifyGetRoutes() as $route) {
            $features = array_merge($features, $route['features']);
        }
        $features = array_values(array_diff(array_unique($features), self::FEATURES_LEFT_OFF));
        $this->enableTenantFeatures($features, $tenantId);

        $owner = $this->person('owner');
        $other = $this->person('other');
        $organisation = $this->person('contact', [
            'profile_type' => 'organisation',
            'organization_name' => self::ORGANISATION_NAME,
        ]);

        $blocked = $this->person('blocked');
        $this->ownerUserId = (int) $owner->id;

        $this->ownerIds = $this->seedRecords($tenantId, $owner);
        $this->pinPublic($this->ownerIds);

        $viewer = $this->actAs([
            'role' => 'member',
            'first_name' => self::VIEWER[0],
            'last_name' => self::VIEWER[1],
            'name' => self::VIEWER[0] . ' ' . self::VIEWER[1],
        ]);
        $this->viewerIds = $this->seedRecords($tenantId, $viewer);
        $this->pinPublic($this->viewerIds);

        // The owner's two-party records name the VIEWER as the other party (so
        // the viewer is entitled to open them); the viewer's own name `other`.
        $this->linkParties($this->ownerIds, $owner, $viewer);
        $this->linkParties($this->viewerIds, $viewer, $other);

        $this->plantRelationships($viewer, $owner, $other, $organisation, $blocked);

        // Factories create people on the side (a message's receiver, a review's
        // author, the 'user' fixture). Their faker surnames would be invisible
        // to a substring search, so every person this test created who is not a
        // named actor gets the distinctive "factory" name.
        DB::table('users')
            ->where('id', '>', $maxUserIdBefore)
            ->whereNotIn('id', [$viewer->id, $owner->id, $other->id, $organisation->id, $blocked->id])
            ->update([
                'first_name' => self::PEOPLE['factory'][0],
                'last_name' => self::PEOPLE['factory'][1],
                'name' => implode(' ', self::PEOPLE['factory']),
            ]);

        TenantContext::setById($tenantId);
        Cache::flush();

        return $viewer;
    }

    /** @param array<string,mixed> $extra */
    private function person(string $label, array $extra = []): User
    {
        [$first, $last] = self::PEOPLE[$label];

        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'is_super_admin' => false,
            'is_tenant_super_admin' => false,
            'role' => 'member',
            'first_name' => $first,
            'last_name' => $last,
            'name' => $first . ' ' . $last,
        ], $extra));
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    /**
     * The factories randomise visibility; pin the seeded records public so the
     * same routes carry data on every run (same pins as the same-community sweep).
     *
     * @param array<string,int|string> $ids
     */
    private function pinPublic(array $ids): void
    {
        $pins = [
            'goal' => ['goals', ['is_public' => 1, 'status' => 'active']],
            'feed_post' => ['feed_posts', ['visibility' => 'public', 'publish_status' => 'published']],
            'vol_opportunity' => ['vol_opportunities', ['is_active' => 1, 'status' => 'open']],
            'job' => ['job_vacancies', ['status' => 'open', 'moderation_status' => 'approved']],
            'event' => ['events', ['status' => 'active']],
            'listing' => ['listings', ['status' => 'active']],
        ];

        foreach ($pins as $key => [$table, $values]) {
            if (! isset($ids[$key])) {
                continue;
            }
            $present = array_filter($values, static fn ($v, string $column): bool => Schema::hasColumn($table, $column), ARRAY_FILTER_USE_BOTH);
            if ($present !== []) {
                DB::table($table)->where('id', $ids[$key])->update($present);
            }
        }

        if (isset($ids['comment'], $ids['feed_post'])) {
            DB::table('comments')->where('id', $ids['comment'])
                ->update(['target_type' => 'post', 'target_id' => $ids['feed_post']]);
        }
    }

    /**
     * Factories give two-party records a RANDOM second party and leave child
     * records pointing at nothing, so the routes behind them answer 404 or an
     * empty list. Point each at real people from this seed set and publish the
     * records that default to draft. Only columns that exist are touched.
     *
     * @param array<string,int|string> $ids
     */
    private function linkParties(array $ids, User $setOwner, User $counterparty): void
    {
        $o = $setOwner->id;
        $c = $counterparty->id;

        $updates = [
            'course' => ['courses', ['status' => 'published', 'moderation_status' => 'approved', 'visibility' => 'public']],
            'marketplace_listing' => ['marketplace_listings', ['status' => 'active', 'moderation_status' => 'approved']],
            'podcast_show' => ['podcast_shows', ['status' => 'published', 'moderation_status' => 'approved', 'visibility' => 'public']],
            'ideation_challenge' => ['ideation_challenges', ['status' => 'open']],
            'kb_article' => ['knowledge_base_articles', ['created_by' => $o]],
            'goal' => ['goals', ['buddy_id' => $c]],
            'transaction' => ['transactions', ['sender_id' => $o, 'receiver_id' => $c, 'status' => 'completed']],
            'message' => ['messages', ['sender_id' => $o, 'receiver_id' => $c]],
            'review' => ['reviews', ['reviewer_id' => $c, 'receiver_id' => $o, 'status' => 'approved', 'is_anonymous' => 0]],
            'notification' => ['notifications', ['user_id' => $o, 'actor_id' => $c]],
            'exchange_request' => ['exchange_requests', ['requester_id' => $c, 'provider_id' => $o] + (isset($ids['listing']) ? ['listing_id' => $ids['listing']] : [])],
            'job_application' => ['job_applications', ['user_id' => $c] + (isset($ids['job']) ? ['vacancy_id' => $ids['job']] : [])],
            'vol_opportunity' => ['vol_opportunities', ['created_by' => $o] + (isset($ids['vol_organization']) ? ['organization_id' => $ids['vol_organization']] : [])],
        ];

        foreach ($updates as $key => [$table, $values]) {
            if (! isset($ids[$key])) {
                continue;
            }
            try {
                $present = array_intersect_key($values, array_flip(Schema::getColumnListing($table)));
                if ($present !== []) {
                    DB::table($table)->where('id', $ids[$key])->update($present);
                }
            } catch (\Throwable $e) {
                $this->plantFailures[] = "link {$table}: " . mb_substr($e->getMessage(), 0, 140);
            }
        }
    }

    /**
     * The cheap relationships that put ANOTHER person's name into the viewer's
     * own lists: counterparty, sender, reviewer, attendee, group member,
     * connection, commenter. Best effort — a row that cannot be planted is
     * printed, never hidden.
     */
    private function plantRelationships(User $viewer, User $owner, User $other, User $organisation, User $blocked): void
    {
        $t = $this->testTenantId;
        $now = now();

        foreach ([[$this->ownerIds, [$viewer, $other]], [$this->viewerIds, [$other, $owner]]] as [$ids, $people]) {
            foreach ($people as $person) {
                if (isset($ids['group'])) {
                    $this->plant('group_members', [
                        'tenant_id' => $t, 'group_id' => $ids['group'], 'user_id' => $person->id,
                        'status' => 'active', 'role' => 'member', 'joined_at' => $now, 'created_at' => $now, 'updated_at' => $now,
                    ]);
                }
                if (isset($ids['event']) && $person->id !== $viewer->id) {
                    $this->plant('event_rsvps', [
                        'tenant_id' => $t, 'event_id' => $ids['event'], 'user_id' => $person->id,
                        'status' => 'going', 'created_at' => $now, 'updated_at' => $now,
                    ]);
                    $this->plant('event_registrations', [
                        'tenant_id' => $t, 'event_id' => $ids['event'], 'user_id' => $person->id,
                        'capacity_pool_key' => 'general', 'registration_state' => 'confirmed', 'registration_version' => 1,
                        'party_size' => 1, 'state_changed_at' => $now, 'confirmed_at' => $now, 'created_at' => $now, 'updated_at' => $now,
                    ]);
                }
                if (isset($ids['feed_post'])) {
                    $this->plant('comments', [
                        'tenant_id' => $t, 'user_id' => $person->id, 'target_type' => 'post', 'target_id' => $ids['feed_post'],
                        'content' => 'Sweep comment', 'created_at' => $now, 'updated_at' => $now,
                    ]);
                }
            }
        }

        foreach ([[$other, $viewer], [$viewer, $other], [$owner, $viewer]] as [$from, $to]) {
            $this->plant('transactions', [
                'tenant_id' => $t, 'sender_id' => $from->id, 'receiver_id' => $to->id, 'amount' => 1,
                'description' => 'Sweep exchange', 'status' => 'completed', 'transaction_type' => 'transfer',
                'created_at' => $now, 'updated_at' => $now,
            ]);
            $this->plant('messages', [
                'tenant_id' => $t, 'sender_id' => $from->id, 'receiver_id' => $to->id, 'body' => 'Sweep message',
                'is_voice' => 0, 'is_read' => 0, 'is_deleted_sender' => 0, 'is_deleted_receiver' => 0, 'created_at' => $now,
            ]);
            $this->plant('reviews', [
                'tenant_id' => $t, 'reviewer_id' => $from->id, 'receiver_id' => $to->id, 'rating' => 5,
                'comment' => 'Sweep review', 'review_type' => 'local', 'status' => 'approved', 'is_anonymous' => 0,
                'show_cross_tenant' => 0, 'created_at' => $now, 'updated_at' => $now,
            ]);
        }

        foreach ([$other, $owner, $organisation] as $person) {
            $this->plant('connections', [
                'tenant_id' => $t, 'requester_id' => $person->id, 'receiver_id' => $viewer->id,
                'status' => 'accepted', 'created_at' => $now, 'updated_at' => $now,
            ]);
        }

        // A join request waiting on the viewer's own group; an application to
        // the viewer's own volunteering opportunity; a member the viewer blocked;
        // a shared resource uploaded by the owner.
        if (isset($this->viewerIds['group'])) {
            $this->plant('group_members', [
                'tenant_id' => $t, 'group_id' => $this->viewerIds['group'], 'user_id' => $organisation->id,
                'status' => 'pending', 'role' => 'member', 'created_at' => $now, 'updated_at' => $now,
            ]);
        }
        if (isset($this->viewerIds['vol_opportunity'])) {
            $this->plant('vol_applications', [
                'tenant_id' => $t, 'opportunity_id' => $this->viewerIds['vol_opportunity'], 'user_id' => $other->id,
                'status' => 'pending', 'message' => 'Sweep application', 'created_at' => $now, 'updated_at' => $now,
            ]);
        }
        $this->plant('user_blocks', [
            'tenant_id' => $t, 'user_id' => $viewer->id, 'blocked_user_id' => $blocked->id, 'blocker_user_id' => $viewer->id,
            'created_at' => $now, 'updated_at' => $now,
        ]);
        $this->plant('resources', [
            'tenant_id' => $t, 'user_id' => $owner->id, 'title' => 'Sweep resource', 'description' => 'Sweep resource',
            'file_path' => 'resources/sweep.txt', 'file_type' => 'text/plain', 'file_size' => 14, 'downloads' => 0,
            'content_type' => 'plain', 'sort_order' => 0, 'created_at' => $now, 'updated_at' => $now,
        ]);

        // One public listing by the organisation account, so "an organisation
        // keeps its trading name, never the contact's surname" is exercised.
        try {
            \App\Models\Listing::factory()->forTenant($t)->create(['user_id' => $organisation->id, 'status' => 'active']);
            $this->planted['listings (organisation)'] = 1;
        } catch (\Throwable $e) {
            $this->plantFailures[] = 'listings (organisation): ' . mb_substr($e->getMessage(), 0, 140);
        }
        TenantContext::setById($t);
    }

    /** @param array<string,mixed> $row */
    private function plant(string $table, array $row): void
    {
        try {
            $columns = array_flip(Schema::getColumnListing($table));
            DB::table($table)->insert(array_intersect_key($row, $columns));
            $this->planted[$table] = ($this->planted[$table] ?? 0) + 1;
        } catch (\Throwable $e) {
            $this->plantFailures[] = $table . ': ' . mb_substr($e->getMessage(), 0, 140);
        }
    }

    // ================================================================
    // Requests
    // ================================================================

    /**
     * Call one route — once if it has no path parameter, otherwise once with
     * the owner's records and once with the viewer's own — and fold the answers.
     *
     * @param  array{uri:string,pass:string,features:list<string>,action:string}  $route
     * @return array<string,mixed>
     */
    private function exerciseRoute(array $route, User $viewer): array
    {
        $result = [
            'uri' => $route['uri'],
            'outcome' => 'not_called',
            'status_label' => '',
            'reason' => '',
            'requests' => 0,
            'surnames' => [],
            'fields' => [],
            'names_a_seeded_person' => false,
        ];

        $leftOff = array_intersect($route['features'], self::FEATURES_LEFT_OFF);
        if ($leftOff !== []) {
            $result['reason'] = 'feature deliberately left off: ' . implode(',', $leftOff);

            return $result;
        }

        $targets = [];
        $unfillable = null;

        if (! str_contains($route['uri'], '{')) {
            $targets[$route['uri']] = true;

            $query = self::QUERIES['GET ' . $route['uri']] ?? null;
            if ($query !== null) {
                $query = (string) preg_replace_callback(
                    '/\{([a-z_]+)\}/',
                    fn (array $m): string => (string) ($m[1] === 'owner' ? $this->ownerUserId : ($this->ownerIds[$m[1]] ?? 0)),
                    $query
                );
                $targets[$route['uri'] . '?' . $query] = true;
            }
        } else {
            foreach ([$this->ownerIds, $this->viewerIds] as $ids) {
                [$filled, $why] = $this->fill($route['uri'], $ids);
                if ($filled === null) {
                    $unfillable ??= $why;

                    continue;
                }
                $targets[$filled] = true;
            }
        }

        if ($targets === []) {
            $result['reason'] = 'path parameter could not be filled: ' . ($unfillable ?? 'unknown');

            return $result;
        }

        // Rank of what a single response proves; the route keeps its best.
        $rank = ['threw' => 0, '5xx' => 1, '4xx' => 2, '3xx' => 3, 'empty' => 4, 'data' => 5];
        $best = -1;

        foreach (array_keys($targets) as $uri) {
            $answer = $this->get2($uri);
            $result['requests']++;

            $scan = $this->scan($answer['body']);
            $result['surnames'] = array_values(array_unique(array_merge($result['surnames'], $scan['surnames'])));
            $result['fields'] = array_values(array_unique(array_merge($result['fields'], $scan['fields'])));

            $status = $answer['status'];
            if ($status === null) {
                $outcome = 'threw';
                $label = $answer['error'];
            } elseif ($status >= 200 && $status < 300) {
                $outcome = $this->responseCarriesData($answer['body']) ? 'data' : 'empty';
                $label = (string) $status;
            } else {
                $outcome = intdiv($status, 100) . 'xx';
                $label = (string) $status;
                if ($status === 403 && preg_match('/FEATURE_DISABLED|GROUP_TAB_DISABLED|MODULE_DISABLED/', $answer['body'])) {
                    $label = '403 feature/module/tab off';
                }
            }

            if ($outcome === 'data' && $scan['names_a_seeded_person']) {
                $result['names_a_seeded_person'] = true;
            }

            if ($rank[$outcome] > $best) {
                $best = $rank[$outcome];
                $result['outcome'] = $outcome;
                $result['status_label'] = $label;
            }
        }

        sort($result['surnames']);
        sort($result['fields']);
        $result['fields'] = array_slice($result['fields'], 0, 12);

        // The actor is re-asserted because a few GET routes sign the caller out
        // or swap the guard; the next route must still be asked as the member.
        if (auth()->id() !== $viewer->id) {
            auth()->forgetGuards();
            \Laravel\Sanctum\Sanctum::actingAs($viewer, ['*']);
        }
        TenantContext::setById($this->testTenantId);

        return $result;
    }

    /**
     * Substitute a fixture id for every path parameter.
     *
     * @param  array<string,int|string>  $ids
     * @return array{0:?string,1:?string} [filled uri, why not]
     */
    private function fill(string $uri, array $ids): array
    {
        $path = preg_replace('#^api/(v2/)?#', '', $uri);
        preg_match_all('/\{([^}]+)\}/', $uri, $matches);

        $filled = $uri;
        foreach ($matches[1] as $raw) {
            $param = rtrim($raw, '?');

            if (in_array($param, self::ID_ACCEPTING_PARAMS, true)) {
                $before = substr((string) $path, 0, (int) strpos((string) $path, '{' . $raw . '}'));
                $prefix = trim((string) preg_replace('#/+#', '/', (string) preg_replace('/\{[^}]+\}/', '', $before)), '/');
                [$key, $why] = $this->resolve($prefix, 'id');
            } else {
                [$key, $why] = $this->resolveChildParam((string) $path, $param);

                if ($key === null && count($matches[1]) === 1) {
                    $prefix = rtrim(substr((string) $path, 0, (int) strpos((string) $path, '{')), '/');
                    if (isset(self::EXTRA_PREFIX_FIXTURES[$prefix])) {
                        [$key, $why] = [self::EXTRA_PREFIX_FIXTURES[$prefix], null];
                    }
                }
            }

            if ($key === null) {
                return [null, $why ?? "no fixture for {{$param}}"];
            }
            if (! isset($ids[$key])) {
                return [null, "fixture '{$key}' could not be seeded"];
            }

            $filled = (string) preg_replace('/' . preg_quote('{' . $raw . '}', '/') . '/', (string) $ids[$key], $filled, 1);
        }

        return [$filled, null];
    }

    /** @return array{status:?int,body:string,error:string} */
    private function get2(string $uri): array
    {
        try {
            $response = $this->getJson('/' . ltrim($uri, '/'), $this->withTenantHeader());
            $base = $response->baseResponse;

            if ($base instanceof BinaryFileResponse) {
                $body = (string) @file_get_contents($base->getFile()->getPathname());
            } elseif ($base instanceof StreamedResponse) {
                $body = $response->streamedContent();
            } else {
                $body = (string) $response->getContent();
            }

            return ['status' => $response->getStatusCode(), 'body' => $body, 'error' => ''];
        } catch (\Throwable $e) {
            return ['status' => null, 'body' => '', 'error' => class_basename($e)];
        }
    }

    /**
     * Which seeded surnames are in this body, and in which JSON fields.
     *
     * The body is decoded and re-encoded with unescaped unicode first so a
     * `\uXXXX` escape cannot hide a name; a non-JSON body (CSV, iCalendar,
     * HTML) is searched as text. The viewer's own surname is ignored.
     *
     * @return array{surnames:list<string>,fields:list<string>,names_a_seeded_person:bool}
     */
    private function scan(string $body): array
    {
        $decoded = json_decode($body, true);
        $text = is_array($decoded)
            ? (string) json_encode($decoded, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
            : $body;

        $surnames = [];
        $named = false;
        foreach (self::PEOPLE as $label => [$first, $last]) {
            if (stripos($text, $last) !== false) {
                $surnames[] = $label;
                $named = true;
            }
            if (stripos($text, $first) !== false) {
                $named = true;
            }
        }
        if (stripos($text, self::ORGANISATION_NAME) !== false) {
            $named = true;
        }

        $fields = [];
        if ($surnames !== []) {
            if (is_array($decoded)) {
                $this->collectFields($decoded, '', $fields);
                $fields = array_keys($fields);
            } else {
                $fields = ['(non-JSON body)'];
            }
        }

        return ['surnames' => $surnames, 'fields' => $fields, 'names_a_seeded_person' => $named];
    }

    /**
     * @param  array<mixed>  $node
     * @param  array<string,true>  $fields
     */
    private function collectFields(array $node, string $path, array &$fields): void
    {
        foreach ($node as $key => $value) {
            $here = $path === '' ? (is_int($key) ? '*' : (string) $key) : $path . '.' . (is_int($key) ? '*' : (string) $key);

            if (is_array($value)) {
                $this->collectFields($value, $here, $fields);

                continue;
            }
            if (! is_string($value)) {
                continue;
            }
            foreach (self::PEOPLE as [, $last]) {
                if (stripos($value, $last) !== false) {
                    $fields[$here] = true;

                    break;
                }
            }
        }
    }

    /**
     * @param  array<mixed>  $node
     * @return list<mixed>
     */
    private function valuesForKey(array $node, string $wanted): array
    {
        $found = [];
        foreach ($node as $key => $value) {
            if ($key === $wanted) {
                $found[] = $value;
            }
            if (is_array($value)) {
                $found = array_merge($found, $this->valuesForKey($value, $wanted));
            }
        }

        return $found;
    }

    // ================================================================
    // Accounting
    // ================================================================

    /**
     * @param  array<string,array{uri:string,pass:string,features:list<string>,action:string}>  $routes
     * @param  array<string,array<string,mixed>>  $results
     * @return array<string,mixed>
     */
    private function summarise(array $routes, array $results): array
    {
        $otherPasses = [];
        foreach ($routes as $route) {
            if ($route['pass'] !== 'member') {
                $otherPasses[$route['pass']] = ($otherPasses[$route['pass']] ?? 0) + 1;
            }
        }
        ksort($otherPasses);

        $summary = [
            'get_routes_registered' => count($routes),
            'outside_member_pass' => array_sum($otherPasses),
            'outside_member_pass_by_reason' => $otherPasses,
            'member_pass_routes' => count($results),
            'called' => 0,
            'requests_made' => 0,
            'served_with_data' => 0,
            'served_with_data_naming_a_seeded_person' => 0,
            'served_with_data_naming_nobody' => 0,
            'served_empty' => 0,
            'not_served_by_status' => [],
            'threw' => 0,
            'not_called' => 0,
            'not_called_by_reason' => [],
            'leaking_routes' => 0,
            'clean_with_a_seeded_person_in_the_body' => 0,
        ];

        foreach ($results as $r) {
            $summary['requests_made'] += $r['requests'];

            if ($r['surnames'] !== []) {
                $summary['leaking_routes']++;
            }

            if ($r['outcome'] === 'not_called') {
                $summary['not_called']++;
                $reason = (string) preg_replace("/'[^']+'/", "'…'", $r['reason']);
                $summary['not_called_by_reason'][$reason] = ($summary['not_called_by_reason'][$reason] ?? 0) + 1;

                continue;
            }

            $summary['called']++;

            switch ($r['outcome']) {
                case 'data':
                    $summary['served_with_data']++;
                    if ($r['names_a_seeded_person']) {
                        $summary['served_with_data_naming_a_seeded_person']++;
                        if ($r['surnames'] === []) {
                            $summary['clean_with_a_seeded_person_in_the_body']++;
                        }
                    } else {
                        $summary['served_with_data_naming_nobody']++;
                    }
                    break;
                case 'empty':
                    $summary['served_empty']++;
                    break;
                case 'threw':
                    $summary['threw']++;
                    break;
                default:
                    $label = $r['status_label'];
                    $summary['not_served_by_status'][$label] = ($summary['not_served_by_status'][$label] ?? 0) + 1;
            }
        }

        ksort($summary['not_served_by_status']);
        arsort($summary['not_called_by_reason']);

        return $summary;
    }

    /**
     * @param  array<string,mixed>  $s
     * @param  array<string,array<string,mixed>>  $results
     */
    private function printSummary(array $s, array $results): void
    {
        $lines = [
            '',
            '================ E-122 surname sweep — coverage ================',
            sprintf('GET routes registered ................................ %d', $s['get_routes_registered']),
            sprintf('  outside this pass (never counted as clean) .......... %d', $s['outside_member_pass']),
        ];
        foreach ($s['outside_member_pass_by_reason'] as $reason => $n) {
            $lines[] = sprintf('      %4d  %s', $n, $reason);
        }
        $lines[] = sprintf('  member-facing GET routes under api/ ................. %d', $s['member_pass_routes']);
        $lines[] = sprintf('    called ............................................ %d  (%d requests)', $s['called'], $s['requests_made']);
        $lines[] = sprintf('      2xx WITH DATA (the only ones that prove anything)  %d', $s['served_with_data']);
        $lines[] = sprintf('          body names a seeded person .................. %d', $s['served_with_data_naming_a_seeded_person']);
        $lines[] = sprintf('              shows a surname (LEAK) .................. %d', $s['served_with_data_naming_a_seeded_person'] - $s['clean_with_a_seeded_person_in_the_body']);
        $lines[] = sprintf('              first name / organisation only (clean) .. %d', $s['clean_with_a_seeded_person_in_the_body']);
        $lines[] = sprintf('          body names no seeded person (proves nothing)  %d', $s['served_with_data_naming_nobody']);
        $lines[] = sprintf('      2xx empty (proves nothing) ...................... %d', $s['served_empty']);
        foreach ($s['not_served_by_status'] as $label => $n) {
            $lines[] = sprintf('      %-48s %d', 'HTTP ' . $label . ' (proves nothing) ', $n);
        }
        $lines[] = sprintf('      threw (proves nothing) .......................... %d', $s['threw']);
        $lines[] = sprintf('    NOT called ........................................ %d', $s['not_called']);
        foreach ($s['not_called_by_reason'] as $reason => $n) {
            $lines[] = sprintf('      %4d  %s', $n, $reason);
        }
        $lines[] = sprintf('Routes showing another member\'s surname (any status) ... %d', $s['leaking_routes']);
        $lines[] = 'Relationship rows planted: ' . ($this->planted === [] ? 'none' : implode(', ', array_map(
            static fn (string $t, int $n): string => "{$t}={$n}",
            array_keys($this->planted),
            $this->planted
        )));
        foreach (array_unique($this->plantFailures) as $failure) {
            $lines[] = '  could not plant: ' . $failure;
        }
        $lines[] = '--- leaking routes ---';
        foreach ($results as $key => $r) {
            if ($r['surnames'] !== []) {
                $lines[] = sprintf('  %s  [%s]  %s', $key, implode(',', $r['surnames']), implode(' | ', array_slice($r['fields'], 0, 3)));
            }
        }
        // E-122 stage 4: places where a first name had to be LOOKED UP or GUESSED from a
        // stored full name because the select carried `name` only. Safe (never
        // a surname) but wrong for "Mary Anne" and for an organisation selected
        // without profile_type. Printed, not asserted: this is the work list
        // for widening those selects.
        $degraded = \App\Support\UserDisplayName::degradedCallSites();
        sort($degraded);
        $lines[] = sprintf('--- first name looked up or guessed from a stored full name: %d call site(s) ---', count($degraded));
        foreach ($degraded as $site) {
            $lines[] = '  ' . str_replace(base_path() . DIRECTORY_SEPARATOR, '', $site);
        }
        $lines[] = '================================================================';

        fwrite(STDERR, implode(PHP_EOL, $lines) . PHP_EOL);
    }

    /**
     * Per-route outcome (route, status, field paths — never a body) for a human
     * to read, written to the gitignored evidence directory.
     *
     * @param  array<string,mixed>  $summary
     * @param  array<string,array<string,mixed>>  $results
     */
    private function writeRouteEvidence(array $summary, array $results): void
    {
        $dir = dirname(__DIR__, 4) . '/.local-docs-archive/security-evidence';
        if (! is_dir($dir) && ! @mkdir($dir, 0o775, true) && ! is_dir($dir)) {
            return;
        }

        @file_put_contents($dir . '/surname-sweep.json', json_encode([
            'generated_at' => date('c'),
            'method' => 'Every member-facing GET route under api/, requested as an ordinary member of tenant ' . $this->testTenantId
                . '. Routes and JSON field paths only; no response bodies.',
            'summary' => $summary,
            'results' => $results,
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    }

    // ================================================================
    // Baseline
    // ================================================================

    /** @return array{known_leaks:array<string,array<string,mixed>>,coverage_floor:array<string,int>} */
    private function readBaseline(): array
    {
        if (! is_file(self::BASELINE_FILE)) {
            return ['known_leaks' => [], 'coverage_floor' => []];
        }

        $decoded = json_decode((string) file_get_contents(self::BASELINE_FILE), true);
        $this->assertIsArray($decoded, basename(self::BASELINE_FILE) . ' is not valid JSON.');

        return [
            'known_leaks' => (array) ($decoded['known_leaks'] ?? []),
            'coverage_floor' => array_map('intval', (array) ($decoded['coverage_floor'] ?? [])),
        ];
    }

    /**
     * Rewrite the baseline. `shrink` (the normal mode) can only remove entries
     * the run proved fixed and raise coverage floors. `grow` also admits routes
     * that leak and are not listed — see the class docblock for the one case
     * where that is legitimate. A missing file is created from the run.
     *
     * @param  array{known_leaks:array<string,array<string,mixed>>,coverage_floor:array<string,int>}  $baseline
     * @param  array<string,array<string,mixed>>  $results
     * @param  array<string,mixed>  $summary
     * @return array{known_leaks:array<string,array<string,mixed>>,coverage_floor:array<string,int>}
     */
    private function writeBaseline(string $mode, array $baseline, array $results, array $summary): array
    {
        $creating = ! is_file(self::BASELINE_FILE);
        $admitNew = $creating || $mode === 'grow';

        $known = [];
        foreach ($results as $key => $r) {
            $listed = array_key_exists($key, $baseline['known_leaks']);

            if ($r['surnames'] !== []) {
                if ($listed || $admitNew) {
                    $known[$key] = ['surnames' => $r['surnames'], 'fields' => $r['fields']];
                }

                continue;
            }

            // Listed but not leaking: dropped only when proved fixed.
            $provedFixed = $r['outcome'] === 'data' && $r['names_a_seeded_person'];
            if ($listed && ! $provedFixed) {
                $known[$key] = $baseline['known_leaks'][$key];
            }
        }
        ksort($known);

        // Floors sit a little under the measured figure so an unrelated route
        // change does not trip them, and never move down.
        $floor = [];
        foreach (['called', 'served_with_data', 'served_with_data_naming_a_seeded_person'] as $counter) {
            $floor[$counter] = max((int) floor($summary[$counter] * 0.95), $baseline['coverage_floor'][$counter] ?? 0);
        }

        $payload = [
            '_about' => 'E-122 surname sweep baseline (tests/Laravel/Feature/Security/SurnameSweepTest.php). '
                . 'known_leaks: member-facing GET routes that show another member\'s surname TODAY and are tolerated until fixed. '
                . 'SHRINK-ONLY, enforced both ways: a leaking route not listed fails; a listed route that no longer leaks fails until removed. '
                . 'Never add an entry to make a red run green. Regenerate with SURNAME_SWEEP_WRITE_BASELINE=shrink (see the test docblock). '
                . 'Routes and JSON field paths only; no response bodies.',
            'coverage_floor' => $floor,
            'known_leaks' => $known,
        ];

        $dir = dirname(self::BASELINE_FILE);
        if (! is_dir($dir)) {
            mkdir($dir, 0o775, true);
        }
        file_put_contents(self::BASELINE_FILE, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");

        fwrite(STDERR, sprintf(
            "[surname sweep] baseline %s (%s): %d known leak(s)%s",
            $creating ? 'created' : 'rewritten',
            $admitNew ? 'grow' : 'shrink',
            count($known),
            PHP_EOL
        ));

        return ['known_leaks' => $known, 'coverage_floor' => $floor];
    }
}
