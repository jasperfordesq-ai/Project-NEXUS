<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Broad cross-community (cross-tenant) access sweep.
 *
 * WHY THIS EXISTS
 * ---------------
 * TenantIsolationTest covers three resources by hand. The v2 API registers
 * ~1,300 endpoints that take a record id in the path, so hand-written coverage
 * will never keep pace with the surface. This test enumerates the *live route
 * table* and, for every single-id GET endpoint whose id type it can resolve,
 * requests a record that belongs to a DIFFERENT community.
 *
 * Two actors, because the two failure modes matter differently:
 *
 *   PASS 1 — an ordinary member of our community requests member-facing routes.
 *   PASS 2 — a community ADMIN of our community requests /admin/ routes. A
 *            community administrator reading another community's records is
 *            the scenario a hosting customer fears most, so it is tested in its
 *            own right rather than inferred.
 *
 * EVERY REFUSAL IS CONTROL-VERIFIED
 * ---------------------------------
 * A 404 for a foreign record proves nothing on its own: the endpoint may simply
 * not be keyed on that id type, or may need state the fixture lacks. So every
 * probe is paired with a CONTROL — the same endpoint requested with a record of
 * the same type that belongs to OUR community and is owned by the acting user.
 * A refusal counts only when the control succeeded (200/201). If the control
 * also fails, the endpoint was not exercised and the result is INCONCLUSIVE.
 * This lowers the headline numbers and makes every one of them defensible.
 *
 * HOW AN ID TYPE IS RESOLVED
 * --------------------------
 *  1. Parameter names that are not record ids (slug, token, type, code, …) are
 *     SKIPPED as "not an id".
 *  2. Parameter names that identify a type on their own ({userId}, {groupId},
 *     {eventId}, {courseId}, {childId}, …) resolve directly.
 *  3. Otherwise the URL path before the parameter is matched, longest prefix
 *     first, against PREFIX_FIXTURES.
 *  4. Anything else is SKIPPED as "no fixture" — never counted as passing.
 *
 * HONEST LIMITS — read before quoting a number anywhere
 * -----------------------------------------------------
 *  - GET only, one path parameter only. Writes and multi-parameter routes are
 *    not covered here.
 *  - A 200 is classified by READING THE BODY. A correctly scoped query that
 *    finds nothing answers 200 with an empty list; that is EMPTY_200, not a leak.
 *  - A 4xx/5xx other than a refusal is INCONCLUSIVE, never a pass.
 *  - One crafted request per endpoint. This does not prove every code path.
 */
class CrossCommunityAccessSweepTest extends TestCase
{
    use DatabaseTransactions;

    /** The community our actors belong to is $this->testTenantId (2). */
    private const VICTIM_TENANT_ID = 999;

    /** Status codes that prove the endpoint refused a foreign record. */
    private const REFUSED = [401, 403, 404, 410];

    /** Parameter names that are not record identifiers. */
    private const NOT_AN_ID = [
        'slug', 'idOrSlug', 'showSlug', 'token', 'tag', 'key', 'checkKey', 'pageKey', 'groupKey',
        'provider', 'filename', 'type', 'kind', 'code', 'uuid', 'acc_id', 'municipalityCode',
        // {day} is a DAY OF THE WEEK, not a record id: PUT users/me/availability/{day}
        // sets the caller's own availability for that day. Resolving it by path
        // prefix fed it a member_availability row id, which the endpoint happily
        // accepted as a day number and answered 2xx — reported as an eleventh
        // accepted-no-change write. It surfaced only on a CI shard, because the
        // local run had failed to seed that fixture and skipped the endpoint
        // instead. Naming it here makes the result the same in both places.
        'day',
    ];

    /** Parameter names that identify the record type on their own. */
    private const PARAM_FIXTURES = [
        'userId' => 'user',
        'childId' => 'user',
        'caredForId' => 'user',
        'friendId' => 'user',
        'groupId' => 'group',
        'eventId' => 'event',
        'courseId' => 'course',
        'message' => 'message',
    ];

    /**
     * URL path before the parameter (after /api/v2/) => fixture key.
     * Longest matching prefix wins. Absent => SKIPPED as "no fixture".
     */
    private const PREFIX_FIXTURES = [
        // PASS 1 — member-facing
        'listings' => 'listing',
        'events' => 'event',
        'public/events' => 'event',
        'groups' => 'group',
        'goals' => 'goal',
        'polls' => 'poll',
        'feed/polls' => 'poll',
        'posts' => 'post',
        'feed/posts' => 'feed_post',
        'comments' => 'comment',
        'messages' => 'message',
        'users' => 'user',
        'members' => 'user',
        'reviews' => 'review',
        'notifications' => 'notification',
        'wallet/transactions' => 'transaction',
        'jobs' => 'job',
        'jobs/applications' => 'job_application',
        'jobs/alerts' => 'job_alert',
        // users/me/* sub-resources carry THEIR OWN ids, not a user id. Mapping
        // them to 'user' (via the 'users' prefix) produced meaningless writes
        // on the first write-sweep run.
        'users/me/availability' => 'member_availability',
        'users/me/sub-accounts' => 'account_relationship',
        'users/me/skills' => null,
        'volunteering/opportunities' => 'vol_opportunity',
        'volunteering/organisations' => 'vol_organization',
        'volunteering/reviews/organization' => 'vol_organization',
        // 'volunteering/shifts' — VolShiftFactory writes updated_at, which
        // vol_shifts does not have; no fixture until that model bug is fixed.
        'volunteering/expenses' => 'vol_expense',
        'volunteering/giving-days' => 'vol_giving_day',
        // 'ideation-*' — served by IdeationChallengesController, NOT the
        // gamification Challenge model. The control caught the wrong mapping
        // (own record 404). No factory for the ideation models yet.
        'exchanges' => 'exchange_request',
        'kb' => 'help_article',
        'courses' => 'course',
        'marketplace/listings' => 'marketplace_listing',
        'stories' => 'story',
        'podcasts' => 'podcast_show',

        // PASS 2 — administration, requested as a community admin
        'admin/users' => 'user',
        'admin/groups' => 'group',
        'admin/events' => 'event',
        'admin/jobs' => 'job',
        'admin/listings' => 'listing',
        'admin/marketplace/listings' => 'marketplace_listing',
        'admin/goals' => 'goal',
        'admin/polls' => 'poll',
        'admin/pages' => 'page',
        'admin/reviews' => 'review',
        'admin/comments' => 'comment',
        'admin/feed/posts' => 'feed_post',
        'admin/newsletters' => 'newsletter',
        'admin/newsletters/segments' => 'newsletter_segment',
        'admin/newsletters/templates' => 'newsletter_template',
        'admin/menus' => 'menu',
        'admin/reports' => 'report',
        'admin/volunteering/organizations' => 'vol_organization',
        'admin/volunteering/expenses' => 'vol_expense',
        'admin/volunteering/giving-days' => 'vol_giving_day',
        'admin/podcasts/shows' => 'podcast_show',
    ];

    /**
     * How each fixture key is created. Either a model factory (with optional
     * parent relations from the same seed set) or a direct table insert for
     * modules that have no factory. Order matters: parents before children.
     */
    private const FIXTURES = [
        'user' => ['model' => User::class],
        'listing' => ['model' => \App\Models\Listing::class],
        'event' => ['model' => \App\Models\Event::class],
        // 'attributes' pins factory fields that are otherwise randomised and
        // would make the CONTROL flap: a private group 404s its own
        // /similar endpoint, an inactive organisation 404s its own page, and
        // the endpoint then swings between REFUSED and INCONCLUSIVE from run
        // to run. Observed 2026-09-10 (98/52 → 97/53 across two runs).
        'group' => ['model' => \App\Models\Group::class, 'attributes' => ['visibility' => 'public']],
        'goal' => ['model' => \App\Models\Goal::class],
        'poll' => ['model' => \App\Models\Poll::class],
        'post' => ['model' => \App\Models\Post::class],
        'feed_post' => ['model' => \App\Models\FeedPost::class],
        'comment' => ['model' => \App\Models\Comment::class],
        'message' => ['model' => \App\Models\Message::class],
        'review' => ['model' => \App\Models\Review::class],
        'notification' => ['model' => \App\Models\Notification::class],
        'transaction' => ['model' => \App\Models\Transaction::class],
        'job' => ['model' => \App\Models\JobVacancy::class],
        'job_application' => ['model' => \App\Models\JobApplication::class],
        'job_alert' => ['model' => \App\Models\JobAlert::class],
        'member_availability' => ['model' => \App\Models\MemberAvailability::class],
        'account_relationship' => ['model' => \App\Models\AccountRelationship::class],
        'vol_opportunity' => ['model' => \App\Models\VolOpportunity::class],
        'vol_organization' => ['model' => \App\Models\VolOrganization::class, 'attributes' => ['status' => 'active']],
        'vol_expense' => ['model' => \App\Models\VolExpense::class],
        'vol_giving_day' => ['model' => \App\Models\VolGivingDay::class],
        'exchange_request' => ['model' => \App\Models\ExchangeRequest::class],
        'help_article' => ['model' => \App\Models\HelpArticle::class],
        'newsletter' => ['model' => \App\Models\Newsletter::class],
        'newsletter_segment' => ['model' => \App\Models\NewsletterSegment::class],
        'newsletter_template' => ['model' => \App\Models\NewsletterTemplate::class],
        'menu' => ['model' => \App\Models\Menu::class],
        'page' => ['model' => \App\Models\Page::class],
        'report' => ['model' => \App\Models\Report::class],
        'course' => ['table' => 'courses', 'owner' => 'author_user_id', 'columns' => ['title' => 'Sweep course', 'slug' => 'sweep-course-{n}']],
        'marketplace_listing' => ['table' => 'marketplace_listings', 'owner' => 'user_id', 'columns' => ['title' => 'Sweep listing', 'description' => 'Sweep listing description']],
        'story' => ['table' => 'stories', 'owner' => 'user_id', 'columns' => ['expires_at' => '{tomorrow}']],
        'podcast_show' => ['table' => 'podcast_shows', 'owner' => 'owner_user_id', 'columns' => ['title' => 'Sweep show', 'slug' => 'sweep-show-{n}']],

        // ---------------------------------------------------------------
        // CHILD records, for the multi-parameter sweep in Section 6.5.
        //
        // Each is linked by 'needs' to the parent seeded for the SAME tenant,
        // so the control request uses a child that genuinely belongs to the
        // parent in the URL. Without that the endpoint refuses for the mundane
        // reason that the child is not part of the parent, which looks like a
        // pass and is not one. Declared after their parents: seeding is ordered.
        // ---------------------------------------------------------------
        'course_lesson' => ['table' => 'course_lessons', 'needs' => ['course_id' => 'course'], 'columns' => ['title' => 'Sweep lesson']],
        'course_section' => ['table' => 'course_sections', 'needs' => ['course_id' => 'course'], 'columns' => ['title' => 'Sweep section']],
        'course_cohort' => ['table' => 'course_cohorts', 'needs' => ['course_id' => 'course'], 'columns' => ['name' => 'Sweep cohort']],
        'course_quiz' => ['table' => 'course_quizzes', 'needs' => ['course_id' => 'course'], 'columns' => ['title' => 'Sweep quiz']],
        'course_question' => ['table' => 'course_questions', 'needs' => ['quiz_id' => 'course_quiz'], 'columns' => ['prompt' => 'Sweep prompt']],
        'group_discussion' => ['table' => 'group_discussions', 'needs' => ['group_id' => 'group'], 'owner' => 'user_id', 'columns' => ['title' => 'Sweep discussion']],
        'group_chatroom' => ['table' => 'group_chatrooms', 'needs' => ['group_id' => 'group'], 'owner' => 'created_by', 'columns' => ['name' => 'Sweep chatroom']],
        'group_chatroom_message' => ['table' => 'group_chatroom_messages', 'needs' => ['chatroom_id' => 'group_chatroom'], 'owner' => 'user_id', 'columns' => ['body' => 'Sweep chatroom message']],
        'group_announcement' => ['table' => 'group_announcements', 'needs' => ['group_id' => 'group'], 'owner' => 'created_by', 'columns' => ['title' => 'Sweep announcement', 'content' => 'Sweep announcement body']],
        'group_question' => ['table' => 'group_questions', 'needs' => ['group_id' => 'group'], 'owner' => 'user_id', 'columns' => ['title' => 'Sweep group question']],
        'group_answer' => ['table' => 'group_answers', 'needs' => ['question_id' => 'group_question'], 'owner' => 'user_id', 'columns' => ['body' => 'Sweep answer']],
        'group_file' => ['table' => 'group_files', 'needs' => ['group_id' => 'group'], 'owner' => 'uploaded_by', 'columns' => ['file_name' => 'sweep.txt', 'file_path' => 'sweep/sweep-{n}.txt', 'file_type' => 'text/plain']],
        'group_media' => ['table' => 'group_media', 'needs' => ['group_id' => 'group'], 'owner' => 'uploaded_by'],
        'group_invite' => ['table' => 'group_invites', 'needs' => ['group_id' => 'group'], 'owner' => 'invited_by', 'columns' => ['token' => 'sweep-invite-{n}']],
        'group_challenge' => ['table' => 'group_challenges', 'needs' => ['group_id' => 'group'], 'owner' => 'created_by', 'columns' => ['title' => 'Sweep challenge', 'metric' => 'posts', 'target_value' => '10', 'ends_at' => '{tomorrow}']],
        'group_scheduled_post' => ['table' => 'group_scheduled_posts', 'needs' => ['group_id' => 'group'], 'owner' => 'user_id', 'columns' => ['content' => 'Sweep scheduled post', 'scheduled_at' => '{tomorrow}']],
        'podcast_episode' => ['table' => 'podcast_episodes', 'needs' => ['show_id' => 'podcast_show'], 'owner' => 'author_user_id', 'columns' => ['title' => 'Sweep episode', 'slug' => 'sweep-episode-{n}', 'audio_url' => 'https://example.invalid/sweep.mp3']],
        // `unique_tenant_document` is (tenant_id, document_type) and every
        // seeded tenant already has a 'terms' row, so the sweep takes a type
        // nothing else claims rather than colliding with real data.
        'legal_document' => ['table' => 'legal_documents', 'unique' => ['document_type'], 'columns' => ['document_type' => 'acceptable_use', 'title' => 'Sweep acceptable use', 'slug' => 'sweep-acceptable-use-{n}']],
        // No tenant_id of its own: scoped through legal_documents by join.
        'legal_document_version' => ['table' => 'legal_document_versions', 'needs' => ['document_id' => 'legal_document'], 'owner' => 'created_by', 'columns' => ['version_number' => '1.{n}', 'content' => 'Sweep version content', 'effective_date' => '{today}']],
    ];

