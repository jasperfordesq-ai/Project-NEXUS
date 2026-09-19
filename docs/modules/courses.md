# Courses Module Guide

Last reviewed: 2026-07-14

This guide is a reference for maintainers of the **Courses** module in Project NEXUS. The module ships a full LMS (learning-management) stack: a course catalogue, structured section/lesson content, drip scheduling, quizzes, progress tracking, completion certificates, per-course discussions, cohort management, and paid enrolment via time credits. Credit flows are routed through the battle-tested `WalletService` — see [docs/modules/wallet-exchanges.md](wallet-exchanges.md) for the ledger invariants.

## Audience & supported workflows

Use this guide when changing course authoring, the enrolment lifecycle, credit charging, progress tracking, quiz grading, certificate issuance, or admin moderation.

Supported workflows:

- **Course discovery** — authenticated tenant members browse, filter (by category, level, keyword), and view course details.
- **Free enrolment** — a member self-enrols at no cost when `credit_cost = 0`.
- **Paid enrolment** — a member pays the course's `credit_cost` in time credits; the charge is a direct learner→author transfer routed through `WalletService::transfer()`.
- **Lesson progress** — a learner works through lessons in order, with optional drip gating, and the system tracks per-lesson and overall completion percentage.
- **Quiz submission** — objective questions (MCQ, multi-select, true/false) are auto-graded; subjective questions (short answer, essay) enter a `pending_review` queue for instructor grading.
- **Course completion** — finishing all lessons triggers certificate issuance, a gamification XP award, and a completion notification + email to the learner.
- **Certificate download** — a completed learner retrieves a printable HTML certificate with a unique serial for verification.
- **Learner review** — enrolled learners rate a course 1–5 stars; the aggregate is cached on the `courses` row.
- **Instructor authoring** — an authorised user builds a course (sections → lessons → quizzes), publishes it, and manages their roster and analytics.
- **Admin moderation** — an admin reviews pending courses, approves/rejects/flags them, manages instructor grants, and views tenant-level analytics.
- **Cohort delivery** — a course-paced variant where learners are assigned to named cohorts with start/end dates and optional capacity limits.
- **Group-linked courses** — `visibility=group` courses are visible only to members of linked groups.

## Tenant & feature-gate rules

**Feature flag: `courses` (default OFF).** Every Courses module endpoint and every controller method calls `ensureCoursesFeature()` as its first step; requests return `FEATURE_DISABLED` (HTTP 403) when the flag is not set. The flag is resolved via `TenantContext::hasFeature('courses')`.

Tenant scoping is enforced automatically by the `HasTenantScope` trait on the `Course`, `CourseEnrollment`, `CourseCertificate`, and related Eloquent models. Every service call that bypasses these scopes (e.g. `Course::withoutGlobalScopes()` in `CourseEnrollmentService::tenantIdForCourse()`) does so explicitly and immediately re-establishes the correct tenant via `TenantContext::runForTenant()`.

Additional per-tenant settings (stored in `tenants.configuration` as JSON):

| Setting key | Default | Effect |
| --- | --- | --- |
| `courses.moderation_enabled` | `false` | When `true`, new course publishes stay `pending` until an admin approves via the moderation endpoint. |
| `courses.allow_member_authoring` | `true` | When `false`, only users with an explicit instructor grant or admin role may create courses. |

## Key code & data locations

Routes are defined in [`routes/api.php`](../../routes/api.php). All catalogue, detail, authoring, learning, and admin endpoints require authentication; group-linked routes additionally require the `groups` feature. Do not copy the full endpoint table here — read the route file for the live list. Primary entry points:

