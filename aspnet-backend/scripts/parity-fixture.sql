-- Copyright (c) 2024-2026 Jasper Ford
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Author: Jasper Ford
-- See NOTICE file for attribution and acknowledgements.
--
-- Contract-parity fixture rows for the DISPOSABLE Laravel (:8091).
--
-- 🔴 WHY THIS EXISTS. The response harness reported 39 endpoints as
-- MATCH_BUT_LIST_EMPTY: the envelope agreed, but the Laravel side had no rows,
-- so the contract of the ROWS INSIDE was never compared. `E2ETestDataSeeder`
-- leaves the fixture at 4 users, 1 listing, 8 categories and nothing else —
-- no event, no group, no post, no transaction. Measured on 2026-08-17, Laravel
-- was the empty side in 35 of those 39.
--
-- Adding rows makes MORE surface comparable, so the identical count is EXPECTED
-- TO FALL when this lands. A fall here is the measurement getting honest, not
-- the backend getting worse.
--
-- 🔴 WHY IT IS SQL AND NOT A LARAVEL SEEDER. Laravel is read-only reference
-- material from the ASP.NET workstream (aspnet-backend/CLAUDE.md), so this must
-- not add a class to `database/seeders/`. It runs against the throwaway
-- container's database, which holds the committed schema plus synthetic
-- fixtures and no real member data.
--
-- 🔴 EVERY FILTER HERE WAS READ OFF THE RUNNING LARAVEL, not guessed. The
-- MariaDB general query log was captured per endpoint (command_type='Execute' —
-- Laravel uses prepared statements, so filtering on 'Query' shows nothing at
-- all). A row that does not satisfy the real WHERE clause is invisible and
-- seeds nothing, which is indistinguishable from not having run. The filter each
-- row exists to satisfy is named in a comment above it.
--
-- IDs are fixed in the 950000+ range so this is re-runnable: every table is
-- cleared of its own 950000+ rows first. Inserts are deliberately NOT
-- `INSERT IGNORE` — a swallowed error would seed nothing quietly and the next
-- measurement would be noise.

SET @T := 1;         -- fixture tenant
SET @UA := 900014;   -- e2e.user.a@project-nexus.local — the account the harness signs in as
SET @UB := 900015;   -- e2e.user.b@project-nexus.local

-- ---------------------------------------------------------------------------
-- Clear previous fixture rows (children before parents).
-- ---------------------------------------------------------------------------
DELETE FROM challenge_tag_links WHERE challenge_id >= 950000 OR tag_id >= 950000;
DELETE FROM poll_votes WHERE poll_id >= 950000;
DELETE FROM poll_options WHERE id >= 950000;
DELETE FROM event_rsvps WHERE id >= 950000;
DELETE FROM group_members WHERE id >= 950000;
DELETE FROM job_vacancy_applications WHERE id >= 950000;
DELETE FROM feed_activity WHERE id >= 950000;
DELETE FROM user_badges WHERE id >= 950000;
DELETE FROM verein_member_dues WHERE id >= 950000;
DELETE FROM vol_donations WHERE id >= 950000;
DELETE FROM vol_opportunities WHERE id >= 950000;
DELETE FROM vol_safeguarding_training WHERE id >= 950000;
DELETE FROM resources WHERE id >= 950000;
DELETE FROM posts WHERE id >= 950000;
DELETE FROM transactions WHERE id >= 950000;
DELETE FROM knowledge_base_articles WHERE id >= 950000;
DELETE FROM insurance_certificates WHERE id >= 950000;
DELETE FROM member_data_exports WHERE id >= 950000;
DELETE FROM saved_searches WHERE id >= 950000;
DELETE FROM monthly_engagement WHERE id >= 950000;
DELETE FROM job_saved_profiles WHERE id >= 950000;
DELETE FROM job_vacancies WHERE id >= 950000;
DELETE FROM ideation_challenges WHERE id >= 950000;
DELETE FROM challenge_templates WHERE id >= 950000;
DELETE FROM challenge_tags WHERE id >= 950000;
DELETE FROM challenge_categories WHERE id >= 950000;
DELETE FROM merchant_coupons WHERE id >= 950000;
DELETE FROM course_categories WHERE id >= 950000;
DELETE FROM help_faqs WHERE id >= 950000;
DELETE FROM hashtags WHERE id >= 950000;
DELETE FROM challenges WHERE id >= 950000;
DELETE FROM badges WHERE id >= 950000;
DELETE FROM tenant_safeguarding_options WHERE id >= 950000;
DELETE FROM polls WHERE id >= 950000;
DELETE FROM feed_posts WHERE id >= 950000;
DELETE FROM events WHERE id >= 950000;
DELETE FROM group_templates WHERE id >= 950000;
DELETE FROM group_types WHERE id >= 950000;
DELETE FROM `groups` WHERE id >= 950000;
DELETE FROM resource_categories WHERE id >= 950000;
DELETE FROM vol_organizations WHERE id >= 950000;
DELETE FROM skills WHERE id >= 950000;
DELETE FROM categories WHERE id >= 950000;

