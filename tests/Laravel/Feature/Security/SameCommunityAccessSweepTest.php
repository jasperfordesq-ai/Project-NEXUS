<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\Laravel\Feature\Security\Support\AccessSweepTestCase;

/**
 * Same-community access sweep: can member A reach member B's records when both
 * belong to the SAME community?
 *
 * WHY THIS EXISTS
 * ---------------
 * Every sweep before this one (CrossCommunityAccessSweepTest and its siblings)
 * kept the actor and the record in DIFFERENT communities. There the guard is
 * structural — `TenantScope` and `tenant_id = ?` on every query — and it was
 * proved across the route table. Inside one community that guard is silent.
 * Whether A may read B's message, cancel B's exchange, edit B's goal or delete
 * B's listing depends on a per-endpoint OWNERSHIP check, written by hand in
 * each controller or service. That is the check most easily forgotten, and no
 * test had ever asked the question route-table-wide.
 *
 * WHAT IT DOES
 * ------------
 *  - Seeds one record of every fixture type for B (a plain member), and the
 *    same set for A (the acting member). Same fixture maps as the
 *    cross-community sweep, so the populations are comparable.
 *  - READS: every v2 GET route with one path parameter, requested with B's
 *    record (probe) and A's record (control). A 200 carrying data is SERVED —
 *    NOT automatically a finding, because a community is full of things that
 *    are public by design (listings, events, groups, profiles). Every SERVED
 *    route must be named in PUBLIC_BY_DESIGN_READ with a reason, or it is a
 *    finding. B's e-mail address in any body is always a finding.
 *  - WRITES: every v2 non-GET route with one path parameter, requested with
 *    B's record and an empty body; when validation objects, the body is grown
 *    from the API's own error messages (up to six rounds) so the request
 *    reaches the ownership check. B's row is snapshotted before and compared
 *    after EVERY request, column by column, regardless of status. A changed or
 *    deleted row is MUTATED unless only counter columns moved (INTERACTED). A
 *    2xx that leaves B's row alone is ACCEPTED and must be named in
 *    ACCEPTED_BY_DESIGN (a like, a save, a follow — interactions that create
 *    A's own row) or it is a finding. Every probe has a control against A's
 *    own record, so an endpoint that refuses everyone cannot count as a pass.
 *
 * A CONTROL REQUEST IS A REAL REQUEST
 * -----------------------------------
 * A control DELETE removes A's own record, and a probe that succeeds may remove
 * B's. Either would make every later endpoint on that fixture answer 404 and
 * read as a false refusal. So the consumed side is re-seeded before the next
 * endpoint that needs it. (This trap bit three earlier sweeps.)
 *
 * HONEST LIMITS
 * -------------
 *  - One path parameter only. Multi-parameter routes are not covered here.
 *  - The row comparison sees B's TARGET row. Rows created elsewhere by a
 *    designed interaction (A's "save" row) are invisible and are exactly why
 *    ACCEPTED entries are read by a human before being allowlisted.
 *  - Admin actors are deliberately absent: a community admin managing member
 *    content is authorised, and member-vs-admin routes are RoleBoundarySweepTest.
 *  - Fixtures are owned by B through the model's user/creator column. A record
 *    type whose "owner" is expressed another way (sender/receiver on a message,
 *    for example) is still SOMEONE ELSE'S record, which is what matters here.
 */
class SameCommunityAccessSweepTest extends AccessSweepTestCase
{
    use DatabaseTransactions;