| Concern | Route prefix | Controller |
| --- | --- | --- |
| Course catalogue & authoring | `/v2/courses` | `App\Http\Controllers\Api\CourseController` |
| Enrolment, progress, certificates, reviews | `/v2/courses/{id}/*`, `/v2/me/courses` | `App\Http\Controllers\Api\CourseEnrollmentController` |
| Section & lesson builder | `/v2/courses/{id}/sections`, `/v2/courses/{id}/lessons` | `App\Http\Controllers\Api\CourseContentController` |
| Quizzes & grading | `/v2/courses/quizzes/*`, `/v2/courses/{id}/grading` | `App\Http\Controllers\Api\CourseQuizController` |
| Cohort management | `/v2/courses/{id}/cohorts` | `App\Http\Controllers\Api\CourseCohortController` |
| Per-lesson discussions | `/v2/courses/{courseId}/lessons/{lessonId}/discussions` | `App\Http\Controllers\Api\CourseDiscussionController` |
| Group links | `/v2/courses/{id}/groups`, `/v2/groups/{id}/courses` | `App\Http\Controllers\Api\CourseGroupController` |
| Admin moderation & analytics | `/v2/admin/courses/*` | `App\Http\Controllers\Api\AdminCourseController` |

The `InteractsWithCourses` trait (`app/Http/Controllers/Api/Concerns/InteractsWithCourses.php`) provides the feature gate check, 404 lookup, authoring authorisation, and audience visibility logic used by all controllers above.

Services:

- `app/Services/CourseService.php` — tenant-scoped course CRUD, browse/search, publish/unpublish lifecycle. Authorship and moderation state are set server-side only and are not mass-assignable.
- `app/Services/CourseEnrollmentService.php` — enrolment creation and idempotency, drop/reactivate, enrolment roster.
- `app/Services/CourseCreditService.php` — time-credit charge for paid enrolment; routes the learner→author transfer through `WalletService::transfer()`.
- `app/Services/CourseLessonService.php` — lesson CRUD and drip availability calculation.
- `app/Services/CourseSectionService.php` — section CRUD.
- `app/Services/CourseProgressService.php` — lesson-completion tracking, progress percentage recomputation, course-completion side effects.
- `app/Services/CourseQuizService.php` — quiz delivery (without answer keys), attempt submission, auto-grading, instructor grading, max-attempts enforcement.
- `app/Services/CourseCertificateService.php` — idempotent certificate issuance with a unique `CRS-*` serial, printable HTML generation.
- `app/Services/CoursePrerequisiteService.php` — prerequisite course resolution and per-learner completion state.
- `app/Services/CourseCohortService.php` — cohort CRUD for cohort-paced delivery.
- `app/Services/CourseNotificationService.php` — enrolment and completion notifications (in-app + email), locale-wrapped per recipient.
- `app/Services/CourseInstructorService.php` — instructor capability grants.
- `app/Services/CourseDiscussionService.php` — per-lesson discussion threads.
- `app/Services/CourseCategoryService.php` — category CRUD for catalogue taxonomy.
- `app/Services/CourseGroupService.php` — group-to-course link management.

Models and tables:

| Model | Table |
| --- | --- |
| `App\Models\Course` | `courses` |
| `App\Models\CourseCategory` | `course_categories` |
| `App\Models\CourseSection` | `course_sections` |
| `App\Models\CourseLesson` | `course_lessons` |
| `App\Models\CourseEnrollment` | `course_enrollments` |
| `App\Models\CourseLessonProgress` | `course_lesson_progress` |
| `App\Models\CourseQuiz` | `course_quizzes` |
| `App\Models\CourseQuestion` | `course_questions` |
| `App\Models\CourseQuizAttempt` | `course_quiz_attempts` |
| `App\Models\CourseCertificate` | `course_certificates` |
| `App\Models\CourseReview` | `course_reviews` |
| `App\Models\CourseDiscussion` | `course_discussions` |
| `App\Models\CourseCohort` | `course_cohorts` |
| `App\Models\CourseInstructor` | `course_instructors` |
| `App\Models\CourseGroupLink` | `course_group_links` |

Migrations: `database/migrations/2026_05_29_000001_create_courses_core_tables.php` through `…000004_create_course_social_tables.php`, plus `2026_06_05_000000_add_course_certificate_unique_index.php`.

## Course content structure

A course has the following hierarchy:

```
Course
  └── CourseSection (ordered by position)
        └── CourseLesson (ordered by position)
              └── CourseQuiz (optional; one per lesson or standalone)
                    └── CourseQuestion (mcq / multi / truefalse / short / essay)
```

A lesson can be one of five content types: `video`, `text`, `pdf`, `embed`, or `quiz`. The `body` field carries rich text; `video_url`, `attachment_url`, and `embed_url` carry media links (validated as http/https URLs). Section assignment is optional — lessons belong to a course with or without an enclosing section, and `CourseContentController` verifies that a supplied `section_id` belongs to the same course before saving it.