-- ---------------------------------------------------------------------------
-- categories — ONE TABLE, THREE CONTRACTS, keyed by `type`.
-- /blog/categories filters `type = 'blog'`; /resources/categories filters
-- `type = 'resource'`. The 8 rows the E2E seeder leaves are all type='listing',
-- which is why both endpoints answered with an empty list.
-- ---------------------------------------------------------------------------
INSERT INTO categories (id, tenant_id, name, slug, sort_order, is_active, color, type) VALUES
  (950001, @T, 'Community News', 'community-news', 1, 1, 'blue',  'blog'),
  (950002, @T, 'Getting Started', 'getting-started', 1, 1, 'green', 'resource');

-- posts — /blog/categories counts published posts per category. The real query
-- also excludes any post whose text matches '%lorem ipsum%', so the body here is
-- deliberately real prose: filler text would be counted as zero.
INSERT INTO posts (id, tenant_id, author_id, title, slug, excerpt, content, status, category_id) VALUES
  (950001, @T, @UA, 'Skill swaps are back on Thursdays', 'skill-swaps-thursdays',
   'The Thursday skill swap returns to the community hall.',
   'The Thursday skill swap returns to the community hall from this week. Bring one thing you can teach and one thing you would like to learn.',
   'published', 950001);

-- ---------------------------------------------------------------------------
-- Volunteering. vol_opportunities is only visible when its organisation is
-- 'approved' or 'active' — an opportunity attached to a pending organisation is
-- filtered out and seeds nothing.
-- ---------------------------------------------------------------------------
INSERT INTO vol_organizations (id, tenant_id, user_id, name, slug, description, contact_email, status, org_type) VALUES
  (950020, @T, @UA, 'Riverside Community Trust', 'riverside-community-trust',
   'Runs the riverside allotments and the weekly repair cafe.',
   'hello@riverside.example', 'approved', 'organisation');

-- is_active = 1 AND status IN ('open','active') AND the organisation gate above.
--
-- 🔴 category_id is set deliberately. With it NULL, Laravel serialised
-- `category: null` and the response differ could not see inside the object at
-- all — so the nested keys (`id`, `name`, `color`) read as "extra in ASP.NET"
-- rather than being compared. A fixture gap that hides a contract question is
-- worse than a contract gap, because it looks like agreement.
SET @VOLCAT = (SELECT id FROM categories WHERE tenant_id = @T ORDER BY id LIMIT 1);
INSERT INTO vol_opportunities (id, tenant_id, organization_id, category_id, title, description, location, is_remote, skills_needed, start_date, is_active, status, credits_offered, created_by) VALUES
  (950021, @T, 950020, @VOLCAT, 'Repair cafe helper', 'Help visitors mend small appliances and bicycles at the Saturday repair cafe.',
   'Riverside Hall', 0, 'Basic tools, patience', DATE_ADD(CURDATE(), INTERVAL 7 DAY), 1, 'open', 2, @UA);

-- Belongs to the signing-in member: the endpoint filters on user_id.
INSERT INTO vol_donations (id, tenant_id, user_id, opportunity_id, fund_code, amount, currency, payment_method, payment_reference, donor_name, message, is_anonymous, status) VALUES
  (950022, @T, @UA, 950021, 'general', 25.00, 'EUR', 'card', 'pi_fixture_950022',
   'E2E UserA', 'Keep the repair cafe running.', 0, 'completed');

