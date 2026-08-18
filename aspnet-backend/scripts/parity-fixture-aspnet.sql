-- Copyright (c) 2024-2026 Jasper Ford
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Author: Jasper Ford
-- See NOTICE file for attribution and acknowledgements.
--
-- Contract-parity fixture rows for the ASP.NET DEV database (nexus_dev).
--
-- 🔴 WHY THIS EXISTS — it is the MIRROR of scripts/parity-fixture.sql.
-- That file seeds the disposable Laravel because Laravel was the empty side on 35
-- of 39 untestable endpoints. Seeding it took untestable 39 -> 17. What remained
-- is the same problem pointing the other way: 9 endpoints report
-- MATCH_BUT_LIST_EMPTY because the ASP.NET demo seed has NO ROWS for those
-- entities, so the row contract inside a correct envelope is still never compared.
--
-- Measured 2026-08-18 (probe of all 24 untestable endpoints, per side):
--   ASP.NET empty  : coupons, gamification/engagement-history, group-templates,
--                    groups/form-capabilities, jobs, jobs/my-applications,
--                    me/verein-dues, volunteering/donations, volunteering/training
--   Laravel empty  : exchanges/needs-attention-count, listings/tags/autocomplete,
--                    skills/search, tenants, upload/list, wallet/categories
--   rows both sides: the remaining 8 differ only in nullable fields
--
-- 🔴 Adding rows makes MORE surface comparable, so the identical count may FALL.
-- That is the measurement getting honest, not a regression.
--
-- 🔴 /api/v2/group-templates is NOT fixable here. MiscParityController.cs:1197 is
-- a hardcoded `Ok(new { data = Array.Empty<object>() })` — one of the 319 no-op
-- stubs. It needs implementing against the group_templates rows seeded below;
-- seeding alone cannot move it.
--
-- 🔴 WHY SQL AND NOT DemoShowcaseSeedData.cs. The approved plan named the C# seed.
-- SQL was chosen instead, deliberately: the C# seed only runs at startup behind the
-- DemoShowcaseSeed:Run flag, so every iteration costs an image rebuild and a
-- container restart, and this fixture is iterated across WP1/WP2. SQL also makes
-- the two sides symmetrical — one fixture file per backend, same shape, same
-- re-runnable contract. It touches only the disposable dev database, never
-- production seed code paths.
--
-- 🔴 EVERY FILTER BELOW WAS READ OFF THE ASP.NET CONTROLLER, not guessed. A row
-- that fails the real WHERE clause is invisible and seeds nothing, which is
-- indistinguishable from not having run. The filter each row satisfies is named
-- above it.
--
-- Ids are fixed at 950000+ and cleared first, so this is re-runnable. Inserts
-- deliberately do NOT use ON CONFLICT DO NOTHING — a swallowed error would seed
-- nothing quietly and the next measurement would be noise.
--
-- Apply with:
--   docker exec -i nexus-aspnet-dev-db psql -U postgres -d nexus_dev \
--     < aspnet-backend/scripts/parity-fixture-aspnet.sql

\set ON_ERROR_STOP on

BEGIN;

-- Fixture identities, from the ASP.NET Development seed:
--   tenant 1 = 'acme', user 3 = member@acme.test (the account the harness signs in as)

-- ---------------------------------------------------------------------------
-- Clear previous fixture rows (children before parents).
-- ---------------------------------------------------------------------------
DELETE FROM volunteer_training_completions WHERE "Id" >= 950000;
DELETE FROM volunteer_training_courses     WHERE "Id" >= 950000;
DELETE FROM job_applications               WHERE "Id" >= 950000;
DELETE FROM job_vacancies                  WHERE "Id" >= 950000;
DELETE FROM verein_member_dues             WHERE id   >= 950000;
DELETE FROM money_donations                WHERE "Id" >= 950000;
DELETE FROM merchant_coupons               WHERE "Id" >= 950000;
DELETE FROM monthly_engagement             WHERE id   >= 950000;
DELETE FROM group_templates                WHERE "Id" >= 950000;
DELETE FROM group_types                    WHERE "Id" >= 950000;
DELETE FROM vol_organizations              WHERE id   >= 950000;

-- ---------------------------------------------------------------------------
-- /api/v2/coupons — V15SocialCompatibilityController.Coupons filters
--   IsActive = true AND (ExpiresAt IS NULL OR ExpiresAt > now)
-- An inactive or expired coupon is invisible and seeds nothing.
-- ---------------------------------------------------------------------------
INSERT INTO merchant_coupons
  ("Id","TenantId","SellerUserId","Code","Description","DiscountAmount","DiscountType","IsActive","ExpiresAt","CreatedAt")
VALUES
  (950001, 1, 3, 'REPAIR10', 'Ten per cent off parts at the repair cafe.',
   10.00, 'percent', true, NOW() + INTERVAL '60 days', NOW());

-- ---------------------------------------------------------------------------
-- /api/v2/gamification/engagement-history — MonthlyEngagements
--   WHERE tenant_id AND user_id ORDER BY year_month DESC LIMIT 12
-- ---------------------------------------------------------------------------
INSERT INTO monthly_engagement (id, tenant_id, user_id, year_month, was_active, activity_count, recognized_at)
VALUES
  (950010, 1, 3, to_char(NOW(),'YYYY-MM'), true, 12, NOW()),
  (950011, 1, 3, to_char(NOW() - INTERVAL '1 month','YYYY-MM'), true, 7, NOW());