## Visibility and authoring rules

### Catalogue visibility

The `visibility` enum has three values:

| Value | Who can see it |
| --- | --- |
| `public` | Any authenticated tenant member |
| `members` | Any authenticated tenant member (currently the same route boundary as `public`) |
| `group` | Members of a group linked to the course via `course_group_links` |

A course is only surfaced in browse results and reachable via `show` when `status = published` AND `moderation_status = approved`. Instructors and admins can see their own draft/pending courses regardless of status through `canManageCourseAsUser()`.

Attempting to view a course outside the caller's audience returns a `RESOURCE_NOT_FOUND` (HTTP 404) to avoid leaking course existence.

### Who can author

By default (`courses.allow_member_authoring = true`) any authenticated member may create a course. A tenant may restrict authoring to explicit instructor grants plus admins by setting that option to `false`. Either way, **editing, publishing, or deleting** a course is restricted to its original author or an admin.

### Publication and moderation

New courses are created as `status=draft, moderation_status=pending`. `CourseService::publish()` sets `status=published`. If `courses.moderation_enabled` is `true` for the tenant, the course stays at `moderation_status=pending` until an admin calls the moderation endpoint. If moderation is disabled, the first publish auto-approves the course and stamps `published_at`.

On first approval, `CourseService::publish()` posts a feed activity for the author (guarded so a feed failure never blocks publishing).

### Instructor grants

When `courses.allow_member_authoring = false`, a member must be granted the instructor capability by an admin via `POST /v2/admin/courses/instructors`. Grants are idempotent (one row per tenant+user in `course_instructors`). Revocation deletes the row. Admin users bypass the grant check regardless of this setting.

## Enrolment lifecycle

```
Not enrolled
     │
     ▼  POST /v2/courses/{id}/enroll
  active  ─── (all lessons completed) ──▶  completed
     │
     ▼  DELETE /v2/courses/{id}/enroll
  dropped ─── (re-enrol) ──▶ active  (no second charge)
```

**Idempotency:** `CourseEnrollmentService::enroll()` returns the existing enrollment row when a learner re-enrols while already `active` or `completed`. The unique index `(tenant_id, course_id, user_id)` on `course_enrollments` enforces one row per learner+course at the database layer.

**Prerequisites:** before enrolment proceeds, `CoursePrerequisiteService::unmetIds()` checks that the learner has a `completed` enrollment and satisfies every quiz requirement in each course listed in the `courses.prerequisites` JSON array. Historical completed enrolments with missing, failed or unreviewed quizzes do not unlock dependent courses. Unmet prerequisites return `PREREQUISITES_NOT_MET` (HTTP 422).

**Cohort assignment:** an optional `cohort_id` may be supplied at enrolment. The service validates that it belongs to the same course before accepting it, preventing roster pollution from an arbitrary or cross-course cohort id.

## Paid enrolment & credit flow

When `credit_cost > 0`, calling `POST /v2/courses/{id}/enroll` triggers `CourseEnrollmentService::enrollWithPayment()`:

1. The course row is re-read inside a `DB::transaction` with `lockForUpdate()` so `credit_cost` and `author_user_id` are the freshest values, not a stale cached instance.
2. `CourseCreditService::chargeEnrollment()` calls `WalletService::transfer()` to move `credit_cost` credits from the learner to the course author.
3. If the charge succeeds, `enrollment.credits_paid` is updated and the enrollment is saved.
4. If the charge fails (insufficient credits, inactive author, etc.) a `RuntimeException` is thrown, the transaction rolls back (no enrollment row is created), and the controller returns `INSUFFICIENT_CREDITS` (HTTP 422).

Special cases:

- **Zero cost:** `credit_cost = 0` is treated as free — no transfer is made.
- **Author self-enrolment:** a user enrolling in their own course is never charged regardless of `credit_cost`.
- **Re-enrolment after dropping:** a dropped learner has already paid once. `enrollWithPayment()` detects the `dropped` row and calls the free `enroll()` path, preserving the "charge exactly once" contract.
- **Double-submit:** the controller's outer `isEnrolled` check handles ordinary retries. The decisive concurrent check is repeated inside the transaction after the course row is locked; the unique `(tenant_id, course_id, user_id)` index is the final backstop.