INSERT INTO vol_safeguarding_training (id, tenant_id, user_id, training_type, training_name, provider, certificate_reference, completed_at, expires_at, status) VALUES
  (950023, @T, @UA, 'children_first', 'Children First introductory training', 'Tusla',
   'CF-2026-4471', DATE_SUB(CURDATE(), INTERVAL 60 DAY), DATE_ADD(CURDATE(), INTERVAL 305 DAY), 'verified');

-- ---------------------------------------------------------------------------
-- Groups. /groups filters status='active' AND (is_featured OR parent_id IS NULL)
-- AND public visibility. form-capabilities additionally needs an ACTIVE type and
-- an ACTIVE template, and lists groups the member owns or belongs to.
-- ---------------------------------------------------------------------------
INSERT INTO group_types (id, tenant_id, name, slug, description, icon, color, sort_order, is_active) VALUES
  (950030, @T, 'Neighbourhood', 'neighbourhood', 'Groups organised around a place.', 'fa-map-pin', '#2563eb', 1, 1);

INSERT INTO group_templates (id, tenant_id, name, description, icon, default_visibility, default_type_id, is_active, sort_order) VALUES
  (950031, @T, 'Neighbourhood group', 'A public group for a street or estate.', 'fa-users', 'public', 950030, 1, 1);

INSERT INTO `groups` (id, parent_id, type_id, template_id, tenant_id, owner_id, name, slug, description, visibility, is_featured, is_active, status, location) VALUES
  (950032, NULL, 950030, 950031, @T, @UA, 'Riverside Neighbours', 'riverside-neighbours',
   'Neighbours along the riverside sharing tools, lifts and time.', 'public', 1, 1, 'active', 'Riverside');

INSERT INTO group_members (id, tenant_id, group_id, user_id, status, role) VALUES
  (950033, @T, 950032, @UA, 'active', 'owner'),
  (950034, @T, 950032, @UB, 'active', 'member');

-- ---------------------------------------------------------------------------
-- Events. Visible when status IS NULL OR status='active', and (no group, or a
-- group the member can see). Dated forward so an upcoming-events filter keeps it.
-- ---------------------------------------------------------------------------
INSERT INTO events (id, tenant_id, user_id, group_id, title, description, location, start_time, start_date, end_time, timezone, is_online, max_attendees, status, latitude, longitude, accessibility_step_free, accessibility_toilet) VALUES
  (950040, @T, @UA, NULL, 'Repair cafe and tea', 'Bring something broken and we will try to mend it together. Tea provided.',
   'Riverside Hall', DATE_ADD(NOW(), INTERVAL 7 DAY), DATE_ADD(NOW(), INTERVAL 7 DAY),
   DATE_ADD(NOW(), INTERVAL 7 DAY) + INTERVAL 2 HOUR, 'Europe/Dublin', 0, 30, 'active',
   53.34980000, -6.26030000, 1, 1);

INSERT INTO event_rsvps (id, tenant_id, event_id, user_id, status) VALUES
  (950041, @T, 950040, @UA, 'going'),
  (950042, @T, 950040, @UB, 'interested');

-- ---------------------------------------------------------------------------
-- Feed. The timeline reads `feed_activity` (joined to users), not `feed_posts`
-- directly, so BOTH are needed: a post nobody has an activity row for does not
-- appear in the feed.
-- ---------------------------------------------------------------------------
INSERT INTO feed_posts (id, tenant_id, user_id, group_id, content, likes_count, visibility, publish_status, type, is_hidden) VALUES
  (950050, @T, @UA, NULL, 'Two spare bike inner tubes going free if anyone needs them. #repaircafe', 3, 'public', 'published', 'post', 0);

INSERT INTO feed_activity (id, tenant_id, user_id, source_type, source_id, group_id, title, content, is_visible, is_hidden) VALUES
  (950051, @T, @UA, 'post', 950050, NULL, NULL,
   'Two spare bike inner tubes going free if anyone needs them. #repaircafe', 1, 0);

-- Trending hashtags require post_count > 0 AND last_used_at within the last 7
-- days. A tag with a zero count, or an old one, is filtered out.
INSERT INTO hashtags (id, tenant_id, tag, post_count, last_used_at) VALUES
  (950052, @T, 'repaircafe', 4, NOW()),
  (950053, @T, 'skillswap', 2, DATE_SUB(NOW(), INTERVAL 1 DAY));