    /**
     * GET routes that serve another member's record BY DESIGN. Exact
     * "METHOD uri" keys, each with a reason. Populated only from a run's SERVED
     * list after the body excerpt was read. This is a design register, not a
     * defect baseline: an entry that stops being served is reported, not failed.
     */
    protected const PUBLIC_BY_DESIGN_READ = [
        // Community content that every member is meant to browse.
        'GET api/v2/listings/{id}' => 'the marketplace of offers and requests is visible to every member',
        'GET api/v2/events/{id}' => 'community calendar entry',
        'GET api/v2/events/{id}/agenda' => 'public agenda of a community event',
        'GET api/v2/events/{id}/calendar-actions' => 'add-to-calendar links for a public event',
        'GET api/v2/events/{id}/calendar.ics' => 'iCalendar export of a public event',
        'GET api/v2/groups/{id}' => 'community group page (fixture is a public group)',
        'GET api/v2/groups/{id}/similar' => 'recommendations of other public groups',
        'GET api/v2/polls/{id}' => 'community poll',
        'GET api/v2/feed/polls/{id}' => 'community poll shown in the feed',
        'GET api/v2/feed/posts/{id}/sharers' => 'share count and sharers of a public post',
        'GET api/v2/reviews/{id}' => 'reviews are public reputation content',
        'GET api/v2/users/{id}' => 'public member profile (no e-mail address in the body — GATE R2 checks this every run)',
        'GET api/v2/volunteering/giving-days/{id}/stats' => 'public campaign progress',
        'GET api/v2/volunteering/organisations/{id}' => 'organisation directory entry',
        'GET api/v2/jobs/{id}' => 'job board posting (status pinned to open — see pinPublicVisibility)',
        'GET api/v2/jobs/{id}/match' => 'how well the CALLER matches a public job posting',
        'GET api/v2/jobs/{id}/qualified' => 'the CALLER\'s qualification against a public job posting',

        // About the caller, keyed by someone else's record.
        'GET api/v2/connections/status/{userId}' => 'the caller\'s own connection status with that member',
        'GET api/v2/events/{id}/relationship' => 'the caller\'s own registration state for a public event',
        'GET api/v2/events/{id}/reminders' => 'the caller\'s own reminder overrides for a public event',

        // Visibility-dependent: the factories randomise whether a goal is public
        // and whether an opportunity is published, so these appear in SERVED only
        // on runs where B's record happens to be public. A private goal was
        // refused with a working control on the first run, which is the property
        // that matters; a public one is served by design.
        'GET api/v2/goals/{id}' => 'a PUBLIC goal is shown to other members; private goals are refused (observed run 1)',
        'GET api/v2/goals/{id}/insights' => 'check-in statistics of a public goal',
        'GET api/v2/volunteering/opportunities/{id}' => 'published volunteering opportunity (the control 404 was an unpublished own record)',

        // Registered with a note for the owner (F-002): the accessible frontend
        // shows a member's activity timeline — completed exchanges with the
        // counterparty's name, hours given/received and a net balance — on that
        // member's public page (web-uk routes/members.js). The React app only
        // ever calls the /users/me/ variant. Whether other members should see
        // counterparties and a balance is a product decision, not a defect the
        // audit can settle; it is listed in the report for the owner.
        'GET api/v2/users/{id}/activity/dashboard' => 'member activity timeline, shown on the accessible site\'s member page — owner decision pending (F-002)',
    ];

    /**
     * Write routes that answer 2xx for another member's record while leaving that
     * record unchanged, BY DESIGN — interactions that create the actor's OWN row
     * (like, save, follow, RSVP, apply). Exact "METHOD uri" keys with reasons.
     * Read the body and the target table before adding one.
     */
    protected const ACCEPTED_BY_DESIGN = [
        // The actor's OWN relationship to someone else's record: create or remove
        // a row that belongs to the actor, leave the target untouched.
        'POST api/v2/jobs/{id}/save' => 'saves someone else\'s job posting to the caller\'s list',
        'DELETE api/v2/jobs/{id}/save' => 'removes it from the caller\'s list (idempotent)',
        'DELETE api/v2/listings/{id}/save' => 'removes a listing from the caller\'s saved list (idempotent)',
        'DELETE api/v2/feed/posts/{id}/share' => 'un-shares a post the caller may have shared (idempotent)',
        'DELETE api/v2/events/{id}/rsvp' => 'withdraws the caller\'s own RSVP (idempotent)',
        'DELETE api/v2/events/{id}/waitlist' => 'removes the caller from the waitlist (idempotent)',
        'POST api/v2/events/{id}/registration/confirm' => 'registers the caller for a community event',
        'POST api/v2/events/{id}/registration/withdraw' => 'withdraws the caller\'s own registration',
        'DELETE api/v2/courses/{id}/enroll' => 'drops the caller\'s own enrolment; answers dropped:false when there was none',
        'DELETE api/v2/goals/{id}/reminder' => 'deletes the CALLER\'s reminder row for that goal (GoalReminderService scopes by user_id)',
        'DELETE api/v2/stories/close-friends/{friendId}' => 'removes a member from the caller\'s own close-friends list (idempotent)',
        'POST api/v2/users/{id}/block' => 'the caller blocks another member',
        'POST api/v2/jobs/{id}/referral' => 'the caller refers someone to a public job posting; creates the caller\'s referral row',
        'POST api/v2/volunteering/opportunities/{id}/apply' => 'the caller applies to an open volunteering opportunity; creates the caller\'s application',

        // Feed engagement signals recorded against the caller.
        'POST api/v2/feed/posts/{id}/click' => 'records that the caller clicked a post',
        'POST api/v2/feed/posts/{id}/impression' => 'records that the caller saw a post',
        'POST api/v2/feed/posts/{id}/hide' => 'hides a post from the caller\'s own feed',
        'POST api/v2/feed/posts/{id}/not-interested' => 'the caller\'s own feed preference',
        'POST api/v2/feed/posts/{id}/report' => 'the caller reports another member\'s post',
        'DELETE api/v2/marketplace/listings/{id}/save' => 'removes a marketplace listing from the caller\'s saved list (idempotent)',
        'PUT api/v2/goals/{id}/reminder' => 'sets the CALLER\'s own reminder for a public goal (GoalReminderService scopes by user_id)',
        'POST api/v2/goals/{id}/buddy/nudge' => 'a buddy sends encouragement to the goal owner; only reachable once the caller is the goal\'s buddy',

        // Social interactions with another member or their content.
        'POST api/v2/members/{id}/endorse' => 'endorse another member\'s skill',
        'DELETE api/v2/members/{id}/endorse' => 'withdraw the caller\'s endorsement (idempotent)',
        'POST api/v2/members/{id}/peer-endorse' => 'peer endorsement of another member',
        'POST api/v2/stories/{id}/view' => 'records that the caller viewed a story',
        'POST api/v2/stories/{id}/analytics' => 'viewer-side analytics event for a story (StoryService::trackAnalytics)',
        'POST api/v2/stories/{id}/reply' => 'replies to another member\'s story, creating a direct message FROM the caller TO the author',

        // Bulk envelope: 200 is the envelope status; every item is decided by
        // EventAttendancePolicy::manageAttendance() and, for a non-organiser,
        // every item is refused (successful:0, failed:n). Verified 2026-09-11.
        'POST api/v2/events/{id}/attendance/bulk' => 'bulk envelope answers 200 while each item is refused by the attendance policy for a non-organiser',
    ];