    /**
     * Child-record parameters for the multi-parameter sweep, resolved by the
     * path segment before the parameter.
     *
     * Deliberately SEPARATE from PREFIX_FIXTURES. That map is shared with the
     * read and write sweeps whose figures are published, and `{questionId}`
     * proves why a shared map could not do this job anyway: under
     * `courses/{courseId}/quizzes/{quizId}/questions` it is a quiz question,
     * and under `groups/{id}/questions` it is a group's Q&A question. Only the
     * local prefix distinguishes them.
     */
    private const CHILD_FIXTURES_BY_PREFIX = [
        'courses/lessons' => 'course_lesson',
        'courses/sections' => 'course_section',
        'courses/cohorts' => 'course_cohort',
        'courses/quizzes' => 'course_quiz',
        'courses/quizzes/questions' => 'course_question',
        'courses/groups' => 'group',
        'groups/discussions' => 'group_discussion',
        'groups/chatrooms' => 'group_chatroom',
        'groups/chatrooms/pin' => 'group_chatroom_message',
        'groups/announcements' => 'group_announcement',
        'groups/questions' => 'group_question',
        'groups/answers' => 'group_answer',
        'groups/files' => 'group_file',
        'groups/media' => 'group_media',
        'groups/invites' => 'group_invite',
        'groups/challenges' => 'group_challenge',
        'groups/scheduled-posts' => 'group_scheduled_post',
        'podcasts/shows/episodes' => 'podcast_episode',
        'admin/legal-documents' => 'legal_document',
        'admin/legal-documents/versions' => 'legal_document_version',
    ];

    /**
     * Endpoints that answer 2xx for a child record from another community while
     * provably changing nothing. Shrink-only in both directions.
     */
    private const KNOWN_CHILD_ACCEPTED_NO_CHANGE = [
    ];

    /**
     * Endpoints that answer 200 for a record in another community but return
     * no member data — reviewed by hand, body recorded in the evidence file.
     *
     * A weaker finding than a data leak: nothing about the other community is
     * disclosed, but the endpoint processes a foreign id instead of refusing
     * it, which lets a caller distinguish "exists elsewhere" from "does not
     * exist". They should all end up returning 404.
     *
     * SHRINK-ONLY. Fixing one means deleting its line in the same commit — the
     * test fails on an entry that no longer reproduces, so this list cannot rot.
     */
    private const KNOWN_SOFT_200 = [
        // 2026-09-10: the four entries found on the first run — connections/
        // status/{userId}, jobs/{id}/match, users/{id}/activity/dashboard and
        // admin/users/{id}/verification-badges — were fixed the same day (each
        // now refuses a foreign id with 404) and removed here as GATE 2 demands.
    ];

    /**
     * Write endpoints that answer 2xx for a record in another community while
     * leaving that record untouched — an idempotent "unsave", "leave", "mark
     * read" or "delete" of a row the actor never had. No other community's
     * data changes, but the endpoint should refuse rather than acknowledge.
     *
     * Eight further entries found on 2026-09-10 were fixed the same day and are
     * deliberately NOT here: jobs/{id}/referral (minted a referral for a foreign
     * vacancy), stories/{id}/view, jobs/alerts/{id} (three routes),
     * admin/jobs/{id}/unfeature, admin/newsletters/{id} and its templates.
     *
     * SHRINK-ONLY in both directions, exactly like KNOWN_SOFT_200.
     */
    private const KNOWN_ACCEPTED_NO_CHANGE = [
        'DELETE api/v2/events/{id}/waitlist',
        'DELETE api/v2/feed/posts/{id}/share',
        'DELETE api/v2/goals/{id}/reminder',
        'DELETE api/v2/jobs/{id}/save',
        'DELETE api/v2/listings/{id}/save',
        'PUT api/v2/messages/{id}/read',
        'DELETE api/v2/stories/close-friends/{friendId}',
        'DELETE api/v2/users/me/availability/{id}',
        'DELETE api/v2/users/me/sub-accounts/{id}',
        'PUT api/v2/admin/volunteering/giving-days/{id}',
    ];

    /**
     * Parameter names that identify a PERSON rather than a record. These are
     * the second identifier in the multi-parameter sweep below, and the one
     * deliberately taken from another community.
     */
    private const PERSON_PARAMS = [
        'userId', 'childId', 'friendId', 'caredForId',
        'attendeeId', 'guestId', 'delivererId', 'partnerId',
    ];

    /**
     * Columns that reference a person. Every occurrence of these in the live
     * schema is counted before and after each foreign-person request, which is
     * how a CREATED join row (a membership, an allocation, a participation)
     * becomes visible — the single-parameter write sweep cannot see those.
     */
    private const PERSON_COLUMNS = [
        'user_id', 'member_id', 'participant_id', 'attendee_id',
        'guest_id', 'deliverer_id', 'recipient_id', 'child_id',
    ];

    /**
     * Endpoints that answer 2xx for a person from another community while
     * provably moving nothing. Shrink-only in both directions. Populated from
     * the first run; every entry needs a reason.
     */
    private const KNOWN_PERSON_ACCEPTED_NO_CHANGE = [
    ];

    /** @var array<string,int> fixture key => victim record id (tenant 999) */
    private array $victimIds = [];

    /** @var array<string,int> fixture key => control record id (tenant 2, current actor) */
    private array $controlIds = [];

    private ?User $victimOwner = null;

    /** @var array<int,array<string,mixed>> */
    private array $results = [];

    protected function setUp(): void
    {
        parent::setUp();

        // Every endpoint is requested twice (foreign + control), ~450 requests
        // from one client in a few seconds. The platform's per-route rate limits
        // engaged and answered 429 to the /users/{id}/* family, which proves the
        // limiter works and nothing about scoping. Rate limiting has its own
        // tests; this one is about tenant scoping behind it.
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
    }

    public function test_no_endpoint_serves_another_communitys_record(): void
    {
        $endpoints = $this->probeableEndpoints();

        $this->assertNotEmpty(
            $endpoints,
            'Route enumeration produced nothing — the sweep would pass vacuously.'
        );

        $this->victimOwner = User::factory()->forTenant(self::VICTIM_TENANT_ID)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->victimIds = $this->seedRecords(self::VICTIM_TENANT_ID, $this->victimOwner);

        // PASS 1 — ordinary member, member-facing routes.
        $member = $this->actAs(['role' => 'member']);
        $this->controlIds = $this->seedRecords($this->testTenantId, $member);
        foreach ($endpoints as $endpoint) {
            if (! str_starts_with($endpoint['prefix'], 'admin/')) {
                $this->probe($endpoint, 'member');
            }
        }

        // PASS 2 — community admin, administration routes.
        $admin = $this->actAs(['role' => 'admin']);
        $this->controlIds = $this->seedRecords($this->testTenantId, $admin);
        foreach ($endpoints as $endpoint) {
            if (str_starts_with($endpoint['prefix'], 'admin/')) {
                $this->probe($endpoint, 'admin');
            }
        }

        $this->writeEvidenceFile();
        $this->printSummary($endpoints);

        // GATE 1 — a new endpoint returning another community's data is a breach.
        $leaks = array_values(array_map(
            static fn ($r) => $r['actor'] . ' ' . $r['method'] . ' ' . $r['uri'] . ' -> ' . $r['status'],
            array_filter(
                $this->results,
                static fn ($r) => $r['verdict'] === 'LEAK'
                    && ! in_array($r['uri'], self::KNOWN_SOFT_200, true)
            )
        ));

        $this->assertSame(
            [],
            $leaks,
            'An endpoint served a record belonging to another community. '
            . 'Read its body_excerpt in .local-docs-archive/security-evidence/cross-community-sweep.json '
            . 'before deciding whether it is a data leak or belongs in KNOWN_SOFT_200.'
        );

        // GATE 2 — the baseline shrinks only. An entry that no longer answers
        // 200 has been fixed, and its line must go in the same commit.
        $stillReproducing = array_values(array_filter(
            self::KNOWN_SOFT_200,
            fn (string $uri) => (bool) array_filter(
                $this->results,
                static fn ($r) => $r['uri'] === $uri && in_array($r['verdict'], ['LEAK', 'EMPTY_200'], true)
            )
        ));

        $this->assertSame(
            self::KNOWN_SOFT_200,
            $stillReproducing,
            'A KNOWN_SOFT_200 entry no longer answers 200 for a foreign record. '
            . 'It is fixed — delete its line from KNOWN_SOFT_200 so the list keeps shrinking.'
        );
    }