-- ---------------------------------------------------------------------------
-- Gamification. challenges must be is_active AND currently in date.
-- ---------------------------------------------------------------------------
INSERT INTO challenges (id, tenant_id, title, description, challenge_type, action_type, target_count, xp_reward, badge_reward, start_date, end_date, is_active) VALUES
  (950060, @T, 'Offer three hours this month', 'Complete three exchanges before the end of the month.',
   'monthly', 'exchange_completed', 3, 150, 'helping-hand', DATE_SUB(CURDATE(), INTERVAL 3 DAY), DATE_ADD(CURDATE(), INTERVAL 25 DAY), 1);

INSERT INTO badges (id, tenant_id, badge_key, name, description, icon, color, xp_value, rarity, category, is_active) VALUES
  (950061, @T, 'helping-hand', 'Helping Hand', 'Awarded for completing three exchanges in a month.',
   'fa-hand-holding-heart', '#16a34a', 150, 'uncommon', 'community', 1);

INSERT INTO user_badges (id, tenant_id, user_id, badge_key, name, title, icon, is_showcased, earned_at) VALUES
  (950062, @T, @UA, 'helping-hand', 'Helping Hand', 'Helping Hand', 'fa-hand-holding-heart', 1, NOW());

-- `year_month` needs backticks: bare YEAR_MONTH is INTERVAL syntax in MariaDB.
INSERT INTO monthly_engagement (id, tenant_id, user_id, `year_month`, was_active, activity_count, recognized_at) VALUES
  (950063, @T, @UA, DATE_FORMAT(CURDATE(), '%Y-%m'), 1, 12, NOW()),
  (950064, @T, @UA, DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m'), 1, 7, NOW());

-- ---------------------------------------------------------------------------
-- Help and knowledge base. help_faqs needs is_published; kb articles join
-- `resource_categories` for their category name, so that table is the parent.
-- ---------------------------------------------------------------------------
INSERT INTO help_faqs (id, tenant_id, category, question, answer, sort_order, is_published) VALUES
  (950070, @T, 'Getting started', 'How do time credits work?',
   'One hour of help earns one time credit, whatever the task. Spend credits on help from anyone else in the community.', 1, 1);

INSERT INTO resource_categories (id, tenant_id, name, slug, parent_id, sort_order, icon, description) VALUES
  (950010, @T, 'Guides', 'guides', NULL, 1, 'fa-book', 'How the timebank works.'),
  (950011, @T, 'Printable guides', 'printable-guides', 950010, 1, 'fa-print', 'Guides formatted for printing.');

INSERT INTO knowledge_base_articles (id, tenant_id, title, slug, content, content_type, category_id, sort_order, is_published, created_by) VALUES
  (950071, @T, 'Recording an exchange', 'recording-an-exchange',
   '<p>After you have helped someone, open the exchange and confirm the hours. Both sides confirm before credits move.</p>',
   'html', 950010, 1, 1, @UA);

-- resources — counted by /resources/categories (against `categories`) and by
-- /resources/categories/tree (against `resource_categories`). Laravel points the
-- same `resources.category_id` column at two different tables here; that is its
-- own quirk, faithfully left alone. One row per parent so both counts are real.
INSERT INTO resources (id, tenant_id, user_id, category_id, title, description, file_path, file_type, file_size, downloads, content_type, sort_order) VALUES
  (950012, @T, @UA, 950002, 'Timebank welcome pack', 'What a new member needs to know in two pages.',
   'uploads/resources/welcome-pack.pdf', 'application/pdf', 184320, 6, 'plain', 1),
  (950013, @T, @UA, 950010, 'Exchange record sheet', 'A paper sheet for recording hours offline.',
   'uploads/resources/exchange-record.pdf', 'application/pdf', 51200, 2, 'plain', 2);

-- ---------------------------------------------------------------------------
-- Ideation. Challenges are only listed in status open/voting/evaluating/closed —
-- the 'draft' default is invisible. Popular tags need the link rows too.
-- ---------------------------------------------------------------------------
INSERT INTO challenge_categories (id, tenant_id, name, slug, icon, color, sort_order) VALUES
  (950080, @T, 'Transport', 'transport', 'fa-bus', '#0ea5e9', 1);

INSERT INTO challenge_tags (id, tenant_id, name, slug, tag_type) VALUES
  (950081, @T, 'cycling', 'cycling', 'interest'),
  (950082, @T, 'accessibility', 'accessibility', 'general');

-- `tags` and `evaluation_criteria` are JSON columns, separate from the
-- challenge_tag_links pivot below. Left null they serialise as an empty array
-- and the nested contract stays untested.
INSERT INTO ideation_challenges (id, tenant_id, user_id, title, description, category, status, ideas_count, submission_deadline, voting_deadline, prize_description, max_ideas_per_user, category_id, views_count, is_featured, tags, evaluation_criteria) VALUES
  (950083, @T, @UA, 'How do we make the riverside path usable all year?',
   'The path floods every winter and the lighting stops halfway. What would you change first?',
   'Transport', 'open', 2, DATE_ADD(NOW(), INTERVAL 21 DAY), DATE_ADD(NOW(), INTERVAL 35 DAY),
   'The winning idea goes to the next community meeting.', 3, 950080, 41, 1,
   '["cycling","accessibility"]', '[{"name":"Feasibility","weight":50},{"name":"Impact","weight":50}]');

INSERT INTO challenge_tag_links (challenge_id, tag_id) VALUES
  (950083, 950081),
  (950083, 950082);

INSERT INTO challenge_templates (id, tenant_id, title, description, default_tags, evaluation_criteria, prize_description, max_ideas_per_user, default_category_id, created_by) VALUES
  (950084, @T, 'Neighbourhood improvement', 'Ask members what to fix first in one part of the community.',
   '["transport","accessibility"]', '[{"name":"Feasibility","weight":50},{"name":"Impact","weight":50}]',
   'Presented at the next community meeting.', 3, 950080, @UA);

-- ---------------------------------------------------------------------------
-- Jobs. my-applications joins the vacancy, so the vacancy is required; the
-- application must belong to the signing-in member.
-- ---------------------------------------------------------------------------
INSERT INTO job_vacancies (id, tenant_id, user_id, organization_id, title, description, tagline, location, is_remote, type, commitment, category, skills_required, hours_per_week, time_credits, contact_email, deadline, status) VALUES
  (950090, @T, @UB, NULL, 'Repair cafe coordinator', 'Coordinate volunteers and tools for the Saturday repair cafe.',
   'Two mornings a month, and a lot of tea.', 'Riverside Hall', 0, 'volunteer', 'part_time',
   'Community', 'Organising, basic repair knowledge', 6.0, 6.00, 'jobs@riverside.example',
   DATE_ADD(NOW(), INTERVAL 30 DAY), 'open');

INSERT INTO job_vacancy_applications (id, tenant_id, vacancy_id, user_id, message, status, stage) VALUES
  (950091, @T, 950090, @UA, 'I have run the tool library for two years and would like to help.', 'applied', 'applied');

INSERT INTO job_saved_profiles (id, tenant_id, user_id, cv_path, cv_filename, cv_size, headline, cover_text) VALUES
  (950092, @T, @UA, 'uploads/cv/e2e-user-a.pdf', 'e2e-user-a.pdf', 98304,
   'Tool library volunteer and bike mechanic', 'Happy to help with anything practical.');

-- ---------------------------------------------------------------------------
-- Wallet. Only 'completed' transactions involving the member are listed.
-- ---------------------------------------------------------------------------
INSERT INTO transactions (id, tenant_id, sender_id, receiver_id, giver_id, amount, description, status, transaction_type) VALUES
  (950100, @T, @UA, @UB, @UB, 2.00, 'Two hours of bike repair', 'completed', 'transfer'),
  (950101, @T, @UB, @UA, @UA, 1.50, 'Help moving a wardrobe', 'completed', 'transfer');

-- ---------------------------------------------------------------------------
-- Member-owned records. Each of these endpoints filters on user_id, so a row
-- belonging to anyone else would leave the list empty.
-- ---------------------------------------------------------------------------
INSERT INTO saved_searches (id, tenant_id, user_id, name, query_params, notify_on_new, last_run_at, last_result_count) VALUES
  (950110, @T, @UA, 'Bike repair nearby', '{"q":"bike repair","radius_km":5,"type":"offer"}', 1, NOW(), 3);

INSERT INTO member_data_exports (id, tenant_id, user_id, format, requested_at, completed_at, file_size_bytes, ip_address) VALUES
  (950111, @T, @UA, 'zip', DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 3 DAY) + INTERVAL 4 MINUTE, 246784, '127.0.0.1');