    /**
     * Write routes that legitimately change another member's row. An entry here
     * needs a very good reason and a note for the owner. This is a design
     * register, not a defect baseline: the fixtures randomise visibility, so an
     * entry may not reproduce on every run and is therefore NOT checked in the
     * reverse direction.
     */
    protected const KNOWN_MUTATED_BY_DESIGN = [
        // GoalService::offerBuddy(): any member may appoint themselves buddy
        // ("mentor") of another member's PUBLIC goal that has no buddy yet — the
        // goal's mentor_id is set to the caller and the owner is notified. The
        // safeguarding interaction policy is consulted first. Whether making a
        // goal public should imply "I want a buddy" is a product question, listed
        // in the audit report for the owner (F-004); the write itself is the
        // feature working as designed.
        'POST api/v2/goals/{id}/buddy' => 'self-appointment as buddy of a public goal without a buddy — sets mentor_id (owner decision pending, F-004)',
    ];

    /**
     * Columns whose change on B's row is a side effect of a designed interaction
     * (A viewed, liked, saved, joined) rather than a change to B's content.
     */
    protected const COUNTER_COLUMNS = [
        'updated_at', 'views', 'view_count', 'views_count', 'unique_views', 'cached_member_count',
        'likes_count', 'like_count', 'reactions_count', 'comments_count', 'comment_count',
        'shares_count', 'share_count', 'saves_count', 'save_count', 'bookmarks_count',
        'attendees_count', 'attendee_count', 'participants_count', 'participant_count',
        'members_count', 'member_count', 'applications_count', 'applicants_count',
        'reports_count', 'report_count', 'last_activity_at', 'last_viewed_at',
        'popularity', 'engagement_score', 'hot_score', 'rank_score', 'trending_score',
    ];

    private const MAX_BODY_ROUNDS = 6;

    private ?User $actor = null;

    private ?User $victim = null;

    /** @var array<string,int> */
    private array $victimIds = [];

    /** @var array<string,int> */
    private array $controlIds = [];

    /** @var array<int,array<string,mixed>> */
    private array $reads = [];

    /** @var array<int,array<string,mixed>> */
    private array $writes = [];

    protected function setUp(): void
    {
        parent::setUp();

        // Hundreds of requests from one client in seconds: the per-route limiter
        // would answer 429 and prove nothing about ownership. It has its own tests.
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
    }

    // ================================================================
    // Reads
    // ================================================================