    // ================================================================
    // Write operations
    // ================================================================

    /**
     * Every non-GET v2 endpoint with exactly one path parameter, requested
     * with a record from the OTHER community and an empty JSON body.
     *
     * The bar here is deliberately the one a tester would apply: any 2xx is a
     * mutation accepted against a foreign record and is a finding. A 401/403/
     * 404/410 is a refusal. A 400/422 means validation rejected the empty body
     * before scoping could be observed — recorded as VALIDATION_FIRST and never
     * counted as a pass, because it proves nothing about the scope check.
     * There is no control request for writes: sending a real body to hundreds
     * of endpoints is out of scope for an automated sweep.
     */
    public function test_no_write_endpoint_mutates_another_communitys_record(): void
    {
        $endpoints = $this->probeableWriteEndpoints();
        $this->assertNotEmpty($endpoints, 'Write-route enumeration produced nothing — the sweep would pass vacuously.');

        $this->victimOwner = User::factory()->forTenant(self::VICTIM_TENANT_ID)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->victimIds = $this->seedRecords(self::VICTIM_TENANT_ID, $this->victimOwner);

        $results = [];
        $run = function (string $actor, callable $selector) use ($endpoints, &$results): void {
            foreach ($endpoints as $e) {
                if (! $selector($e)) {
                    continue;
                }
                $row = $e + ['actor' => $actor, 'status' => null, 'verdict' => 'SKIPPED', 'note' => $e['skip'] ?? '', 'body_excerpt' => ''];
                if ($e['skip'] !== null) {
                    $results[] = $row;
                    continue;
                }
                $victimId = $this->victimIds[$e['fixture']] ?? null;
                if ($victimId === null) {
                    $results[] = array_merge($row, ['note' => "fixture '{$e['fixture']}' could not be created"]);
                    continue;
                }
                $uri = '/' . ltrim(preg_replace('#^api/#', '', preg_replace('/\{[^}]+\}/', (string) $victimId, $e['uri'])), '/');

                // Snapshot the foreign record so "accepted" and "actually changed"
                // are not confused. A 2xx that leaves the row identical is an
                // endpoint that should have refused but did no harm to the other
                // community's data (a no-op unsave, an idempotent delete of a row
                // the actor never had). A 2xx that alters or removes the row is a
                // confirmed cross-community mutation. Rows CREATED elsewhere (a
                // referral, a view record) are not visible to this comparison and
                // are why every ACCEPTED_NO_CHANGE body is kept for a human to read.
                $table = $this->fixtureTable($e['fixture']);
                $before = $table ? json_encode(DB::table($table)->where('id', $victimId)->first()) : null;

                try {
                    $response = $this->json($e['method'], '/api' . $uri, [], $this->withTenantHeader());
                    $status = $response->getStatusCode();
                    $body = mb_substr((string) $response->getContent(), 0, 300);
                } catch (\Throwable $ex) {
                    $results[] = array_merge($row, ['verdict' => 'INCONCLUSIVE', 'note' => 'threw ' . class_basename($ex) . ': ' . mb_substr($ex->getMessage(), 0, 160)]);
                    continue;
                }

                $after = $table ? json_encode(DB::table($table)->where('id', $victimId)->first()) : null;
                $rowChanged = $table !== null && $before !== $after;

                [$verdict, $note] = match (true) {
                    $status >= 200 && $status < 300 && $rowChanged => ['MUTATED', $after === 'null' ? 'the foreign record was DELETED' : 'the foreign record was CHANGED'],
                    $status >= 200 && $status < 300 => ['ACCEPTED_NO_CHANGE', '2xx for a foreign id but its row is unchanged — should refuse; read the body for side rows'],
                    in_array($status, [401, 403, 404, 410], true) => ['REFUSED', ''],
                    in_array($status, [400, 422], true) => ['VALIDATION_FIRST', 'validation rejected the empty body before scoping could be observed — not a pass'],
                    $status === 405 => ['SKIPPED', 'method not allowed at runtime'],
                    default => ['INCONCLUSIVE', "status {$status}"],
                };
                $results[] = array_merge($row, ['status' => $status, 'verdict' => $verdict, 'note' => $note, 'body_excerpt' => $verdict === 'REFUSED' ? '' : $body]);
            }
        };

        $this->actAs(['role' => 'member']);
        $run('member', static fn ($e) => ! str_starts_with($e['prefix'], 'admin/'));

        $this->actAs(['role' => 'admin']);
        $run('admin', static fn ($e) => str_starts_with($e['prefix'], 'admin/'));

        // Evidence + summary.
        $dir = dirname(__DIR__, 4) . '/.local-docs-archive/security-evidence';
        if (is_dir($dir) || @mkdir($dir, 0o775, true) || is_dir($dir)) {
            @file_put_contents($dir . '/cross-community-write-sweep.json', json_encode([
                'generated_at' => date('c'),
                'method' => 'Every non-GET single-parameter v2 route requested with a tenant-999 record id and an empty JSON body, as a tenant-2 member (member routes) and a tenant-2 community admin (/admin/ routes). 2xx = MUTATED (finding); 401/403/404/410 = REFUSED; 400/422 = VALIDATION_FIRST (not a pass).',
                'results' => $results,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        }

        $lines = ['', '=== CROSS-COMMUNITY WRITE SWEEP ===', sprintf('non-GET v2 endpoints with one path parameter : %d', count($endpoints))];
        foreach (['member' => 'PASS 1 — member, member-facing routes', 'admin' => 'PASS 2 — community admin, /admin/ routes'] as $actor => $label) {
            $t = ['MUTATED' => 0, 'ACCEPTED_NO_CHANGE' => 0, 'REFUSED' => 0, 'VALIDATION_FIRST' => 0, 'INCONCLUSIVE' => 0, 'SKIPPED' => 0];
            foreach ($results as $r) {
                if ($r['actor'] === $actor) {
                    $t[$r['verdict']]++;
                }
            }
            $lines[] = '';
            $lines[] = $label;
            $lines[] = sprintf('  probed                                    : %d', $t['MUTATED'] + $t['ACCEPTED_NO_CHANGE'] + $t['REFUSED'] + $t['VALIDATION_FIRST'] + $t['INCONCLUSIVE']);
            $lines[] = sprintf('    refused (401/403/404/410)               : %d', $t['REFUSED']);
            $lines[] = sprintf('    validation rejected first (not a pass)  : %d', $t['VALIDATION_FIRST']);
            $lines[] = sprintf('    accepted, foreign row unchanged (review): %d', $t['ACCEPTED_NO_CHANGE']);
            $lines[] = sprintf('    MUTATED the foreign record              : %d', $t['MUTATED']);
            $lines[] = sprintf('    inconclusive                            : %d', $t['INCONCLUSIVE']);
            $lines[] = sprintf('  skipped                                   : %d', $t['SKIPPED']);
        }
        $lines[] = '';
        foreach (['MUTATED', 'ACCEPTED_NO_CHANGE', 'INCONCLUSIVE'] as $bucket) {
            $rows = array_filter($results, static fn ($r) => $r['verdict'] === $bucket);
            if ($rows === []) {
                continue;
            }
            $lines[] = $bucket . ':';
            foreach ($rows as $r) {
                $lines[] = sprintf('  [%s] %-6s %s -> %s  %s', $r['actor'], $r['method'], $r['uri'], $r['status'] ?? 'exception', preg_replace('/\s+/', ' ', $r['body_excerpt']));
            }
            $lines[] = '';
        }
        fwrite(STDERR, implode(PHP_EOL, $lines) . PHP_EOL);

        $mutated = array_values(array_map(
            static fn ($r) => $r['actor'] . ' ' . $r['method'] . ' ' . $r['uri'] . ' -> ' . $r['status'],
            array_filter($results, static fn ($r) => $r['verdict'] === 'MUTATED')
        ));

        $this->assertSame([], $mutated, 'A write against another community\'s record was accepted. Read the body_excerpt in cross-community-write-sweep.json.');

        // Baseline of accepted-but-harmless no-ops: may only shrink.
        $acceptedNoChange = array_values(array_map(
            static fn ($r) => $r['method'] . ' ' . $r['uri'],
            array_filter($results, static fn ($r) => $r['verdict'] === 'ACCEPTED_NO_CHANGE')
        ));
        sort($acceptedNoChange);
        $known = self::KNOWN_ACCEPTED_NO_CHANGE;
        sort($known);

        $this->assertSame(
            [],
            array_values(array_diff($acceptedNoChange, $known)),
            'A write endpoint newly acknowledges a foreign id with 2xx. Read its body in cross-community-write-sweep.json; '
            . 'fix it to refuse, or — only if it provably touches nothing — add it to KNOWN_ACCEPTED_NO_CHANGE with a note.'
        );

        $this->assertSame(
            [],
            array_values(array_diff($known, $acceptedNoChange)),
            'A KNOWN_ACCEPTED_NO_CHANGE entry no longer answers 2xx for a foreign id. It is fixed — delete its line.'
        );
    }

    /**
     * A PERSON from another community, supplied as the SECOND identifier.
     *
     * WHY THIS IS A SEPARATE SWEEP
     * ----------------------------
     * Both sweeps above take routes with exactly ONE path parameter. 141
     * route-and-method combinations take two or more, and none of them were
     * exercised. They are also where a scoping bug is most likely to survive
     * review, because the handler checks that the FIRST id belongs to the
     * caller's community and then forgets the second.
     *
     * `PUT groups/{id}/members/{userId}` with OUR group and a FOREIGN member is
     * the shape that matters: nothing about the group looks wrong, the caller is
     * a legitimate administrator of it, and a person is quietly pulled across a
     * community boundary. So the outer record here is deliberately ours and
     * legitimate. Only the person is foreign. A refusal is the required answer.
     *
     * DETECTOR — stronger than the single-parameter write sweep's
     * -----------------------------------------------------------
     * That sweep compares the target row before and after, and says plainly
     * that rows CREATED ELSEWHERE are invisible to it. That blind spot is
     * exactly this sweep's subject, because "add this person to my group"
     * creates a row in a join table rather than altering the group. So this
     * sweep counts, before and after every request, each row in the schema that
     * REFERENCES the foreign person — across every table carrying a
     * person-shaped foreign key. A count that moves in either direction is a
     * confirmed cross-community write, whether the row was created, changed or
     * removed.
     *
     * CONTROL-VERIFIED, like the read sweep: every probe is repeated with a
     * person from our OWN community, so an endpoint that refuses everything
     * cannot be counted as a pass.
     */
    public function test_no_endpoint_accepts_a_person_from_another_community(): void
    {
        $endpoints = $this->multiParamPersonEndpoints();
        $this->assertNotEmpty(
            $endpoints,
            'Multi-parameter route enumeration produced nothing — this sweep would pass vacuously.'
        );

        $this->victimOwner = User::factory()->forTenant(self::VICTIM_TENANT_ID)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $foreignPersonId = (int) $this->victimOwner->id;

        $refs = $this->personReferenceColumns();
        $this->assertNotEmpty($refs, 'No person-shaped foreign keys found — the mutation detector would be blind.');

        $results = [];

        $run = function (string $actorLabel, User $actor, callable $selector) use (
            $endpoints,
            &$results,
            $foreignPersonId,
            $refs
        ): void {
            $ownIds = $this->seedRecords($this->testTenantId, $actor);
            $controlPerson = User::factory()->forTenant($this->testTenantId)->create([
                'status' => 'active',
                'is_approved' => true,
            ]);
            $this->seedControlRelationships($controlPerson, $actor, $ownIds);

            foreach ($endpoints as $e) {
                if (! $selector($e)) {
                    continue;
                }

                $row = $e + [
                    'actor' => $actorLabel,
                    'status' => null,
                    'control_status' => null,
                    'verdict' => 'SKIPPED',
                    'note' => $e['skip'] ?? '',
                    'body_excerpt' => '',
                    'moved' => [],
                ];

                if ($e['skip'] !== null) {
                    $results[] = $row;

                    continue;
                }

                // Re-established before EVERY endpoint, not once per pass.
                // The control request for `DELETE .../members/{userId}` really
                // does remove the control person from the group, after which
                // every later control failed and seven endpoints were reported
                // INCONCLUSIVE for a reason that was this test's fault rather
                // than the platform's.
                $this->seedControlRelationships($controlPerson, $actor, $ownIds);

                [$uri, $missing] = $this->fillMultiParamUri($e['plan'], $e['uri'], $ownIds, $foreignPersonId);
                if ($missing !== null) {
                    $results[] = array_merge($row, ['note' => $missing]);

                    continue;
                }

                $before = $this->personReferenceCounts($refs, $foreignPersonId);

                try {
                    $response = $this->json(
                        $e['method'],
                        '/' . ltrim($uri, '/'),
                        [],
                        $this->withTenantHeader()
                    );
                    $status = $response->getStatusCode();
                    $body = mb_substr((string) $response->getContent(), 0, 300);
                } catch (\Throwable $ex) {
                    $results[] = array_merge($row, [
                        'verdict' => 'INCONCLUSIVE',
                        'note' => 'threw ' . class_basename($ex) . ': ' . mb_substr($ex->getMessage(), 0, 160),
                    ]);

                    continue;
                }

                $after = $this->personReferenceCounts($refs, $foreignPersonId);
                $moved = [];
                foreach ($after as $where => $count) {
                    $was = $before[$where] ?? 0;
                    if ($count !== $was) {
                        $moved[] = "{$where}: {$was} -> {$count}";
                    }
                }

                // Control: the same request for a person of OUR community, so a
                // blanket-refusing endpoint cannot be scored as a pass.
                [$controlUri] = $this->fillMultiParamUri($e['plan'], $e['uri'], $ownIds, (int) $controlPerson->id);
                $controlStatus = null;

                try {
                    $controlStatus = $this->json(
                        $e['method'],
                        '/' . ltrim($controlUri, '/'),
                        [],
                        $this->withTenantHeader()
                    )->getStatusCode();
                } catch (\Throwable) {
                    $controlStatus = null;
                }

                $controlWorked = $controlStatus !== null && $controlStatus >= 200 && $controlStatus < 300;
                $succeeded = $status >= 200 && $status < 300;
                $isRead = $e['method'] === 'GET';

                [$verdict, $note] = match (true) {
                    $succeeded && $moved !== [] => ['MUTATED', 'rows referencing the foreign person moved: ' . implode('; ', $moved)],
                    $succeeded && $isRead && $this->bodyMentionsVictim($body, $foreignPersonId) => ['LEAKED', 'the response carried the foreign person\'s data'],
                    $succeeded => ['ACCEPTED_NO_CHANGE', '2xx for a foreign person but nothing referencing them moved — should refuse'],
                    in_array($status, self::REFUSED, true) && $controlWorked => ['REFUSED', ''],
                    in_array($status, self::REFUSED, true) => ['INCONCLUSIVE', "refused, but the control also failed ({$controlStatus}) — endpoint not exercised"],
                    in_array($status, [400, 422], true) => ['VALIDATION_FIRST', 'validation rejected the empty body before scoping could be observed — not a pass'],
                    $status === 405 => ['SKIPPED', 'method not allowed at runtime'],
                    default => ['INCONCLUSIVE', "status {$status}"],
                };

                $results[] = array_merge($row, [
                    'status' => $status,
                    'control_status' => $controlStatus,
                    'verdict' => $verdict,
                    'note' => $note,
                    'moved' => $moved,
                    'body_excerpt' => $verdict === 'REFUSED' ? '' : $body,
                ]);
            }
        };

        $member = $this->actAs(['role' => 'member']);
        $run('member', $member, static fn ($e) => ! str_starts_with($e['prefix'], 'admin/'));

        $admin = $this->actAs(['role' => 'admin']);
        $run('admin', $admin, static fn ($e) => str_starts_with($e['prefix'], 'admin/'));

        $dir = dirname(__DIR__, 4) . '/.local-docs-archive/security-evidence';
        if (is_dir($dir) || @mkdir($dir, 0o775, true) || is_dir($dir)) {
            @file_put_contents($dir . '/cross-community-person-sweep.json', json_encode([
                'generated_at' => date('c'),
                'method' => 'Every v2 route taking two or more path parameters where one names a PERSON. The record parameters are filled with OUR OWN records, owned by the acting user; only the person is from tenant 999. Rows referencing that person are counted across every person-shaped foreign key in the schema, before and after each request, so a created join row is detected. Every probe is control-verified with a person from our own community.',
                'person_reference_columns_watched' => count($refs),
                'results' => $results,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        }

        $lines = ['', '=== FOREIGN-PERSON SWEEP (multi-parameter routes) ===',
            sprintf('multi-parameter v2 route/method combinations naming a person : %d', count($endpoints)),
            sprintf('person-shaped foreign keys watched for side rows            : %d', count($refs)),
        ];
        foreach (['member' => 'PASS 1 — member, member-facing routes', 'admin' => 'PASS 2 — community admin, /admin/ routes'] as $actorLabel => $label) {
            $t = ['MUTATED' => 0, 'LEAKED' => 0, 'ACCEPTED_NO_CHANGE' => 0, 'REFUSED' => 0, 'VALIDATION_FIRST' => 0, 'INCONCLUSIVE' => 0, 'SKIPPED' => 0];
            foreach ($results as $r) {
                if ($r['actor'] === $actorLabel) {
                    $t[$r['verdict']]++;
                }
            }
            $lines[] = '';
            $lines[] = $label;
            $lines[] = sprintf('  probed                                    : %d', $t['MUTATED'] + $t['LEAKED'] + $t['ACCEPTED_NO_CHANGE'] + $t['REFUSED'] + $t['VALIDATION_FIRST'] + $t['INCONCLUSIVE']);
            $lines[] = sprintf('    refused, control succeeded              : %d', $t['REFUSED']);
            $lines[] = sprintf('    validation rejected first (not a pass)  : %d', $t['VALIDATION_FIRST']);
            $lines[] = sprintf('    accepted, nothing moved (review)        : %d', $t['ACCEPTED_NO_CHANGE']);
            $lines[] = sprintf('    LEAKED the foreign person\'s data        : %d', $t['LEAKED']);
            $lines[] = sprintf('    MUTATED rows referencing them           : %d', $t['MUTATED']);
            $lines[] = sprintf('    inconclusive                            : %d', $t['INCONCLUSIVE']);
            $lines[] = sprintf('  skipped                                   : %d', $t['SKIPPED']);
        }
        $lines[] = '';
        foreach (['MUTATED', 'LEAKED', 'ACCEPTED_NO_CHANGE', 'INCONCLUSIVE'] as $bucket) {
            $rows = array_filter($results, static fn ($r) => $r['verdict'] === $bucket);
            if ($rows === []) {
                continue;
            }
            $lines[] = $bucket . ':';
            foreach ($rows as $r) {
                $lines[] = sprintf(
                    '  [%s] %-6s %s  probe=%s control=%s  %s',
                    $r['actor'],
                    $r['method'],
                    $r['uri'],
                    $r['status'] ?? 'exception',
                    $r['control_status'] ?? '-',
                    preg_replace('/\s+/', ' ', $r['note'] . ' ' . $r['body_excerpt'])
                );
            }
            $lines[] = '';
        }
        fwrite(STDERR, implode(PHP_EOL, $lines) . PHP_EOL);

        $breaches = array_values(array_map(
            static fn ($r) => $r['verdict'] . ' ' . $r['actor'] . ' ' . $r['method'] . ' ' . $r['uri'] . ' -> ' . $r['status'] . ' :: ' . $r['note'],
            array_filter($results, static fn ($r) => in_array($r['verdict'], ['MUTATED', 'LEAKED'], true))
        ));

        $this->assertSame(
            [],
            $breaches,
            'An endpoint accepted or served a person belonging to another community. '
            . 'Read cross-community-person-sweep.json.'
        );

        // Accepted-but-inert answers: shrink-only, both directions.
        $acceptedNoChange = array_values(array_map(
            static fn ($r) => $r['method'] . ' ' . $r['uri'],
            array_filter($results, static fn ($r) => $r['verdict'] === 'ACCEPTED_NO_CHANGE')
        ));
        sort($acceptedNoChange);
        $known = self::KNOWN_PERSON_ACCEPTED_NO_CHANGE;
        sort($known);

        $this->assertSame(
            [],
            array_values(array_diff($acceptedNoChange, $known)),
            'An endpoint newly answers 2xx for a person from another community. Fix it to refuse, '
            . 'or — only if it provably touches nothing — add it to KNOWN_PERSON_ACCEPTED_NO_CHANGE with a note.'
        );

        $this->assertSame(
            [],
            array_values(array_diff($known, $acceptedNoChange)),
            'A KNOWN_PERSON_ACCEPTED_NO_CHANGE entry no longer answers 2xx for a foreign person. It is fixed — delete its line.'
        );
    }

    /**
     * A CHILD RECORD from another community, supplied as the deepest identifier.
     *
     * The companion to the foreign-person sweep, and the rest of Finding 14.
     * These are the multi-parameter routes whose second identifier is another
     * RECORD rather than a person: a lesson within a course, a version within a
     * legal document, an episode within a show, an answer within a question.
     *
     * The shape is the same and so is the reasoning: **every identifier except
     * the last is one of OUR OWN records, owned by the acting user.** Only the
     * deepest one belongs to another community. So the request looks entirely
     * legitimate up to its final segment, and it fails only if the handler
     * confirms that the child really belongs to the parent it was reached
     * through — which is the check most easily forgotten.
     *
     * WHY THIS NEEDED EIGHTEEN NEW FIXTURES
     * -------------------------------------
     * Measuring this first showed why it could not be bolted onto the existing
     * resolution: 84 of the 86 candidate routes resolved BOTH identifiers to
     * the same fixture type, because the child parameter fell back to matching
     * its parent's path prefix. The sweep would have requested
     * `courses/5/lessons/5` — the same row as both course and lesson — and the
     * control would have rejected it, producing a page of results that proved
     * nothing while appearing to be coverage. Real child fixtures, each linked
     * by `needs` to the parent seeded for the same community, are what make the
     * question answerable at all.
     *
     * Every probe is control-verified: the same request with OUR OWN child.
     */
    public function test_no_endpoint_accepts_a_child_record_from_another_community(): void
    {
        $endpoints = $this->multiParamChildEndpoints();
        $this->assertNotEmpty(
            $endpoints,
            'Multi-parameter child-route enumeration produced nothing — this sweep would pass vacuously.'
        );

        // The courses module is switched OFF for the test community, so twelve
        // course endpoints answered 403 FEATURE_DISABLED to the probe AND to
        // the control — an unexercised endpoint, not a pass. A feature gate
        // firing first tells us nothing about community scoping, which is what
        // this test is for, so the module is enabled for both communities here.
        $this->enableTenantFeatures(['courses', 'podcasts'], $this->testTenantId, self::VICTIM_TENANT_ID);

        $this->victimOwner = User::factory()->forTenant(self::VICTIM_TENANT_ID)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->victimIds = $this->seedRecords(self::VICTIM_TENANT_ID, $this->victimOwner);

        $results = [];

        $run = function (string $actorLabel, User $actor, callable $selector) use ($endpoints, &$results): void {
            $ownIds = $this->seedRecords($this->testTenantId, $actor);

            foreach ($endpoints as $e) {
                if (! $selector($e)) {
                    continue;
                }

                // The endpoints run in sorted order, and a CONTROL request is a
                // real request: the control for `DELETE .../versions/{versionId}`
                // genuinely deletes our own version, after which the controls
                // for PUT, notify and pending-count on the same record all
                // answered "Version not found" and three endpoints were
                // reported INCONCLUSIVE through no fault of the platform. The
                // person sweep hit the identical trap with group membership.
                // So: if a record this endpoint needs has been consumed, seed a
                // fresh set. Cheap, because it only happens after a destructive
                // control, and it makes the sweep order-independent.
                if (! $this->recordsStillExist($e['keys'] ?? [], $ownIds)) {
                    $ownIds = $this->seedRecords($this->testTenantId, $actor);
                }

                $row = $e + [
                    'actor' => $actorLabel,
                    'status' => null,
                    'control_status' => null,
                    'verdict' => 'SKIPPED',
                    'note' => $e['skip'] ?? '',
                    'body_excerpt' => '',
                ];

                if ($e['skip'] !== null) {
                    $results[] = $row;

                    continue;
                }

                $last = count($e['keys']) - 1;
                $childKey = $e['keys'][$last];

                // Probe: our own records, and another community's child last.
                $probeIds = [];
                $controlIds = [];
                $missing = null;
                foreach ($e['keys'] as $i => $key) {
                    $own = $ownIds[$key] ?? null;
                    if ($own === null) {
                        $missing = "our own fixture '{$key}' could not be created";
                        break;
                    }
                    $controlIds[] = $own;

                    if ($i === $last) {
                        $victim = $this->victimIds[$key] ?? null;
                        if ($victim === null) {
                            $missing = "the other community's fixture '{$key}' could not be created";
                            break;
                        }
                        $probeIds[] = $victim;
                    } else {
                        $probeIds[] = $own;
                    }
                }

                if ($missing !== null) {
                    $results[] = array_merge($row, ['note' => $missing]);

                    continue;
                }

                $table = $this->fixtureTable($childKey);
                $victimChildId = $this->victimIds[$childKey];
                $before = $table ? json_encode(DB::table($table)->where('id', $victimChildId)->first()) : null;

                [$uri] = $this->fillFromIds($e['uri'], $probeIds);

                try {
                    $response = $this->json($e['method'], '/' . ltrim($uri, '/'), [], $this->withTenantHeader());
                    $status = $response->getStatusCode();
                    $body = mb_substr((string) $response->getContent(), 0, 300);
                } catch (\Throwable $ex) {
                    $results[] = array_merge($row, [
                        'verdict' => 'INCONCLUSIVE',
                        'note' => 'threw ' . class_basename($ex) . ': ' . mb_substr($ex->getMessage(), 0, 160),
                    ]);

                    continue;
                }

                $after = $table ? json_encode(DB::table($table)->where('id', $victimChildId)->first()) : null;
                $rowChanged = $table !== null && $before !== $after;

                [$controlUri] = $this->fillFromIds($e['uri'], $controlIds);
                $controlStatus = null;

                try {
                    $controlStatus = $this->json($e['method'], '/' . ltrim($controlUri, '/'), [], $this->withTenantHeader())
                        ->getStatusCode();
                } catch (\Throwable) {
                    $controlStatus = null;
                }

                $controlWorked = $controlStatus !== null && $controlStatus >= 200 && $controlStatus < 300;
                $succeeded = $status >= 200 && $status < 300;

                [$verdict, $note] = match (true) {
                    $succeeded && $rowChanged => ['MUTATED', $after === 'null' ? "another community's {$childKey} was DELETED" : "another community's {$childKey} was CHANGED"],
                    $succeeded && $e['method'] === 'GET' && $this->bodyMentionsVictim($body, $victimChildId) => ['LEAKED', "the response carried another community's {$childKey}"],
                    $succeeded => ['ACCEPTED_NO_CHANGE', "2xx for another community's {$childKey} but its row is unchanged — should refuse"],
                    in_array($status, self::REFUSED, true) && $controlWorked => ['REFUSED', ''],
                    in_array($status, self::REFUSED, true) => ['INCONCLUSIVE', "refused, but the control also failed ({$controlStatus}) — endpoint not exercised"],
                    in_array($status, [400, 422], true) => ['VALIDATION_FIRST', 'validation rejected the empty body before scoping could be observed — not a pass'],
                    $status === 405 => ['SKIPPED', 'method not allowed at runtime'],
                    default => ['INCONCLUSIVE', "status {$status}"],
                };

                $results[] = array_merge($row, [
                    'status' => $status,
                    'control_status' => $controlStatus,
                    'verdict' => $verdict,
                    'note' => $note,
                    'body_excerpt' => $verdict === 'REFUSED' ? '' : $body,
                ]);
            }
        };

        $member = $this->actAs(['role' => 'member']);
        $run('member', $member, static fn ($e) => ! str_starts_with($e['prefix'], 'admin/'));

        $admin = $this->actAs(['role' => 'admin']);
        $run('admin', $admin, static fn ($e) => str_starts_with($e['prefix'], 'admin/'));

        $dir = dirname(__DIR__, 4) . '/.local-docs-archive/security-evidence';
        if (is_dir($dir) || @mkdir($dir, 0o775, true) || is_dir($dir)) {
            @file_put_contents($dir . '/cross-community-child-sweep.json', json_encode([
                'generated_at' => date('c'),
                'method' => "Every v2 route taking two or more path parameters where none names a person. All identifiers except the deepest are filled with OUR OWN records owned by the acting user; the deepest is a child record from tenant 999. The foreign child's row is read before and after each request. Every probe is control-verified with our own child.",
                'results' => $results,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        }

        $lines = ['', '=== FOREIGN-CHILD SWEEP (multi-parameter routes) ===',
            sprintf('multi-parameter v2 route/method combinations without a person : %d', count($endpoints)),
        ];
        foreach (['member' => 'PASS 1 — member, member-facing routes', 'admin' => 'PASS 2 — community admin, /admin/ routes'] as $actorLabel => $label) {
            $t = ['MUTATED' => 0, 'LEAKED' => 0, 'ACCEPTED_NO_CHANGE' => 0, 'REFUSED' => 0, 'VALIDATION_FIRST' => 0, 'INCONCLUSIVE' => 0, 'SKIPPED' => 0];
            foreach ($results as $r) {
                if ($r['actor'] === $actorLabel) {
                    $t[$r['verdict']]++;
                }
            }
            $lines[] = '';
            $lines[] = $label;
            $lines[] = sprintf('  probed                                    : %d', $t['MUTATED'] + $t['LEAKED'] + $t['ACCEPTED_NO_CHANGE'] + $t['REFUSED'] + $t['VALIDATION_FIRST'] + $t['INCONCLUSIVE']);
            $lines[] = sprintf('    refused, control succeeded              : %d', $t['REFUSED']);
            $lines[] = sprintf('    validation rejected first (not a pass)  : %d', $t['VALIDATION_FIRST']);
            $lines[] = sprintf('    accepted, row unchanged (review)        : %d', $t['ACCEPTED_NO_CHANGE']);
            $lines[] = sprintf("    LEAKED another community's child        : %d", $t['LEAKED']);
            $lines[] = sprintf('    MUTATED it                              : %d', $t['MUTATED']);
            $lines[] = sprintf('    inconclusive                            : %d', $t['INCONCLUSIVE']);
            $lines[] = sprintf('  skipped                                   : %d', $t['SKIPPED']);
        }
        $lines[] = '';
        foreach (['MUTATED', 'LEAKED', 'ACCEPTED_NO_CHANGE', 'INCONCLUSIVE'] as $bucket) {
            $rows = array_filter($results, static fn ($r) => $r['verdict'] === $bucket);
            if ($rows === []) {
                continue;
            }
            $lines[] = $bucket . ':';
            foreach ($rows as $r) {
                $lines[] = sprintf(
                    '  [%s] %-6s %s  probe=%s control=%s  %s',
                    $r['actor'],
                    $r['method'],
                    $r['uri'],
                    $r['status'] ?? 'exception',
                    $r['control_status'] ?? '-',
                    preg_replace('/\s+/', ' ', $r['note'] . ' ' . $r['body_excerpt'])
                );
            }
            $lines[] = '';
        }
        fwrite(STDERR, implode(PHP_EOL, $lines) . PHP_EOL);

        $breaches = array_values(array_map(
            static fn ($r) => $r['verdict'] . ' ' . $r['actor'] . ' ' . $r['method'] . ' ' . $r['uri'] . ' -> ' . $r['status'] . ' :: ' . $r['note'],
            array_filter($results, static fn ($r) => in_array($r['verdict'], ['MUTATED', 'LEAKED'], true))
        ));

        $this->assertSame(
            [],
            $breaches,
            "An endpoint served or altered another community's child record. Read cross-community-child-sweep.json."
        );

        $acceptedNoChange = array_values(array_map(
            static fn ($r) => $r['method'] . ' ' . $r['uri'],
            array_filter($results, static fn ($r) => $r['verdict'] === 'ACCEPTED_NO_CHANGE')
        ));
        sort($acceptedNoChange);
        $known = self::KNOWN_CHILD_ACCEPTED_NO_CHANGE;
        sort($known);

        $this->assertSame(
            [],
            array_values(array_diff($acceptedNoChange, $known)),
            "An endpoint newly answers 2xx for another community's child record. Fix it to refuse, or — only "
            . 'if it provably touches nothing — add it to KNOWN_CHILD_ACCEPTED_NO_CHANGE with a note.'
        );

        $this->assertSame(
            [],
            array_values(array_diff($known, $acceptedNoChange)),
            'A KNOWN_CHILD_ACCEPTED_NO_CHANGE entry no longer answers 2xx for a foreign child. It is fixed — delete its line.'
        );
    }

    /**
     * Multi-parameter v2 routes naming no person, where every parameter
     * resolves to a record type this test can create.
     *
     * @return list<array<string,mixed>>
     */
    private function multiParamChildEndpoints(): array
    {
        $endpoints = [];

        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();

            if (! str_starts_with($uri, 'api/v2/')) {
                continue;
            }

            preg_match_all('/\{([^}]+)\}/', $uri, $matches);
            $params = array_map(static fn ($p) => rtrim($p, '?'), $matches[1]);

            if (count($params) < 2) {
                continue;
            }

            // Routes naming a person belong to the other sweep.
            if (array_intersect($params, self::PERSON_PARAMS) !== []) {
                continue;
            }

            $path = substr($uri, strlen('api/v2/'));
            $prefix = rtrim(substr($path, 0, (int) strpos($path, '{')), '/');

            $keys = [];
            $skip = null;

            foreach ($params as $param) {
                [$key, $reason] = $this->resolveChildParam($path, $param);

                if ($key === null) {
                    $skip = $reason ?? "no fixture for {{$param}}";

                    break;
                }

                $keys[] = $key;
            }

            // Both identifiers resolving to the SAME type means the child
            // parameter fell back to its parent's prefix; the request would use
            // one row as both. That is not a test, so it is skipped rather than
            // reported as coverage.
            if ($skip === null && count(array_unique($keys)) === 1) {
                $skip = 'every parameter resolves to the same record type — no distinct child fixture';
            }

            foreach (array_diff($route->methods(), ['HEAD']) as $method) {
                $endpoints[] = [
                    'method' => $method,
                    'uri' => $uri,
                    'prefix' => $prefix,
                    'params' => $params,
                    'keys' => $keys,
                    'skip' => $skip,
                    'action' => $route->getActionName(),
                ];
            }
        }

        usort($endpoints, static fn ($a, $b) => [$a['uri'], $a['method']] <=> [$b['uri'], $b['method']]);

        return $endpoints;
    }

    /**
     * Do the rows behind these fixture keys still exist?
     *
     * @param  list<string>  $keys
     * @param  array<string,int>  $ids
     */
    private function recordsStillExist(array $keys, array $ids): bool
    {
        foreach ($keys as $key) {
            $id = $ids[$key] ?? null;
            $table = $this->fixtureTable($key);

            if ($id === null || $table === null) {
                return false;
            }

            if (! DB::table($table)->where('id', $id)->exists()) {
                return false;
            }
        }

        return true;
    }

    /**
     * Switch feature modules on for the given communities, merging into the
     * existing `tenants.features` JSON rather than replacing it.
     *
     * A module that is off makes its endpoints answer 403 before any scoping
     * check runs, which the sweep can only record as inconclusive. Enabling it
     * is what lets the endpoint be exercised at all — it does not weaken the
     * test, because the probe and the control are treated identically.
     */
    private function enableTenantFeatures(array $features, int ...$tenantIds): void
    {
        foreach ($tenantIds as $tenantId) {
            $current = DB::table('tenants')->where('id', $tenantId)->value('features');
            $decoded = is_string($current) ? json_decode($current, true) : $current;
            $decoded = is_array($decoded) ? $decoded : [];

            foreach ($features as $feature) {
                $decoded[$feature] = true;
            }

            DB::table('tenants')->where('id', $tenantId)->update(['features' => json_encode($decoded)]);
        }
    }

    /**
     * Resolve one parameter, preferring the child map (matched on the path
     * segment before the parameter) and falling back to the shared resolver.
     *
     * @return array{0:?string,1:?string}
     */
    private function resolveChildParam(string $path, string $param): array
    {
        if (in_array($param, ['action', 'state'], true)) {
            return [null, "parameter {{$param}} names an operation, not a record"];
        }

        $before = substr($path, 0, (int) strpos($path, '{' . $param . '}'));
        $localPrefix = trim(preg_replace('#/+#', '/', rtrim(preg_replace('/\{[^}]+\}/', '', $before), '/')), '/');

        $best = null;
        foreach (array_keys(self::CHILD_FIXTURES_BY_PREFIX) as $candidate) {
            if ($localPrefix === $candidate || str_starts_with($localPrefix, $candidate . '/')) {
                if ($best === null || strlen($candidate) > strlen($best)) {
                    $best = $candidate;
                }
            }
        }

        if ($best !== null) {
            return [self::CHILD_FIXTURES_BY_PREFIX[$best], null];
        }

        return $this->resolve($localPrefix !== '' ? $localPrefix : $path, $param);
    }

    /**
     * Substitute concrete ids for a route's parameters, in order.
     *
     * @param  list<int>  $ids
     * @return array{0:string,1:?string}
     */
    private function fillFromIds(string $uri, array $ids): array
    {
        $index = 0;
        $missing = null;

        $filled = preg_replace_callback(
            '/\{[^}]+\}/',
            static function () use ($ids, &$index, &$missing): string {
                $id = $ids[$index] ?? null;
                $index++;

                if ($id === null) {
                    $missing ??= 'fewer ids than parameters';

                    return '0';
                }

                return (string) $id;
            },
            $uri
        );

        return [(string) $filled, $missing];
    }

    /**
     * Give the CONTROL person the relationships these endpoints require.
     *
     * Without this, "remove this member", "promote this member" and "approve
     * this registration" refuse the control person too — for the mundane reason
     * that they are not a member or registrant — and the probe proves nothing.
     * Nine results were INCONCLUSIVE on the first run for exactly that reason.
     *
     * The foreign person is deliberately given NONE of these, which is what
     * makes the comparison meaningful.
     *
     * 🔴 A NOTE FOR WHOEVER EXTENDS THIS. `group_members` carries `is_federated`
     * and `source_tenant_id`, so a member row pointing at a user in another
     * tenant is a DESIGNED federation state, not automatically a breach. Do not
     * "improve" this sweep by planting a foreign user in group_members and
     * calling a successful promote a finding — that needs the federation rules
     * read first. What is tested here is narrower and sound: a person with no
     * relationship to our record, and no presence in our community, must be
     * refused.
     */
    private function seedControlRelationships(User $controlPerson, User $actor, array $ownIds): void
    {
        $tenantId = $this->testTenantId;
        $now = now();

        $inserts = [
            'job_vacancy_team' => isset($ownIds['job']) ? [
                'tenant_id' => $tenantId,
                'vacancy_id' => $ownIds['job'],
                'user_id' => $controlPerson->id,
                'role' => 'reviewer',
                'added_by' => $actor->id,
                'created_at' => $now,
            ] : null,
            'group_members' => isset($ownIds['group']) ? [
                'tenant_id' => $tenantId,
                'group_id' => $ownIds['group'],
                'user_id' => $controlPerson->id,
                'status' => 'active',
                'role' => 'member',
                'joined_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ] : null,
            'event_registrations' => isset($ownIds['event']) ? [
                'tenant_id' => $tenantId,
                'event_id' => $ownIds['event'],
                'user_id' => $controlPerson->id,
                'registration_state' => 'pending',
                'created_at' => $now,
            ] : null,
        ];

        foreach ($inserts as $table => $row) {
            if ($row === null || ! Schema::hasTable($table)) {
                continue;
            }

            try {
                // Idempotent: this runs before every endpoint, and some of those
                // endpoints legitimately delete the very row being seeded.
                $exists = DB::table($table)
                    ->where('tenant_id', $row['tenant_id'])
                    ->where('user_id', $row['user_id'])
                    ->when(isset($row['group_id']), fn ($q) => $q->where('group_id', $row['group_id']))
                    ->when(isset($row['event_id']), fn ($q) => $q->where('event_id', $row['event_id']))
                    ->when(isset($row['vacancy_id']), fn ($q) => $q->where('vacancy_id', $row['vacancy_id']))
                    ->exists();

                if ($exists) {
                    continue;
                }

                DB::table($table)->insert($row);
            } catch (\Throwable $e) {
                // Left as a coverage gap rather than papered over: the control
                // will fail and the endpoint is reported INCONCLUSIVE, which is
                // the honest outcome. The reason is printed so it can be fixed.
                fwrite(STDERR, sprintf(
                    "  [control fixture] could not seed %s: %s%s",
                    $table,
                    mb_substr($e->getMessage(), 0, 140),
                    PHP_EOL
                ));
            }
        }
    }

    /**
     * Multi-parameter v2 routes where one parameter names a person and every
     * other parameter resolves to a record we can create in our own community.
     *
     * @return list<array<string,mixed>>
     */
    private function multiParamPersonEndpoints(): array
    {
        $endpoints = [];

        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();

            if (! str_starts_with($uri, 'api/v2/')) {
                continue;
            }

            preg_match_all('/\{([^}]+)\}/', $uri, $matches);
            $params = array_map(static fn ($p) => rtrim($p, '?'), $matches[1]);

            if (count($params) < 2) {
                continue;
            }

            if (array_intersect($params, self::PERSON_PARAMS) === []) {
                continue;
            }

            $path = substr($uri, strlen('api/v2/'));
            $prefix = rtrim(substr($path, 0, strpos($path, '{')), '/');

            $plan = [];
            $skip = null;

            foreach ($params as $param) {
                if (in_array($param, self::PERSON_PARAMS, true)) {
                    $plan[] = ['person', $param];

                    continue;
                }

                // Verb-shaped parameters ({action}, {state}) name an operation,
                // not a record, and carry a route pattern constraint. Resolving
                // them by path prefix filled them with an event id, the router
                // rejected the URL, and the endpoint was reported INCONCLUSIVE
                // for no better reason than that. Recognised here rather than in
                // the shared NOT_AN_ID list, because the other two sweeps'
                // published figures are derived from that list.
                if (in_array($param, ['action', 'state'], true)) {
                    $skip = "parameter {{$param}} names an operation, not a record";

                    break;
                }

                // Resolve against the path segment preceding THIS parameter, so
                // that {ticketTypeId} in events/{id}/tickets/{ticketTypeId}
                // resolves on 'events/…/tickets' rather than on 'events'.
                $before = substr($path, 0, strpos($path, '{' . $param . '}') ?: 0);
                $localPrefix = rtrim(preg_replace('/\{[^}]+\}/', '', $before), '/');
                $localPrefix = trim(preg_replace('#/+#', '/', $localPrefix), '/');

                [$fixture, $reason] = $this->resolve($localPrefix !== '' ? $localPrefix : $prefix, $param);

                if ($fixture === null) {
                    $skip = $reason ?? "no fixture for {{$param}}";

                    break;
                }

                $plan[] = ['fixture', $fixture];
            }

            foreach (array_diff($route->methods(), ['HEAD']) as $method) {
                $endpoints[] = [
                    'method' => $method,
                    'uri' => $uri,
                    'prefix' => $prefix,
                    'params' => $params,
                    'plan' => $plan,
                    'skip' => $skip,
                    'action' => $route->getActionName(),
                ];
            }
        }

        usort($endpoints, static fn ($a, $b) => [$a['uri'], $a['method']] <=> [$b['uri'], $b['method']]);

        return $endpoints;
    }

    /**
     * Substitute a concrete id for every path parameter, in order.
     *
     * @param  list<array{0:string,1:string}>  $plan
     * @param  array<string,int>  $ownIds
     * @return array{0:string,1:?string} [uri, missing-fixture reason]
     */
    private function fillMultiParamUri(array $plan, string $uri, array $ownIds, int $personId): array
    {
        $missing = null;
        $index = 0;

        $filled = preg_replace_callback(
            '/\{[^}]+\}/',
            static function () use ($plan, $ownIds, $personId, &$index, &$missing): string {
                $slot = $plan[$index] ?? null;
                $index++;

                if ($slot === null) {
                    $missing ??= 'parameter/plan mismatch';

                    return '0';
                }

                if ($slot[0] === 'person') {
                    return (string) $personId;
                }

                $id = $ownIds[$slot[1]] ?? null;

                if ($id === null) {
                    $missing ??= "own-community fixture '{$slot[1]}' could not be created";

                    return '0';
                }

                return (string) $id;
            },
            $uri
        );

        return [(string) $filled, $missing];
    }

    /**
     * Every [table, column] in the live schema whose column references a person.
     * This is what makes a created join row visible to the sweep.
     *
     * @return list<array{0:string,1:string}>
     */
    private function personReferenceColumns(): array
    {
        $placeholders = implode(',', array_fill(0, count(self::PERSON_COLUMNS), '?'));

        try {
            $rows = DB::select(
                'SELECT TABLE_NAME AS t, COLUMN_NAME AS c
                   FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE()
                    AND COLUMN_NAME IN (' . $placeholders . ')
                  ORDER BY TABLE_NAME, COLUMN_NAME',
                self::PERSON_COLUMNS
            );
        } catch (\Throwable) {
            return [];
        }

        $out = [];
        foreach ($rows as $row) {
            $out[] = [(string) $row->t, (string) $row->c];
        }

        return $out;
    }

    /**
     * Count rows referencing a person, per [table, column].
     *
     * @param  list<array{0:string,1:string}>  $refs
     * @return array<string,int>
     */
    private function personReferenceCounts(array $refs, int $personId): array
    {
        $counts = [];

        foreach ($refs as [$table, $column]) {
            try {
                $counts[$table . '.' . $column] = (int) DB::table($table)->where($column, $personId)->count();
            } catch (\Throwable) {
                // A view, or a column type that cannot be compared. Not a
                // detector for this table; deliberately left out rather than
                // recorded as zero, which would read as "nothing moved".
                continue;
            }
        }

        return $counts;
    }

    /** Database table behind a fixture key, for before/after snapshots. */
    private function fixtureTable(?string $key): ?string
    {
        if ($key === null || ! isset(self::FIXTURES[$key])) {
            return null;
        }

        $spec = self::FIXTURES[$key];

        if (isset($spec['table'])) {
            return $spec['table'];
        }

        return (new $spec['model']())->getTable();
    }

    /**
     * Every v2 non-GET endpoint with exactly one path parameter, one row per
     * declared method, with its id type resolved exactly as for reads.
     *
     * @return array<int,array{method:string,uri:string,prefix:string,param:string,fixture:?string,skip:?string,action:string}>
     */
    private function probeableWriteEndpoints(): array
    {
        $endpoints = [];

        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();

            if (! str_starts_with($uri, 'api/v2/') || substr_count($uri, '{') !== 1) {
                continue;
            }

            $methods = array_values(array_diff($route->methods(), ['GET', 'HEAD', 'OPTIONS']));
            if ($methods === []) {
                continue;
            }

            $path = substr($uri, strlen('api/v2/'));
            $brace = strpos($path, '{');
            $prefix = rtrim(substr($path, 0, $brace), '/');
            preg_match('/\{([^}?]+)\??\}/', $path, $m);
            $param = $m[1] ?? '';

            if ($prefix === '' || $param === '') {
                continue;
            }

            [$fixture, $skip] = $this->resolve($prefix, $param);

            foreach ($methods as $method) {
                $endpoints[] = [
                    'method' => $method,
                    'uri' => $uri,
                    'prefix' => $prefix,
                    'param' => $param,
                    'fixture' => $fixture,
                    'skip' => $skip,
                    'action' => $route->getActionName(),
                ];
            }
        }

        usort($endpoints, static fn ($a, $b) => [$a['uri'], $a['method']] <=> [$b['uri'], $b['method']]);

        return $endpoints;
    }

    // ================================================================
    // Probing
    // ================================================================

    private function probe(array $endpoint, string $actor): void
    {
        $base = $endpoint + ['actor' => $actor, 'status' => null, 'control_status' => null, 'body_excerpt' => '', 'victim_marker' => false];

        if ($endpoint['skip'] !== null) {
            $this->results[] = array_merge($base, ['verdict' => 'SKIPPED', 'note' => $endpoint['skip']]);

            return;
        }

        $key = $endpoint['fixture'];
        $victimId = $this->victimIds[$key] ?? null;
        $controlId = $this->controlIds[$key] ?? null;

        if ($victimId === null || $controlId === null) {
            $this->results[] = array_merge($base, ['verdict' => 'SKIPPED', 'note' => "fixture '{$key}' could not be created"]);

            return;
        }

        $foreign = $this->request($endpoint['uri'], $victimId);
        $control = $this->request($endpoint['uri'], $controlId);

        $status = $foreign['status'];
        $controlStatus = $control['status'];
        $body = $foreign['body'];
        $controlOk = in_array($controlStatus, [200, 201], true);

        [$verdict, $note] = match (true) {
            $status === null => ['INCONCLUSIVE', $foreign['error']],
            in_array($status, [200, 201], true) && $this->responseCarriesData($body) => ['LEAK', $controlOk ? '' : "control answered {$controlStatus}"],
            in_array($status, [200, 201], true) && $controlOk => ['EMPTY_200', 'answered 200 but returned no records — scoped, or nothing to find'],
            in_array($status, [200, 201], true) => ['INCONCLUSIVE', "foreign 200 empty but control answered {$controlStatus} — endpoint not exercised"],
            in_array($status, self::REFUSED, true) && $controlOk => ['REFUSED', ''],
            in_array($status, self::REFUSED, true) && $controlStatus === 404 => ['INCONCLUSIVE', 'own record also 404 — endpoint not exercised by this id type'],
            in_array($status, self::REFUSED, true) && $controlStatus === 403 => ['INCONCLUSIVE', 'own record also refused — ownership/role gate, tenant scoping not isolated'],
            in_array($status, self::REFUSED, true) => ['INCONCLUSIVE', "control answered {$controlStatus}"],
            default => ['INCONCLUSIVE', "status {$status} proves nothing about scoping"],
        };

        // array_merge, not `+`: the union operator keeps the LEFT side's keys,
        // so `$base + [...]` silently discarded every status recorded here.
        $this->results[] = array_merge($base, [
            'status' => $status,
            'control_status' => $controlStatus,
            'verdict' => $verdict,
            'note' => $note,
            'body_excerpt' => mb_substr($body, 0, 400),
            'victim_marker' => $this->bodyMentionsVictim($body, $victimId),
        ]);
    }

    /** @return array{status:?int,body:string,error:string} */
    private function request(string $routeUri, int $id): array
    {
        $uri = preg_replace('/\{[^}]+\}/', (string) $id, $routeUri);
        $uri = '/' . ltrim(preg_replace('#^api/#', '', $uri), '/');

        try {
            $response = $this->apiGet($uri);

            return ['status' => $response->getStatusCode(), 'body' => (string) $response->getContent(), 'error' => ''];
        } catch (\Throwable $e) {
            return ['status' => null, 'body' => '', 'error' => 'threw ' . class_basename($e) . ': ' . mb_substr($e->getMessage(), 0, 160)];
        }
    }

    /** Does the body visibly reference the victim record or its owner? For human review only. */
    private function bodyMentionsVictim(string $body, int $victimId): bool
    {
        if ($this->victimOwner === null) {
            return false;
        }

        foreach ([$this->victimOwner->email ?? '', $this->victimOwner->name ?? '', $this->victimOwner->first_name ?? ''] as $marker) {
            if (is_string($marker) && $marker !== '' && str_contains($body, $marker)) {
                return true;
            }
        }

        return (bool) preg_match('/"id"\s*:\s*' . $victimId . '\b/', $body);
    }

    /**
     * Did a 200 response actually carry records, or was it an empty envelope?
     *
     * Treated as "no data" when the payload decodes to null/empty, or its
     * meaningful container (`data`, `items`, `results`, …) is empty, or every
     * scalar it reports is a zero/false/null default. Anything else counts as
     * data and is escalated for manual reading — the body excerpt is stored so
     * a human can confirm the call.
     */
    private function responseCarriesData(string $body): bool
    {
        $decoded = json_decode($body, true);

        if (! is_array($decoded)) {
            return trim($body) !== '' && trim($body) !== 'null';
        }

        foreach (['data', 'items', 'results', 'records'] as $container) {
            if (array_key_exists($container, $decoded)) {
                $inner = $decoded[$container];

                if ($inner === null || $inner === [] || $inner === '') {
                    return false;
                }

                return ! (is_array($inner) && $this->allValuesAreDefaults($inner));
            }
        }

        $payload = $decoded;
        unset($payload['success'], $payload['status'], $payload['message'], $payload['meta']);

        if ($payload === []) {
            return false;
        }

        return ! $this->allValuesAreDefaults($payload);
    }

    /** True when every leaf value is a zero/false/null/empty default. */
    private function allValuesAreDefaults(array $payload): bool
    {
        foreach ($payload as $value) {
            if (is_array($value)) {
                if (! $this->allValuesAreDefaults($value)) {
                    return false;
                }

                continue;
            }

            if (! in_array($value, [null, false, 0, 0.0, '0', '', '0.00'], true)) {
                return false;
            }
        }

        return true;
    }

    // ================================================================
    // Fixtures
    // ================================================================

    private function actAs(array $attributes): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'is_super_admin' => false,
            'is_tenant_super_admin' => false,
        ], $attributes));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    /**
     * Create one record per fixture key in the given community, owned by $owner.
     *
     * The 'user' fixture is a SEPARATE member of that community, not $owner, so
     * that "view another member" endpoints are exercised as intended.
     *
     * A fixture that cannot be created leaves its key absent, which surfaces as
     * SKIPPED rather than as a silent pass.
     *
     * @return array<string,int>
     */
    private function seedRecords(int $tenantId, User $owner): array
    {
        $ids = [];

        foreach (self::FIXTURES as $key => $spec) {
            try {
                if ($key === 'user') {
                    $ids[$key] = (int) User::factory()->forTenant($tenantId)->create([
                        'status' => 'active',
                        'is_approved' => true,
                    ])->id;
                    continue;
                }

                if (isset($spec['table'])) {
                    $ids[$key] = $this->insertRow($spec, $tenantId, $owner, $ids);
                    continue;
                }

                $modelClass = $spec['model'];
                $attributes = array_merge($this->ownerAttributesFor($modelClass, $owner), $spec['attributes'] ?? []);

                foreach ($spec['needs'] ?? [] as $column => $parentKey) {
                    if (! isset($ids[$parentKey])) {
                        throw new \RuntimeException("parent fixture '{$parentKey}' missing");
                    }
                    $attributes[$column] = $ids[$parentKey];
                }

                $ids[$key] = (int) $modelClass::factory()->forTenant($tenantId)->create($attributes)->getKey();
            } catch (\Throwable $e) {
                fwrite(STDERR, sprintf(
                    "[sweep] could not seed fixture '%s' in tenant %d: %s\n",
                    $key,
                    $tenantId,
                    mb_substr($e->getMessage(), 0, 200)
                ));
            }
        }

        return $ids;
    }

    /** Direct insert for a module that has no factory. Fills only NOT NULL columns without defaults. */
    /**
     * @param  array<string,int>  $seeded  fixture key => id, for 'needs' linkage
     */
    private function insertRow(array $spec, int $tenantId, User $owner, array $seeded = []): int
    {
        $row = [];
        $n = Str::lower(Str::random(8));

        // Not every child table carries tenant_id — `legal_document_versions`
        // is scoped through its parent document's tenant_id by join, which is
        // correct and is how LegalDocumentService reads it. Setting a column
        // that does not exist would throw and lose the fixture.
        if (Schema::hasColumn($spec['table'], 'tenant_id')) {
            $row['tenant_id'] = $tenantId;
        }

        // Owner is optional: some child rows have no per-row owner column.
        if (isset($spec['owner'])) {
            $row[$spec['owner']] = $owner->id;
        }

        // Parent linkage. A child fixture MUST point at the parent seeded for
        // this same tenant, or the endpoint refuses for the mundane reason that
        // the child does not belong to the parent in the URL — which reads as a
        // pass and is not one.
        foreach ($spec['needs'] ?? [] as $column => $parentKey) {
            if (! isset($seeded[$parentKey])) {
                throw new \RuntimeException("parent fixture '{$parentKey}' missing");
            }
            $row[$column] = $seeded[$parentKey];
        }

        foreach ($spec['columns'] ?? [] as $column => $value) {
            $row[$column] = match ($value) {
                '{tomorrow}' => now()->addDay(),
                '{today}' => now()->toDateString(),
                default => str_replace('{n}', $n, (string) $value),
            };
        }

        foreach (['created_at', 'updated_at'] as $ts) {
            if (Schema::hasColumn($spec['table'], $ts)) {
                $row[$ts] = now();
            }
        }

        // A fixture whose table has a per-tenant uniqueness rule cannot simply
        // be inserted twice, and seedRecords() runs once PER ACTOR PASS inside
        // one test — so the second pass collides with the row the first pass
        // created. `unique` names the columns that, with tenant_id, identify an
        // existing row; that row is then reused. (`legal_documents` is unique on
        // (tenant_id, document_type).) Reuse is sound here: the sweep needs *a*
        // record of this type in this community, not a brand-new one.
        if (isset($spec['unique'])) {
            $lookup = DB::table($spec['table']);
            if (Schema::hasColumn($spec['table'], 'tenant_id')) {
                $lookup->where('tenant_id', $tenantId);
            }
            foreach ($spec['unique'] as $column) {
                $lookup->where($column, $row[$column] ?? null);
            }

            $existing = $lookup->value('id');
            if ($existing !== null) {
                return (int) $existing;
            }
        }

        return (int) DB::table($spec['table'])->insertGetId($row);
    }

    /**
     * Best-effort owner attribution so factories with a required user relation
     * produce a record owned inside the right community by the right person.
     */
    private function ownerAttributesFor(string $modelClass, User $owner): array
    {
        $model = new $modelClass();
        $attributes = [];

        foreach (['user_id', 'created_by', 'owner_id', 'author_id'] as $column) {
            if ($model->getConnection()->getSchemaBuilder()->hasColumn($model->getTable(), $column)) {
                $attributes[$column] = $owner->id;
            }
        }

        return $attributes;
    }

    // ================================================================
    // Route enumeration and id-type resolution
    // ================================================================

    /**
     * Every v2 GET endpoint with exactly one path parameter, with its id type
     * resolved (or the reason it is skipped).
     *
     * @return array<int,array{method:string,uri:string,prefix:string,param:string,fixture:?string,skip:?string,action:string}>
     */
    private function probeableEndpoints(): array
    {
        $endpoints = [];

        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();

            if (! str_starts_with($uri, 'api/v2/') || ! in_array('GET', $route->methods(), true)) {
                continue;
            }

            if (substr_count($uri, '{') !== 1) {
                continue;
            }

            $path = substr($uri, strlen('api/v2/'));
            $brace = strpos($path, '{');
            $prefix = rtrim(substr($path, 0, $brace), '/');
            preg_match('/\{([^}?]+)\??\}/', $path, $m);
            $param = $m[1] ?? '';

            if ($prefix === '' || $param === '') {
                continue;
            }

            [$fixture, $skip] = $this->resolve($prefix, $param);

            $endpoints[] = [
                'method' => 'GET',
                'uri' => $uri,
                'prefix' => $prefix,
                'param' => $param,
                'fixture' => $fixture,
                'skip' => $skip,
                'action' => $route->getActionName(),
            ];
        }

        usort($endpoints, static fn ($a, $b) => $a['uri'] <=> $b['uri']);

        return $endpoints;
    }

    /** @return array{0:?string,1:?string} [fixture key, skip reason] */
    private function resolve(string $prefix, string $param): array
    {
        if (str_starts_with($prefix, 'admin/super/') || str_starts_with($prefix, 'super-admin/')) {
            return [null, 'platform-tier route — covered by RoleBoundarySweepTest'];
        }

        if (in_array($param, self::NOT_AN_ID, true)) {
            return [null, "parameter {{$param}} is not a record id"];
        }

        if (isset(self::PARAM_FIXTURES[$param])) {
            return [self::PARAM_FIXTURES[$param], null];
        }

        $best = null;
        foreach (self::PREFIX_FIXTURES as $candidate => $key) {
            if ($prefix === $candidate || str_starts_with($prefix, $candidate . '/')) {
                if ($best === null || strlen($candidate) > strlen($best)) {
                    $best = $candidate;
                }
            }
        }

        if ($best !== null) {
            $key = self::PREFIX_FIXTURES[$best];

            return $key === null
                ? [null, 'no fixture for this path (deliberately unmapped)']
                : [$key, null];
        }

        return [null, 'no fixture for this path'];
    }

    // ================================================================
    // Reporting
    // ================================================================

    private function printSummary(array $endpoints): void
    {
        $lines = ['', '=== CROSS-COMMUNITY ACCESS SWEEP (control-verified) ==='];
        $lines[] = sprintf('v2 GET endpoints with one path parameter : %d', count($endpoints));

        foreach (['member' => 'PASS 1 — ordinary member, member-facing routes', 'admin' => 'PASS 2 — community admin, /admin/ routes'] as $actor => $label) {
            $tally = ['LEAK' => 0, 'REFUSED' => 0, 'EMPTY_200' => 0, 'INCONCLUSIVE' => 0, 'SKIPPED' => 0];
            $skipReasons = ['not an id' => 0, 'no fixture' => 0, 'tier route' => 0, 'fixture failed' => 0];

            foreach ($this->results as $r) {
                if ($r['actor'] !== $actor) {
                    continue;
                }
                $tally[$r['verdict']]++;
                if ($r['verdict'] === 'SKIPPED') {
                    $reason = match (true) {
                        str_contains($r['note'], 'not a record id') => 'not an id',
                        str_contains($r['note'], 'platform-tier') => 'tier route',
                        str_contains($r['note'], 'could not be created') => 'fixture failed',
                        default => 'no fixture',
                    };
                    $skipReasons[$reason]++;
                }
            }
            $probed = $tally['LEAK'] + $tally['REFUSED'] + $tally['EMPTY_200'] + $tally['INCONCLUSIVE'];

            $lines[] = '';
            $lines[] = $label;
            $lines[] = sprintf('  probed (foreign + control request each)   : %d', $probed);
            $lines[] = sprintf('    refused, control succeeded              : %d', $tally['REFUSED']);
            $lines[] = sprintf('    answered 200 with no records            : %d', $tally['EMPTY_200']);
            $lines[] = sprintf('    RETURNED another community\'s data       : %d', $tally['LEAK']);
            $lines[] = sprintf('    inconclusive                            : %d', $tally['INCONCLUSIVE']);
            $lines[] = sprintf('  skipped                                   : %d  (not an id %d, no fixture %d, tier route %d, fixture failed %d)',
                $tally['SKIPPED'], $skipReasons['not an id'], $skipReasons['no fixture'], $skipReasons['tier route'], $skipReasons['fixture failed']);
        }
        $lines[] = '';

        foreach (['LEAK' => 'RETURNED ANOTHER COMMUNITY\'S DATA (foreign -> control):', 'INCONCLUSIVE' => 'INCONCLUSIVE — these are NOT passes (foreign -> control):'] as $bucket => $heading) {
            $rows = array_filter($this->results, static fn ($r) => $r['verdict'] === $bucket);
            if ($rows === []) {
                continue;
            }
            $lines[] = $heading;
            foreach ($rows as $r) {
                $lines[] = sprintf('  [%s] %s %s  -> %s / %s  %s', $r['actor'], $r['method'], $r['uri'], $r['status'] ?? 'exception', $r['control_status'] ?? '-', $r['note']);
                if ($bucket === 'LEAK') {
                    $lines[] = sprintf('      victim marker in body: %s | %s', $r['victim_marker'] ? 'YES' : 'no', preg_replace('/\s+/', ' ', mb_substr($r['body_excerpt'], 0, 200)));
                }
            }
            $lines[] = '';
        }

        fwrite(STDERR, implode(PHP_EOL, $lines) . PHP_EOL);
    }

    private function writeEvidenceFile(): void
    {
        $dir = dirname(__DIR__, 4) . '/.local-docs-archive/security-evidence';

        if (! is_dir($dir) && ! @mkdir($dir, 0o775, true) && ! is_dir($dir)) {
            return;
        }

        @file_put_contents(
            $dir . '/cross-community-sweep.json',
            json_encode([
                'generated_at' => date('c'),
                'method' => 'Each endpoint requested twice: once with a record from tenant 999 (foreign), once with a same-type record from tenant 2 owned by the actor (control). A refusal counts only when the control succeeded.',
                'actor_tenant' => $this->testTenantId,
                'victim_tenant' => self::VICTIM_TENANT_ID,
                'results' => $this->results,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
        );
    }
}