INSERT INTO insurance_certificates (id, tenant_id, user_id, insurance_type, provider_name, policy_number, coverage_amount, start_date, expiry_date, certificate_file_path, status, verified_by, verified_at, notes) VALUES
  (950112, @T, @UA, 'public_liability', 'Allied Mutual', 'PL-88213', 2000000.00,
   DATE_SUB(CURDATE(), INTERVAL 90 DAY), DATE_ADD(CURDATE(), INTERVAL 275 DAY),
   'uploads/insurance/pl-88213.pdf', 'verified', @UB, NOW(), 'Checked against the provider portal.');

INSERT INTO verein_member_dues (id, organization_id, tenant_id, user_id, membership_year, amount_cents, currency, status, due_date, paid_at) VALUES
  (950113, 950020, @T, @UA, YEAR(CURDATE()), 4500, 'EUR', 'paid', DATE_ADD(CURDATE(), INTERVAL 30 DAY), NOW());

-- ---------------------------------------------------------------------------
-- Remaining single-row catalogues.
-- ---------------------------------------------------------------------------
INSERT INTO course_categories (id, tenant_id, name, slug, description, icon, position) VALUES
  (950120, @T, 'Practical skills', 'practical-skills', 'Repair, grow, cook, mend.', 'fa-screwdriver-wrench', 1);