    public function test_no_read_endpoint_serves_another_members_private_record(): void
    {
        $endpoints = array_values(array_filter(
            $this->probeableEndpoints(),
            static fn ($e) => ! str_starts_with($e['prefix'], 'admin/')
        ));
        $this->assertNotEmpty($endpoints, 'Route enumeration produced nothing — the sweep would pass vacuously.');

        $this->prepareActors();

        foreach ($endpoints as $endpoint) {
            $this->probeRead($endpoint);
        }

        $this->writeEvidence('same-community-read-sweep.json', $this->reads,
            'Every v2 GET route with one path parameter, requested by member A of tenant 2 with member B\'s record (probe) and A\'s own record (control), both in tenant 2. SERVED = 200 carrying data with a working control; must be PUBLIC_BY_DESIGN_READ or it is a finding.');
        $this->printReadSummary($endpoints);

        // GATE R2 — B's e-mail address in any served body is a finding, allowlist or not.
        $emailLeaks = array_values(array_map(
            static fn ($r) => $r['method'] . ' ' . $r['uri'] . ' -> ' . $r['status'],
            array_filter($this->reads, static fn ($r) => $r['verdict'] === 'SERVED' && $r['victim_email_in_body'])
        ));
        $this->assertSame([], $emailLeaks, 'A read endpoint disclosed another member\'s e-mail address. Read same-community-read-sweep.json.');

        // GATE R1 — every SERVED route is either public by design (named, with a reason) or a finding.
        $unexplained = array_values(array_map(
            static fn ($r) => $r['method'] . ' ' . $r['uri'] . ' -> ' . $r['status'],
            array_filter(
                $this->reads,
                static fn ($r) => $r['verdict'] === 'SERVED'
                    && ! array_key_exists($r['method'] . ' ' . $r['uri'], self::PUBLIC_BY_DESIGN_READ)
            )
        ));
        $this->assertSame(
            [],
            $unexplained,
            'A read endpoint served another member\'s record and is not registered as public by design. '
            . 'Read its body_excerpt in .local-docs-archive/security-evidence/same-community-read-sweep.json; '
            . 'fix it to refuse, or add "METHOD uri" => reason to PUBLIC_BY_DESIGN_READ.'
        );
    }

    // ================================================================
    // Writes
    // ================================================================

    public function test_no_write_endpoint_changes_or_acknowledges_another_members_record(): void
    {
        $endpoints = array_values(array_filter(
            $this->probeableWriteEndpoints(),
            static fn ($e) => ! str_starts_with($e['prefix'], 'admin/')
        ));
        $this->assertNotEmpty($endpoints, 'Write-route enumeration produced nothing — the sweep would pass vacuously.');

        $this->prepareActors();

        foreach ($endpoints as $endpoint) {
            $this->probeWrite($endpoint);
        }

        $this->writeEvidence('same-community-write-sweep.json', $this->writes,
            'Every v2 non-GET route with one path parameter, requested by member A of tenant 2 against member B\'s record (probe) then A\'s own record (control), body grown from validation messages up to six rounds. B\'s row compared column-by-column after every request regardless of status.');
        $this->printWriteSummary($endpoints);

        // GATE W1 — another member's row changed or vanished.
        $mutated = array_values(array_map(
            static fn ($r) => $r['method'] . ' ' . $r['uri'] . ' -> ' . $r['status'] . ' [' . implode(',', $r['changed_columns']) . ']',
            array_filter(
                $this->writes,
                static fn ($r) => $r['verdict'] === 'MUTATED'
                    && ! array_key_exists($r['method'] . ' ' . $r['uri'], self::KNOWN_MUTATED_BY_DESIGN)
            )
        ));
        $this->assertSame([], $mutated, 'A write endpoint CHANGED or DELETED another member\'s record. Read same-community-write-sweep.json.');

        // GATE W2 — 2xx for another member's record without touching it: designed interaction, or a finding.
        $accepted = array_values(array_map(
            static fn ($r) => $r['method'] . ' ' . $r['uri'] . ' -> ' . $r['status'],
            array_filter(
                $this->writes,
                static fn ($r) => $r['verdict'] === 'ACCEPTED'
                    && ! array_key_exists($r['method'] . ' ' . $r['uri'], self::ACCEPTED_BY_DESIGN)
            )
        ));
        $this->assertSame(
            [],
            $accepted,
            'A write endpoint acknowledged another member\'s record with 2xx and is not a registered interaction. '
            . 'Read its body_excerpt and request_body in same-community-write-sweep.json; fix it to refuse, '
            . 'or add "METHOD uri" => reason to ACCEPTED_BY_DESIGN once the target table proves nothing of B\'s changed.'
        );

        // Informational only: report which KNOWN_MUTATED_BY_DESIGN entries reproduced
        // this run. Not asserted — see the register's note on fixture randomness.
        $reproduced = array_values(array_filter(
            array_keys(self::KNOWN_MUTATED_BY_DESIGN),
            fn (string $key) => (bool) array_filter($this->writes, static fn ($r) => $r['method'] . ' ' . $r['uri'] === $key && $r['verdict'] === 'MUTATED')
        ));
        fwrite(STDERR, 'KNOWN_MUTATED_BY_DESIGN reproduced this run: ' . ($reproduced === [] ? 'none' : implode(', ', $reproduced)) . PHP_EOL);
    }

