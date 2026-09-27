-- Run with the separately restored database selected. These three legacy
-- views in the schema dump use a missing nexus@% definer and source-qualified
-- references on staging. Recreate them with target-local table references and
-- the invoking application's restored-database SELECT grant.

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `user_gamification_summary` AS
SELECT
    u.id AS user_id,
    u.tenant_id,
    u.xp,
    u.level,
    u.login_streak,
    COUNT(DISTINCT ub.badge_key) AS badge_count,
    (SELECT COUNT(*) FROM user_challenge_progress ucp
     WHERE ucp.user_id = u.id AND ucp.completed_at IS NOT NULL) AS challenges_completed,
    (SELECT COUNT(*) FROM friend_challenges fc
     WHERE (fc.challenger_id = u.id OR fc.challenged_id = u.id)
       AND fc.winner_id = u.id) AS friend_challenges_won
FROM users u
LEFT JOIN user_badges ub ON ub.user_id = u.id
WHERE u.is_approved = 1
GROUP BY u.id, u.tenant_id, u.xp, u.level, u.login_streak;

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `v_active_listings_with_coords` AS
SELECT
    l.id,
    l.user_id,
    l.tenant_id,
    l.title,
    l.description,
    l.type,
    l.category_id,
    l.image_url,
    l.status,
    l.created_at,
    COALESCE(l.latitude, u.latitude) AS latitude,
    COALESCE(l.longitude, u.longitude) AS longitude,
    u.first_name,
    u.last_name,
    u.avatar_url,
    u.location AS author_location,
    c.name AS category_name,
    c.color AS category_color
FROM listings l
JOIN users u ON u.id = l.user_id
LEFT JOIN categories c ON c.id = l.category_id
WHERE l.status = 'active';

CREATE OR REPLACE SQL SECURITY INVOKER VIEW `v_legal_acceptance_stats` AS
SELECT
    ld.id AS document_id,
    ld.tenant_id,
    ld.document_type,
    ld.title,
    ldv.id AS version_id,
    ldv.version_number,
    ldv.effective_date,
    ldv.is_current,
    COUNT(DISTINCT ula.user_id) AS total_acceptances,
    MIN(ula.accepted_at) AS first_acceptance,
    MAX(ula.accepted_at) AS last_acceptance
FROM legal_documents ld
JOIN legal_document_versions ldv ON ldv.document_id = ld.id
LEFT JOIN user_legal_acceptances ula ON ula.version_id = ldv.id
GROUP BY ld.id, ld.tenant_id, ld.document_type, ld.title,
         ldv.id, ldv.version_number, ldv.effective_date, ldv.is_current;