-- status must be 'active' and the validity window must contain now.
INSERT INTO merchant_coupons (id, tenant_id, seller_id, code, title, description, discount_type, discount_value, min_order_cents, max_uses, max_uses_per_member, valid_from, valid_until, status, applies_to, usage_count) VALUES
  (950121, @T, @UA, 'REPAIR10', '10% off repair supplies', 'Ten per cent off parts at the repair cafe.',
   'percent', 10.00, 500, 100, 2, DATE_SUB(NOW(), INTERVAL 7 DAY), DATE_ADD(NOW(), INTERVAL 60 DAY),
   'active', 'all_listings', 4);

INSERT INTO tenant_safeguarding_options (id, tenant_id, option_key, option_type, label, description, help_url, sort_order, is_active, is_required, preset_source) VALUES
  (950122, @T, 'works_with_children', 'checkbox', 'I may offer help that involves children',
   'Choosing this means we will ask you to complete Children First training.',
   'https://www.tusla.ie/children-first/', 1, 1, 0, 'ie_default');

INSERT INTO polls (id, tenant_id, user_id, question, description, end_date, is_active, poll_type, category, tags, is_anonymous) VALUES
  (950123, @T, @UA, 'Which Saturday suits the next repair cafe?',
   'We can run it on either weekend this month.', DATE_ADD(NOW(), INTERVAL 14 DAY), 1, 'standard', 'Events',
   '["events","repair"]', 0);

-- A poll with no options is not a realistic row: `data[].options` stayed an
-- empty array after the first seeding pass, so the option contract was still
-- untested even though the poll itself was being compared.
INSERT INTO poll_options (id, poll_id, tenant_id, label, votes) VALUES
  (950124, 950123, @T, 'Saturday the 12th', 7),
  (950125, 950123, @T, 'Saturday the 26th', 4);

-- poll_votes.id is NOT NULL with no auto_increment and no default, so it has to
-- be supplied explicitly.
INSERT INTO poll_votes (id, poll_id, option_id, user_id, tenant_id) VALUES
  (950126, 950123, 950124, @UA, @T);

-- skills — /skills/search returns [] without a `q`, so this row is for the
-- taxonomy endpoints rather than that one. Noted, not assumed to fix it.
INSERT INTO skills (id, tenant_id, name, slug, category_id) VALUES
  (950130, @T, 'Bicycle repair', 'bicycle-repair', NULL),
  (950131, @T, 'Conversational Irish', 'conversational-irish', NULL);