The transfer uses `WalletService`'s row-locked, atomic path. See [docs/modules/wallet-exchanges.md](wallet-exchanges.md) for the full ledger invariants.

## Lesson progress and drip scheduling

`CourseProgressService::completeLesson()` calls `CourseLessonProgress::updateOrCreate()` (idempotent), then recomputes `enrollment.progress_percent` as `(completed_lessons / total_lessons) * 100`. When the ratio reaches 100%, the enrollment transitions to `completed` and `onCourseCompleted()` fires.

**Drip scheduling** (`drip_type` on `course_lessons`):

| Value | Behaviour |
| --- | --- |
| `none` | Lesson available immediately (default). |
| `days_after_enroll` | Unlocks `drip_offset_days` days after the learner's `enrolled_at`. |
| `fixed_date` | Unlocks on `drip_date` regardless of when the learner enrolled. |

`CourseLessonService::availability()` computes the `{available: bool, unlock_at: ?ISO8601}` response. A locked lesson returns `LESSON_LOCKED` (HTTP 403) if the learner tries to mark it complete.

Quiz lessons require a passing attempt belonging to the learner, with grading status `auto` or `graded`, before they can be marked complete. Missing quizzes, failed attempts and pending instructor reviews do not satisfy this requirement. Progress recomputation excludes unsatisfied quiz lessons, and certificate access rechecks every quiz requirement, including for older completion records.

## Quizzes

**Question types:**

| Type | Auto-graded? |
| --- | --- |
| `mcq` (single-answer) | Yes |
| `multi` (multi-select) | Yes |
| `truefalse` | Yes |
| `short` | No — enters `pending_review` queue |
| `essay` | No — enters `pending_review` queue |

`CourseQuizService::forLearner()` strips `correct` and `explanation` fields before delivering questions to the learner, so answer keys are never exposed client-side. `CourseQuestion.$hidden` enforces this at the model layer as well.

**Attempt limits:** `course_quizzes.max_attempts` (0 = unlimited). The service locks the enrollment row inside a `DB::transaction` before checking and recording the attempt count, preventing a race between two concurrent submission requests from the same learner. Exceeding the limit throws `MaxAttemptsExceededException`.

**Retry recovery:** submitting a quiz accepts an optional `Idempotency-Key` header or `idempotency_key` body field (8–191 bytes after trimming; both must match when supplied). An exact retry returns the saved attempt and its current grading result without consuming another attempt, even at the limit. Reusing a key with different answers returns `IDEMPOTENCY_CONFLICT` (409); malformed keys return `IDEMPOTENCY_INVALID` (422). Every request still checks enrolment and lesson availability. A deliberate new attempt must use a new key. Keyed submissions also lock the quiz row, including service calls without an enrolment row.

Learner quiz reads include the caller's `latest_attempt` grade summary and `attempts_remaining` (`null` for unlimited attempts). Submission responses also include the remaining count. These fields support grade refresh and exhausted-attempt controls without resubmitting answers.

Apply `2026_09_19_120000_add_quiz_attempt_replay_identity` before enabling keyed clients. It adds nullable identity hashes and a unique learner/quiz/tenant/key index. Rolling it back preserves attempt rows but removes retry identities: clients with unresolved submissions must not keep retrying across such a downgrade, because replay protection would be lost.

**Auto-grading:** for objective questions, `isCorrect()` compares sorted arrays of answer ids (handling both MCQ and multi-select), awards the question's `points` value, and computes `score_percent`. A quiz is `passed = true` when `score_percent >= pass_mark_percent` AND no subjective questions are present (a quiz with any `short`/`essay` question gets `grading_status = pending_review` and `passed = false` until manually graded).

**Instructor grading queue:** `GET /v2/courses/{courseId}/grading` returns attempts at `grading_status = pending_review`, including question prompts and the learner's answers but never the answer key. `POST /v2/courses/attempts/{attemptId}/grade` applies an instructor score and sets `grading_status = graded`.

## Course completion side effects