-- ---------------------------------------------------------------------------
-- /api/v2/groups/form-capabilities — GroupFormService reads
--   GroupTypes.Where(TenantId AND IsActive) and GroupTemplates.Where(TenantId AND IsActive)
-- Both lists were empty, so the templates[] and group_types[] row contracts were
-- never compared even though the envelope matched.
-- ---------------------------------------------------------------------------
INSERT INTO group_types
  ("Id","TenantId","Name","Slug","Description","Icon","Color","SortOrder","IsActive","IsHub","CreatedAt","UpdatedAt")
VALUES
  (950020, 1, 'Neighbourhood', 'neighbourhood', 'Groups organised around a place.',
   'fa-map-pin', '#2563eb', 1, true, false, NOW(), NOW());

INSERT INTO group_templates
  ("Id","TenantId","Name","Description","Icon","DefaultVisibility","DefaultTypeId",
   "DefaultTagsJson","FeaturesJson","WelcomeMessage","IsActive","SortOrder","CreatedAt","UpdatedAt")
VALUES
  (950021, 1, 'Neighbourhood group', 'A public group for a street or estate.', 'fa-users',
   'public', 950020, '[]'::jsonb, '{}'::jsonb, 'Welcome to the group.', true, 1, NOW(), NOW());

-- ---------------------------------------------------------------------------
-- /api/v2/jobs — JobService.ListJobsAsync defaults to Status = 'active'
-- /api/v2/jobs/my-applications — GetMyApplicationsAsync filters ApplicantUserId
--   and Includes the Job, so the vacancy row is required for the join to populate.
-- ---------------------------------------------------------------------------
INSERT INTO job_vacancies
  ("Id","TenantId","PostedByUserId","Title","Description","Category","JobType","Location",
   "IsRemote","Status","IsFeatured","ViewCount","ApplicationCount","CreatedAt")
VALUES
  (950030, 1, 1, 'Repair cafe coordinator',
   'Coordinate volunteers and tools for the Saturday repair cafe.',
   'Community', 'volunteer', 'Riverside Hall', false, 'active', false, 0, 1, NOW());

INSERT INTO job_applications
  ("Id","TenantId","JobId","ApplicantUserId","Status","CoverLetter","CreatedAt")
VALUES
  (950031, 1, 950030, 3, 'applied',
   'I have run the tool library for two years and would like to help.', NOW());

-- ---------------------------------------------------------------------------
-- /api/v2/me/verein-dues — MemberParityController.VereinDues filters tenant+user.
-- The dues row FKs to vol_organizations on (tenant_id, organization_id), and that
-- table was empty, so the organisation is the parent that has to exist first.
-- ---------------------------------------------------------------------------
INSERT INTO vol_organizations (id, tenant_id, user_id, name, slug, status, auto_pay_enabled, balance, created_at)
VALUES
  (950040, 1, 1, 'Riverside Community Trust', 'riverside-community-trust', 'approved', false, 0.0, NOW());

INSERT INTO verein_member_dues
  (id, organization_id, tenant_id, user_id, membership_year, amount_cents, currency, status, due_date, paid_at)
VALUES
  (950041, 950040, 1, 3, EXTRACT(YEAR FROM NOW())::int, 4500, 'EUR', 'paid',
   (NOW() + INTERVAL '30 days')::date, NOW());

-- ---------------------------------------------------------------------------
-- /api/v2/volunteering/donations — VolunteerDonationsController.Mine reads
--   MoneyDonation WHERE DonorUserId = me   (NOT a vol_donations table)
-- ---------------------------------------------------------------------------
INSERT INTO money_donations
  ("Id","TenantId","DonorUserId","DonorDisplayName","AmountMinorUnits","Currency",
   "Message","Status","IsAnonymous","PaymentMethod","CompletedAt","CreatedAt")
VALUES
  (950050, 1, 3, 'Demo Member', 2500, 'EUR',
   -- 🔴 `Status` maps to the MoneyDonationStatus ENUM (Phase72Entities.cs:29), whose
   -- values are Pending/Succeeded/Failed/Refunded/Cancelled. Writing 'completed'
   -- here made the endpoint 500 with "Cannot convert string value 'completed' ...
   -- to any value in the mapped enum" — a fixture row that violates a real
   -- constraint is WORSE than no row, because it turns an untested endpoint into a
   -- broken one.
   'Keep the repair cafe running.', 'Succeeded', false, 'card', NOW(), NOW());

-- ---------------------------------------------------------------------------
-- /api/v2/volunteering/training — VolunteeringParityController.Training reads
--   VolunteerTrainingCourses.Where(TenantId AND Active)  <- note the flag is `Active`
--   VolunteerTrainingCompletions.Where(TenantId AND UserId)
-- A course with Active = false is invisible.
-- ---------------------------------------------------------------------------
INSERT INTO volunteer_training_courses
  ("Id","TenantId","Title","Description","DurationMinutes","IsRequired","Active","CreatedAt")
VALUES
  (950060, 1, 'Children First introductory training',
   'Safeguarding basics for anyone volunteering with young people.', 90, true, true, NOW());

INSERT INTO volunteer_training_completions
  ("Id","TenantId","UserId","CourseId","CompletedAt","Score")
VALUES
  (950061, 1, 3, 950060, NOW() - INTERVAL '60 days', 92);

COMMIT;