-- ---------------------------------------------------------------------------
-- Federation opt-in for the fixture members.
--
-- 🔴 Moved here from start-disposable-laravel.sh on 2026-08-19, because the fixture
-- must be SELF-CONTAINED. Federation reads are gated on the member's opt-in on both
-- backends, so without these rows /federation/activity and /federation/messages
-- answer differently for a reason that is fixture state, not behaviour — and the
-- harness reports a status difference it cannot see past.
--
-- Keeping it only in the start script meant the opt-in was lost whenever the fixture
-- drifted without the container being recreated, which is exactly what happened: a
-- fixture applied yesterday is not the fixture you measure against today. Re-applying
-- this file must be enough to restore a measurable state on its own.
--
-- This is a comparison fixture only. Opting in is a real member decision and nothing
-- here changes that; verifying the gate correctly REFUSES is a separate check against
-- a fixture that has not opted in.
-- ---------------------------------------------------------------------------
INSERT INTO federation_user_settings
    (user_id, federation_optin, profile_visible_federated, messaging_enabled_federated,
     appear_in_federated_search, show_skills_federated, opted_in_at)
SELECT id, 1, 1, 1, 1, 1, NOW() FROM users
ON DUPLICATE KEY UPDATE federation_optin = 1, opted_in_at = NOW();

-- ---------------------------------------------------------------------------
-- 🔴 TENANT SLUG. TenantSeeder.php creates the master tenant with `slug => NULL`,
-- so `X-Tenant-Slug` resolves to NOTHING on the disposable Laravel — while the
-- ASP.NET seed's main tenant IS `acme`. That asymmetry means the two backends
-- cannot be addressed by the same slug, and web-uk (which sends X-Tenant-Slug on
-- every signed-out request) has to be pointed at a different community per
-- backend. Setting it here rather than in a seeder because Laravel's seeders are
-- read-only reference material for this workstream (see the header of this file).
-- ---------------------------------------------------------------------------
UPDATE tenants SET slug = 'acme' WHERE id = @T AND (slug IS NULL OR slug = '');

-- ---------------------------------------------------------------------------
-- 🔴 LEGAL DOCUMENT SYMMETRY. DemoShowcaseSeedData.cs:1615 seeds a Terms document
-- with RequiresAcceptance = true, and NO Laravel seeder or fixture created one —
-- so the legal-acceptance gate fired on ASP.NET and never on Laravel. Any
-- comparison of a signed-in journey was therefore measuring two different
-- journeys: one gated, one not. The acceptance rows below keep the gate SATISFIED
-- for the fixture users, so the document exists on both sides without either
-- backend's members being blocked mid-measurement.
-- ---------------------------------------------------------------------------
INSERT INTO legal_documents
    (id, tenant_id, document_type, title, slug, requires_acceptance,
     acceptance_required_for, is_active)
VALUES (950001, @T, 'terms', 'Terms of Service', 'terms-of-service', 1, 'registration', 1)
ON DUPLICATE KEY UPDATE title = VALUES(title), is_active = 1;

-- `created_by` is NOT NULL with no default in this table, so it must be supplied.
INSERT INTO legal_document_versions
    (id, document_id, version_number, content, effective_date, published_at,
     is_draft, is_current, created_by)
VALUES (950001, 950001, '1.0',
        'Fixture terms of service for contract-parity measurement.',
        CURDATE(), NOW(), 0, 1, @UA)
ON DUPLICATE KEY UPDATE is_current = 1, is_draft = 0;

UPDATE legal_documents SET current_version_id = 950001 WHERE id = 950001;

-- Accept it for every fixture user, so the gate is SATISFIED rather than pending.
-- ASP.NET's seed leaves its members already accepted; without this the two backends
-- would present the same document in two different states (has_pending true vs
-- false), and a signed-in journey comparison would be measuring a gated journey
-- against an ungated one.
INSERT INTO user_legal_acceptances
    (user_id, document_id, version_id, version_number, accepted_at, acceptance_method)
SELECT id, 950001, 950001, '1.0', NOW(), 'registration' FROM users WHERE tenant_id = @T
ON DUPLICATE KEY UPDATE accepted_at = NOW();