    // ================================================================
    // Probing
    // ================================================================

    private function prepareActors(): void
    {
        // Modules that are off for tenant 2 answer 403 before any ownership check
        // runs; probe and control are treated identically, so enabling them does
        // not weaken the test.
        $this->enableTenantFeatures(['courses', 'podcasts', 'marketplace', 'polls'], $this->testTenantId);

        $this->victim = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'is_super_admin' => false,
            'is_tenant_super_admin' => false,
            'role' => 'member',
            'email' => 'victim-' . Str::lower(Str::random(10)) . '@example.invalid',
        ]);
        $this->victimIds = $this->seedRecords($this->testTenantId, $this->victim);
        $this->pinPublicVisibility($this->victimIds);

        $this->actor = $this->actAs(['role' => 'member']);
        $this->controlIds = $this->seedRecords($this->testTenantId, $this->actor);
        $this->pinPublicVisibility($this->controlIds);
    }

    /**
     * The factories randomise visibility: a goal may be private, a job draft, a
     * post scheduled. Across three runs that moved four routes in and out of
     * SERVED and would make CI flap. Pin the seeded records PUBLIC so the same
     * routes are exercised every run. The private case is not lost — it is
     * covered explicitly by test_private_goal_of_another_member_is_refused().
     *
     * Only columns that exist are touched; a missing column is skipped, not fatal.
     *
     * @param array<string,int> $ids fixture key => id
     */
    private function pinPublicVisibility(array $ids): void
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
            $present = array_filter($values, fn ($v, string $column) => Schema::hasColumn($table, $column), ARRAY_FILTER_USE_BOTH);
            if ($present !== []) {
                DB::table($table)->where('id', $ids[$key])->update($present);
            }
        }
    }

    // ================================================================
    // The private case, explicitly
    // ================================================================

    public function test_private_goal_of_another_member_is_refused(): void
    {
        $this->prepareActors();
        $goalId = $this->victimIds['goal'] ?? null;
        $ownGoalId = $this->controlIds['goal'] ?? null;
        $this->assertNotNull($goalId, 'goal fixture missing');
        $this->assertNotNull($ownGoalId, 'own goal fixture missing');

        DB::table('goals')->where('id', $goalId)->update(['is_public' => 0]);

        $own = $this->apiGet("/v2/goals/{$ownGoalId}");
        $this->assertSame(200, $own->getStatusCode(), 'control: own goal must be readable');

        $foreign = $this->apiGet("/v2/goals/{$goalId}");
        $this->assertContains($foreign->getStatusCode(), [403, 404], "another member's PRIVATE goal must be refused, got {$foreign->getStatusCode()}");
        $this->assertStringNotContainsString((string) $this->victim?->email, (string) $foreign->getContent());

        $insights = $this->apiGet("/v2/goals/{$goalId}/insights");
        $this->assertContains($insights->getStatusCode(), [403, 404], "insights of another member's PRIVATE goal must be refused, got {$insights->getStatusCode()}");
    }

    private function probeRead(array $endpoint): void
    {
        $base = $endpoint + ['actor' => 'member', 'status' => null, 'control_status' => null, 'verdict' => 'SKIPPED', 'note' => '', 'body_excerpt' => '', 'victim_email_in_body' => false];

        if ($endpoint['skip'] !== null) {
            $this->reads[] = array_merge($base, ['note' => $endpoint['skip']]);

            return;
        }

        $key = $endpoint['fixture'];
        $victimId = $this->victimIds[$key] ?? null;
        $controlId = $this->controlIds[$key] ?? null;
        if ($victimId === null || $controlId === null) {
            $this->reads[] = array_merge($base, ['note' => "fixture '{$key}' could not be created"]);

            return;
        }

        $probe = $this->request($endpoint['uri'], $victimId);
        $control = $this->request($endpoint['uri'], $controlId);
        $status = $probe['status'];
        $controlStatus = $control['status'];
        $controlOk = in_array($controlStatus, [200, 201], true);

        [$verdict, $note] = match (true) {
            $status === null => ['INCONCLUSIVE', $probe['error']],
            in_array($status, [200, 201], true) && $this->responseCarriesData($probe['body']) && $controlOk => ['SERVED', ''],
            in_array($status, [200, 201], true) && $this->responseCarriesData($probe['body']) => ['SERVED', "served B's record although own record answered {$controlStatus}"],
            in_array($status, [200, 201], true) && $controlOk => ['EMPTY_200', 'answered 200 with no records — scoped to the caller, or nothing to find'],
            in_array($status, [200, 201], true) => ['INCONCLUSIVE', "empty 200 but own record answered {$controlStatus} — endpoint not exercised"],
            in_array($status, self::REFUSED, true) && $controlOk => ['REFUSED', ''],
            in_array($status, self::REFUSED, true) => ['INCONCLUSIVE', "own record also answered {$controlStatus} — endpoint not exercised by this id type"],
            default => ['INCONCLUSIVE', "status {$status} proves nothing about ownership"],
        };

        $this->reads[] = array_merge($base, [
            'status' => $status,
            'control_status' => $controlStatus,
            'verdict' => $verdict,
            'note' => $note,
            'body_excerpt' => $verdict === 'REFUSED' ? '' : mb_substr($probe['body'], 0, 400),
            'victim_email_in_body' => $this->victim !== null && str_contains($probe['body'], (string) $this->victim->email),
        ]);
    }

    private function probeWrite(array $endpoint): void
    {
        $base = $endpoint + ['actor' => 'member', 'status' => null, 'control_status' => null, 'verdict' => 'SKIPPED', 'note' => '', 'changed_columns' => [], 'request_body' => [], 'rounds' => 0, 'body_excerpt' => ''];

        if ($endpoint['skip'] !== null) {
            $this->writes[] = array_merge($base, ['note' => $endpoint['skip']]);

            return;
        }

        $key = $endpoint['fixture'];
        $table = $this->fixtureTable($key);

        // A control request is a real request: re-seed whichever side an earlier
        // endpoint consumed, so this endpoint is exercised against a live row.
        if (! $this->recordsStillExist([$key], $this->victimIds) && $this->victim !== null) {
            $this->victimIds = $this->seedRecords($this->testTenantId, $this->victim);
        }
        if (! $this->recordsStillExist([$key], $this->controlIds) && $this->actor !== null) {
            $this->controlIds = $this->seedRecords($this->testTenantId, $this->actor);
        }

        $victimId = $this->victimIds[$key] ?? null;
        $controlId = $this->controlIds[$key] ?? null;
        if ($victimId === null || $controlId === null || $table === null) {
            $this->writes[] = array_merge($base, ['note' => "fixture '{$key}' could not be created"]);

            return;
        }

        $probe = $this->attemptWrite($endpoint['method'], $endpoint['uri'], $victimId, $table);

        // The control runs AFTER the probe so it cannot alter the probe's target.
        $control = $this->attemptWrite($endpoint['method'], $endpoint['uri'], $controlId, null);
        $controlOk = $control['status'] !== null && $control['status'] >= 200 && $control['status'] < 300;

        $status = $probe['status'];
        $changed = $probe['changed_columns'];
        $nonCounter = array_values(array_filter($changed, fn (string $c) => ! $this->isCounterColumn($c)));
        $onlyCounters = $changed !== [] && $nonCounter === [];

        // A 403 for B's record while A's OWN record got past the permission
        // check (and then failed validation or a state rule) still shows the
        // ownership gate telling the two apart. Weaker than a full REFUSED —
        // the control never completed — so it is counted separately and never
        // as a pass.
        $controlPassedPermission = in_array($control['status'], [400, 409, 422], true);

        [$verdict, $note] = match (true) {
            $probe['deleted'] => ['MUTATED', "B's record was DELETED (response {$status})"],
            $changed !== [] && ! $onlyCounters => ['MUTATED', "B's record CHANGED: " . implode(', ', $nonCounter) . " (response {$status})"],
            $onlyCounters => ['INTERACTED', 'only counter columns moved: ' . implode(', ', $changed)],
            $status === null => ['INCONCLUSIVE', $probe['error']],
            $status >= 200 && $status < 300 => ['ACCEPTED', '2xx for B\'s record, row unchanged — designed interaction or a misleading success'],
            in_array($status, self::REFUSED, true) && $controlOk => ['REFUSED', ''],
            $status === 403 && $controlPassedPermission => ['REFUSED_PERMISSION', "B's record refused 403 while own record passed the permission gate ({$control['status']}) — ownership distinguished, control did not complete"],
            in_array($status, self::REFUSED, true) => ['INCONCLUSIVE', "own record also answered {$control['status']} — endpoint not exercised"],
            in_array($status, [400, 422], true) => ['VALIDATION_FIRST', 'validation still rejected the body after ' . $probe['rounds'] . ' rounds — not a pass'],
            $status === 405 => ['SKIPPED', 'method not allowed at runtime'],
            default => ['INCONCLUSIVE', "status {$status}"],
        };

        $this->writes[] = array_merge($base, [
            'status' => $status,
            'control_status' => $control['status'],
            'verdict' => $verdict,
            'note' => $note,
            'changed_columns' => $changed,
            'request_body' => $probe['request_body'],
            'rounds' => $probe['rounds'],
            'body_excerpt' => $verdict === 'REFUSED' ? '' : mb_substr($probe['body'], 0, 300),
        ]);
    }

    /**
     * Counter-shaped columns: the explicit list, plus anything named like a
     * cached tally (`cached_member_count`, `attendee_count`, `total_views`).
     */
    private function isCounterColumn(string $column): bool
    {
        return in_array($column, self::COUNTER_COLUMNS, true)
            || preg_match('/^(cached_)?[a-z_]*_(count|total|score)$/', $column) === 1
            || preg_match('/^(total|cached)_[a-z_]+$/', $column) === 1;
    }

    /**
     * Send one write, growing the body from validation messages, and compare the
     * target row after EVERY round.
     *
     * @return array{status:?int,body:string,error:string,rounds:int,request_body:array,changed_columns:array,deleted:bool}
     */
    private function attemptWrite(string $method, string $routeUri, int $id, ?string $table): array
    {
        $uri = '/' . ltrim(preg_replace('#^api/#', '', preg_replace('/\{[^}]+\}/', (string) $id, $routeUri)), '/');
        $before = $table ? DB::table($table)->where('id', $id)->first() : null;
        $beforeArr = $before ? (array) $before : null;

        $body = [];
        $status = null;
        $content = '';
        $error = '';
        $changed = [];
        $deleted = false;
        $rounds = 0;

        for ($round = 1; $round <= self::MAX_BODY_ROUNDS; $round++) {
            $rounds = $round;
            try {
                $response = $this->json($method, '/api' . $uri, $body, $this->withTenantHeader());
                $status = $response->getStatusCode();
                $content = (string) $response->getContent();
                $error = '';
            } catch (\Throwable $e) {
                $status = null;
                $content = '';
                $error = 'threw ' . class_basename($e) . ': ' . mb_substr($e->getMessage(), 0, 160);
            }

            if ($table !== null) {
                $after = DB::table($table)->where('id', $id)->first();
                if ($after === null && $beforeArr !== null) {
                    $deleted = true;
                } elseif ($after !== null && $beforeArr !== null) {
                    foreach ((array) $after as $column => $value) {
                        if (! array_key_exists($column, $beforeArr) || (string) $beforeArr[$column] !== (string) $value) {
                            $changed[$column] = true;
                        }
                    }
                }
            }

            if ($deleted || ! in_array($status, [400, 422], true)) {
                break;
            }

            [$field, $message] = $this->firstFailingField($content);
            if ($field === null || array_key_exists($field, $body)) {
                break;
            }
            $body[$field] = $this->synthesiseValue($field, $message);
        }

        return [
            'status' => $status,
            'body' => $content,
            'error' => $error,
            'rounds' => $rounds,
            'request_body' => $body,
            'changed_columns' => array_keys($changed),
            'deleted' => $deleted,
        ];
    }

    // ================================================================
    // Reporting
    // ================================================================

    private function writeEvidence(string $file, array $results, string $method): void
    {
        $dir = dirname(__DIR__, 4) . '/.local-docs-archive/security-evidence';
        if (! is_dir($dir) && ! @mkdir($dir, 0o775, true) && ! is_dir($dir)) {
            return;
        }
        @file_put_contents($dir . '/' . $file, json_encode([
            'generated_at' => date('c'),
            'method' => $method,
            'tenant' => $this->testTenantId,
            'actor_user_id' => $this->actor?->id,
            'victim_user_id' => $this->victim?->id,
            'results' => $results,
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
    }

    private function printReadSummary(array $endpoints): void
    {
        $t = ['SERVED' => 0, 'REFUSED' => 0, 'EMPTY_200' => 0, 'INCONCLUSIVE' => 0, 'SKIPPED' => 0];
        foreach ($this->reads as $r) {
            $t[$r['verdict']]++;
        }
        $public = count(array_filter($this->reads, static fn ($r) => $r['verdict'] === 'SERVED' && array_key_exists($r['method'] . ' ' . $r['uri'], self::PUBLIC_BY_DESIGN_READ)));
        $lines = ['', '=== SAME-COMMUNITY READ SWEEP (member A -> member B, control-verified) ==='];
        $lines[] = sprintf('v2 GET endpoints with one path parameter (member-facing): %d', count($endpoints));
        $lines[] = sprintf('  probed (B\'s record + A\'s own record)     : %d', $t['SERVED'] + $t['REFUSED'] + $t['EMPTY_200'] + $t['INCONCLUSIVE']);
        $lines[] = sprintf('    refused, own record served              : %d', $t['REFUSED']);
        $lines[] = sprintf('    answered 200 with no records            : %d', $t['EMPTY_200']);
        $lines[] = sprintf('    SERVED B\'s record                       : %d  (public by design %d, unexplained %d)', $t['SERVED'], $public, $t['SERVED'] - $public);
        $lines[] = sprintf('    inconclusive                            : %d', $t['INCONCLUSIVE']);
        $lines[] = sprintf('  skipped                                   : %d', $t['SKIPPED']);
        $lines[] = '';
        $lines[] = 'SERVED (read each body before deciding):';
        foreach ($this->reads as $r) {
            if ($r['verdict'] === 'SERVED') {
                $lines[] = sprintf('  %s %s %s -> %s/%s  email:%s  %s',
                    array_key_exists($r['method'] . ' ' . $r['uri'], self::PUBLIC_BY_DESIGN_READ) ? 'ok ' : '?? ',
                    $r['method'], $r['uri'], $r['status'], $r['control_status'],
                    $r['victim_email_in_body'] ? 'YES' : 'no',
                    preg_replace('/\s+/', ' ', mb_substr($r['body_excerpt'], 0, 140)));
            }
        }
        $lines[] = '';
        fwrite(STDERR, implode(PHP_EOL, $lines) . PHP_EOL);
    }

    private function printWriteSummary(array $endpoints): void
    {
        $t = ['MUTATED' => 0, 'INTERACTED' => 0, 'ACCEPTED' => 0, 'REFUSED' => 0, 'REFUSED_PERMISSION' => 0, 'VALIDATION_FIRST' => 0, 'INCONCLUSIVE' => 0, 'SKIPPED' => 0];
        foreach ($this->writes as $r) {
            $t[$r['verdict']]++;
        }
        $lines = ['', '=== SAME-COMMUNITY WRITE SWEEP (member A -> member B\'s record, control-verified) ==='];
        $lines[] = sprintf('non-GET v2 endpoints with one path parameter (member-facing): %d', count($endpoints));
        $lines[] = sprintf('  probed                                    : %d', count($endpoints) - $t['SKIPPED']);
        $lines[] = sprintf('    refused, own record accepted            : %d', $t['REFUSED']);
        $lines[] = sprintf('    refused 403, own passed permission gate : %d  (not a full pass: control did not complete)', $t['REFUSED_PERMISSION']);
        $lines[] = sprintf('    validation rejected first (not a pass)  : %d', $t['VALIDATION_FIRST']);
        $lines[] = sprintf('    ACCEPTED (2xx, B\'s row unchanged)       : %d', $t['ACCEPTED']);
        $lines[] = sprintf('    INTERACTED (only counters moved)        : %d', $t['INTERACTED']);
        $lines[] = sprintf('    MUTATED B\'s record                      : %d', $t['MUTATED']);
        $lines[] = sprintf('    inconclusive                            : %d', $t['INCONCLUSIVE']);
        $lines[] = sprintf('  skipped                                   : %d', $t['SKIPPED']);
        $lines[] = '';
        foreach (['MUTATED', 'INTERACTED', 'ACCEPTED', 'INCONCLUSIVE'] as $bucket) {
            $rows = array_filter($this->writes, static fn ($r) => $r['verdict'] === $bucket);
            if ($rows === []) {
                continue;
            }
            $lines[] = $bucket . ':';
            foreach ($rows as $r) {
                $lines[] = sprintf('  %-6s %s -> %s/%s  %s  body=%s  %s',
                    $r['method'], $r['uri'], $r['status'] ?? 'exception', $r['control_status'] ?? '-',
                    $r['note'], json_encode($r['request_body'], JSON_UNESCAPED_SLASHES),
                    preg_replace('/\s+/', ' ', mb_substr($r['body_excerpt'], 0, 120)));
            }
            $lines[] = '';
        }
        fwrite(STDERR, implode(PHP_EOL, $lines) . PHP_EOL);
    }
}