When the last lesson is marked complete, `CourseProgressService::onCourseCompleted()` fires the following — each step is individually `try/catch`-guarded so a failure in one never blocks the learner's progression record:

1. Increments `courses.completion_count`.
2. Issues (or returns the existing) completion certificate via `CourseCertificateService::issue()`.
3. Sends a completion notification + email to the learner in their `preferred_language` via `CourseNotificationService::completed()`.
4. Awards 50 XP and the `course_graduate` badge via `GamificationService`.

## Certificates

Certificates are issued by `CourseCertificateService::issue()`, which is idempotent (one certificate per `(tenant_id, course_id, user_id)` enforced by a unique index). The serial format is `CRS-` followed by 12 random upper-case alphanumeric characters.

`GET /v2/courses/{id}/certificate` returns both the `certificate` record (serial, `issued_at`) and a self-contained `html` string — an inline-styled HTML document suitable for browser printing to PDF. All human-readable strings in the HTML are rendered via `__('emails_misc.course_certificate.*')` keys, so they honour the active locale.

## Learner reviews

Enrolled and completed learners may leave one review per course (`POST /v2/courses/{id}/reviews`). Dropped learners cannot review. Each submission uses `updateOrCreate` so a learner can update their review. After each upsert, `CourseEnrollmentController::recomputeCourseRating()` recalculates `rating_avg` and `rating_count` on the `courses` row from all `status=approved` reviews.

## Per-lesson discussions

`course_discussions` carries threaded posts (via `parent_id`) attached to a lesson within a course. Admins may hide individual posts via `POST /v2/admin/courses/discussions/{id}/hide`. Authors can delete their own posts; admins can delete any.

## Admin surfaces

| Endpoint | What it does |
| --- | --- |
| `GET /v2/admin/courses` | List all courses (filterable by `moderation_status`). |
| `POST /v2/admin/courses/{id}/moderate` | Approve / reject / flag a course. Rejecting forces `status=draft`. |
| `GET /v2/admin/courses/analytics` | Tenant-level totals (published courses, pending, enrollments, completions, instructors). |
| `GET /v2/admin/courses/instructors` | List all instructor grants. |
| `POST /v2/admin/courses/instructors` | Grant instructor capability to a user. |
| `DELETE /v2/admin/courses/instructors/{userId}` | Revoke instructor capability. |
| `POST /v2/admin/courses/categories` | Create a category. |
| `PUT /v2/admin/courses/categories/{id}` | Update a category. |
| `DELETE /v2/admin/courses/categories/{id}` | Delete a category. |
| `POST /v2/admin/courses/discussions/{id}/hide` | Moderate a discussion post. |

Per-course analytics (`GET /v2/courses/{id}/analytics`, owner or admin only) includes enrollment counts by status, completion rate, average progress, average quiz score, and a per-lesson drop-off curve.

## Security & privacy invariants

- The `courses` feature must be enabled before any Courses endpoint runs — checked via `ensureCoursesFeature()`.
- `author_user_id`, `status`, `moderation_status`, and `published_at` are **not mass-assignable** on the `Course` model. They are set explicitly by the service layer to prevent authorship spoofing, self-publishing, or moderation bypass.
- Course visibility is enforced before returning any course data; private, draft, rejected, or group-only courses return 404 to callers outside the intended audience.
- Quiz answer keys (`correct`, `explanation`) are not present in `forLearner()` output. `CourseQuestion.$hidden` is a second layer of protection.
- The paid enrolment transaction (charge + row creation) runs inside a single `DB::transaction` with the course row locked, so no enrollment is created unless the credit movement commits.
- Every `UPDATE`/`DELETE` on `course_enrollments`, `course_lesson_progress`, and `course_quiz_attempts` must reference the correct `enrollment_id` or `user_id` — avoid bypassing tenant scope on these tables.
- Discussion moderation (hide) requires admin access; delete requires either authorship or admin access.

## Failure modes & recovery

