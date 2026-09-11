<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Shared machinery for the route-table access sweeps.
 *
 * Extracted on 2026-09-11 from CrossCommunityAccessSweepTest so that the
 * same-community sweep (SameCommunityAccessSweepTest) can reuse the SAME fixture
 * maps, seeding, id-type resolution and request helpers. Every member here was
 * moved verbatim; only `private` became `protected`. Behaviour of the
 * cross-community sweep is unchanged and was re-run against the same tree
 * before and after the move to prove it (identical per-pass counts).
 *
 * Why a base class and not a copy: the fixture maps ARE the population each
 * sweep measures. Two copies would drift, and then two sweeps would quietly
 * measure two different platforms.
 *
 * State (victim ids, control ids, results) deliberately stays in the concrete
 * sweeps — each defines its own actors and its own verdicts.
 */
abstract class AccessSweepTestCase extends TestCase
{
    /** The community our actors belong to is $this->testTenantId (2). */
    protected const VICTIM_TENANT_ID = 999;

    /** Status codes that prove the endpoint refused a foreign record. */
    protected const REFUSED = [401, 403, 404, 410];

    /** Parameter names that are not record identifiers. */
    protected const NOT_AN_ID = [
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
    protected const PARAM_FIXTURES = [
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
    protected const PREFIX_FIXTURES = [
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
    protected const FIXTURES = [
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
    protected const CHILD_FIXTURES_BY_PREFIX = [
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
    protected const KNOWN_CHILD_ACCEPTED_NO_CHANGE = [
    ];

    /**
     * Endpoints that answer 2xx for a foreign identifier once the body satisfies
     * validation, while provably changing nothing. Shrink-only.
     *
     * Ten of these are the same idempotent no-ops already pinned in
     * KNOWN_ACCEPTED_NO_CHANGE. **Five are visible only here**, because an empty
     * body never got past validation to reach them — which is the whole reason
     * this pass exists:
     *
     *   DELETE courses/{id}/enroll                  answers `dropped: false`
     *   POST   events/{id}/attendance/bulk          reports 1 processed, 0 successful, 1 failed
     *   DELETE members/{id}/endorse                 answers "Endorsement removed"
     *   POST   stories/{id}/analytics               answers `tracked: true`
     *   DELETE admin/courses/instructors/{userId}   answers `revoked: true`
     *
     * Each was read before being pinned. `StoryService::trackAnalytics()` is the
     * one worth naming: it answers `tracked: true` but looks the story up with
     * `WHERE id = ? AND tenant_id = ?` and returns before inserting, so **no
     * analytics row is created for another community's story**. That check
     * mattered — the single genuine cross-community side effect found in this
     * whole assessment was an endpoint of exactly this shape that did create a
     * row (`POST jobs/{id}/referral`).
     *
     * All fifteen are open Low findings, listed in the assessment. They should
     * answer not-found; none of them moves any data.
     */
    protected const KNOWN_VALID_BODY_ACCEPTED = [
        // Empty since the fifteen accepted-no-op endpoints were fixed to refuse
        // a foreign identifier with 404. Shrink-only: a new entry needs a note.
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
    protected const KNOWN_SOFT_200 = [
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
    protected const KNOWN_ACCEPTED_NO_CHANGE = [
        // Empty since the ten accepted-no-op endpoints were fixed to refuse a
        // foreign identifier with 404. Shrink-only: a new entry needs a note.
    ];

    /**
     * Parameter names that identify a PERSON rather than a record. These are
     * the second identifier in the multi-parameter sweep below, and the one
     * deliberately taken from another community.
     */
    protected const PERSON_PARAMS = [
        'userId', 'childId', 'friendId', 'caredForId',
        'attendeeId', 'guestId', 'delivererId', 'partnerId',
    ];

    /**
     * Columns that reference a person. Every occurrence of these in the live
     * schema is counted before and after each foreign-person request, which is
     * how a CREATED join row (a membership, an allocation, a participation)
     * becomes visible — the single-parameter write sweep cannot see those.
     */
    protected const PERSON_COLUMNS = [
        'user_id', 'member_id', 'participant_id', 'attendee_id',
        'guest_id', 'deliverer_id', 'recipient_id', 'child_id',
    ];

    /**
     * Endpoints that answer 2xx for a person from another community while
     * provably moving nothing. Shrink-only in both directions. Populated from
     * the first run; every entry needs a reason.
     */
    protected const KNOWN_PERSON_ACCEPTED_NO_CHANGE = [
    ];

    /**
     * The field a validation response objected to, and its message.
     *
     * Handles this platform's shape (`errors: [{field, message}]`) and Laravel's
     * own (`errors: {field: [messages]}`).
     *
     * @return array{0:?string,1:string}
     */
    protected function firstFailingField(string $body): array
    {
        $decoded = json_decode($body, true);
        if (! is_array($decoded) || ! isset($decoded['errors'])) {
            return [null, ''];
        }

        $errors = $decoded['errors'];

        if (is_array($errors) && array_is_list($errors)) {
            foreach ($errors as $error) {
                if (is_array($error) && ! empty($error['field'])) {
                    return [(string) $error['field'], (string) ($error['message'] ?? '')];
                }
            }

            return [null, ''];
        }

        if (is_array($errors)) {
            foreach ($errors as $field => $messages) {
                if (! is_string($field) || $field === '') {
                    continue;
                }
                $message = is_array($messages) ? (string) reset($messages) : (string) $messages;

                return [$field, $message];
            }
        }

        return [null, ''];
    }

    /**
     * A plausible value for a field the API asked for.
     *
     * Enumerations are read out of the message wherever the API lists them
     * ("Valid types: love, like, …"), because a guessed enum value is rejected
     * and wastes the round.
     */
    protected function synthesiseValue(string $field, string $message): mixed
    {
        if (preg_match('/(?:valid(?:\s+\w+)?|allowed|must be one of|one of)\s*:?\s*([a-z0-9_]+(?:\s*,\s*[a-z0-9_]+)+)/i', $message, $m)) {
            $options = array_map('trim', explode(',', $m[1]));
            if ($options !== []) {
                return $options[0];
            }
        }

        $lower = mb_strtolower($field);

        return match (true) {
            str_contains($lower, 'idempotency') || str_contains($lower, 'token') => 'sweep-' . Str::lower(Str::random(16)),
            str_ends_with($lower, '_ids') || $lower === 'ids' || str_ends_with($lower, 'emails') => [1],
            str_ends_with($lower, '_id') || $lower === 'id' => 1,
            str_contains($lower, 'version') || str_contains($lower, 'increment') || str_contains($lower, 'index') => 1,
            str_contains($lower, 'email') => 'sweep@example.invalid',
            str_contains($lower, 'language') || str_contains($lower, 'locale') => 'en',
            str_contains($lower, 'emoji') => '👍',
            str_starts_with($lower, 'is_') || str_starts_with($lower, 'has_') || str_contains($lower, 'enabled') => true,
            str_contains($lower, '_at') || str_contains($lower, 'date') || str_contains($lower, 'scheduled') => now()->addDay()->toDateTimeString(),
            str_contains($lower, 'amount') || str_contains($lower, 'hours') || str_contains($lower, 'credits') || str_contains($lower, 'quantity') => 1,
            in_array($lower, ['patch', 'permissions', 'tiers', 'rankings', 'slots', 'campaign', 'form', 'invitation', 'retention', 'submission', 'review', 'access_evidence'], true) => [],
            default => 'Sweep ' . $field,
        };
    }

    /**
     * Do the rows behind these fixture keys still exist?
     *
     * @param  list<string>  $keys
     * @param  array<string,int>  $ids
     */
    protected function recordsStillExist(array $keys, array $ids): bool
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
    protected function enableTenantFeatures(array $features, int ...$tenantIds): void
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

    /** Database table behind a fixture key, for before/after snapshots. */
    protected function fixtureTable(?string $key): ?string
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
    protected function probeableWriteEndpoints(): array
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

    /** @return array{status:?int,body:string,error:string} */
    protected function request(string $routeUri, int $id): array
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

    /**
     * Did a 200 response actually carry records, or was it an empty envelope?
     *
     * Treated as "no data" when the payload decodes to null/empty, or its
     * meaningful container (`data`, `items`, `results`, …) is empty, or every
     * scalar it reports is a zero/false/null default. Anything else counts as
     * data and is escalated for manual reading — the body excerpt is stored so
     * a human can confirm the call.
     */
    protected function responseCarriesData(string $body): bool
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
    protected function allValuesAreDefaults(array $payload): bool
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

    protected function actAs(array $attributes): User
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
    protected function seedRecords(int $tenantId, User $owner): array
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
    protected function insertRow(array $spec, int $tenantId, User $owner, array $seeded = []): int
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
    protected function ownerAttributesFor(string $modelClass, User $owner): array
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

    /**
     * Every v2 GET endpoint with exactly one path parameter, with its id type
     * resolved (or the reason it is skipped).
     *
     * @return array<int,array{method:string,uri:string,prefix:string,param:string,fixture:?string,skip:?string,action:string}>
     */
    protected function probeableEndpoints(): array
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
    protected function resolve(string $prefix, string $param): array
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
}