| Failure | How it is handled |
| --- | --- |
| **Feature disabled** | All endpoints return HTTP 403 `FEATURE_DISABLED`. |
| **Insufficient credits** (paid enrolment) | `WalletService::transfer()` throws inside the DB transaction; the transaction rolls back; no enrollment row is created; controller returns HTTP 422 `INSUFFICIENT_CREDITS`. |
| **Author self-enrolment** | `CourseCreditService` skips the charge and returns `charged=false`; enrolment proceeds free. |
| **Dropped learner re-enrolls** | Detected before the charge; the existing `dropped` row is reactivated without a second credit transfer. |
| **Concurrent double-enrolment** | Unique index `(tenant_id, course_id, user_id)` on `course_enrollments` rejects the duplicate; `enrollWithPayment()` returns the existing row. |
| **Quiz max-attempts exceeded** | The attempt count is checked inside a row-locked transaction to prevent races; throws `MaxAttemptsExceededException`. |
| **Concurrent quiz submission** | The enrollment row is locked inside the `DB::transaction` for the attempt; only one write wins. |
| **Certificate issuance race** | Idempotency: the unique index rejects the duplicate and `issue()` fetches and returns the winning row. |
| **Feed post failure on publish** | Wrapped in `try/catch`; logs a warning; publish is not blocked. |
| **Notification / email failure** | Wrapped in `try/catch` throughout; logged; never blocks enrolment, completion, or publish. |
| **Gamification failure on completion** | Guarded individually; a GamificationService outage does not prevent the enrollment from reaching `completed`. |
| **Lesson drip gate** | A learner trying to complete a locked lesson receives HTTP 403 `LESSON_LOCKED`. The unlock time is included in the `progress` response (`availability[].unlock_at`). |
| **Section id from another course** | `CourseLessonService` validates the `section_id` belongs to the same course and silently sets it to `null` if not. |
| **Moderation pending** | A published course stays invisible in the authenticated member catalogue (not returned by `browse`) until `moderation_status = approved`. The instructor can still view it via `GET /v2/courses/mine`. |

## Test commands & key regression tests

Run the relevant suites (run one suite at a time):

```bash
vendor/bin/phpunit tests/Laravel/Feature/Courses/ --colors=always
vendor/bin/phpunit tests/Laravel/Feature/Controllers/CourseControllerTest.php --colors=always
vendor/bin/phpunit tests/Laravel/Unit/Services/CourseLessonServiceTest.php --colors=always
vendor/bin/phpunit tests/Laravel/Feature/GovukAlpha/CoursesFiltersQuizParityTest.php --colors=always
```

Key regression tests:

| Test | What it locks down |
| --- | --- |
| `tests/Laravel/Feature/Courses/CourseCreditTest.php` | Paid enrolment transfers credits learner→author; insufficient balance is blocked; free course is not charged; enrolling twice does not double-charge; `credits_paid` is recorded on the enrollment. |
| `tests/Laravel/Feature/Courses/CourseProgressAndQuizTest.php` | Enrolment idempotency; drop/reactivate; completing all lessons transitions status to `completed`; MCQ auto-grading (correct answer = pass); max-attempts enforcement (race-safe); section-id cross-course injection rejected; moderation flag respected; tenant isolation (course invisible under another tenant). |
| `tests/Laravel/Unit/Services/CourseLessonServiceTest.php` | Drip availability calculation for `none`, `days_after_enroll`, and `fixed_date` types; media URL validation. |
| `tests/Laravel/Feature/GovukAlpha/CoursesFiltersQuizParityTest.php` | Accessible-frontend parity for catalogue filters and quiz flow. |
| `tests/Laravel/Feature/GovukAlpha/CoursesPrereqCertParityTest.php` | Accessible-frontend parity for prerequisites and certificate. |
| `tests/Laravel/Feature/GovukAlpha/CoursesReviewsParityTest.php` | Accessible-frontend parity for reviews. |
| `tests/Laravel/Feature/Controllers/CourseControllerTest.php` | HTTP-level feature gate, authoring auth, and CRUD responses. |

## Related references

- [docs/modules/wallet-exchanges.md](wallet-exchanges.md) — ledger invariants, idempotency guard, and money column precision; the paid enrolment path flows through `WalletService::transfer()`.
- [docs/MODULES.md](../MODULES.md) — full module map and writing checklist.
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md) — runtime boundaries.
- [`routes/api.php`](../../routes/api.php) — authoritative endpoint list (do not duplicate here).
