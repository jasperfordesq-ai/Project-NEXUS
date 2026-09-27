-- Recreate this view after restoring a database dump under a different name.
-- Run with the restored database selected, never the source database.
-- MariaDB's dumped definition may contain source-schema qualifiers inside the
-- correlated subquery. Recreating it here binds all tables to the new schema.
CREATE OR REPLACE ALGORITHM=UNDEFINED SQL SECURITY INVOKER
VIEW `user_effective_permissions` AS
SELECT DISTINCT
    `u`.`id` AS `user_id`,
    `p`.`id` AS `permission_id`,
    `p`.`name` AS `permission_name`,
    `p`.`category` AS `category`,
    CASE
        WHEN `up`.`granted` = 0 THEN 0
        WHEN `up`.`granted` = 1 THEN 1
        WHEN `rp`.`permission_id` IS NOT NULL THEN 1
        ELSE 0
    END AS `has_permission`,
    CASE
        WHEN `up`.`id` IS NOT NULL THEN 'direct'
        WHEN `rp`.`id` IS NOT NULL THEN 'role'
        ELSE 'none'
    END AS `grant_source`
FROM `users` AS `u`
LEFT JOIN `user_roles` AS `ur`
    ON `u`.`id` = `ur`.`user_id`
    AND (`ur`.`expires_at` IS NULL OR `ur`.`expires_at` > CURRENT_TIMESTAMP())
LEFT JOIN `role_permissions` AS `rp`
    ON `ur`.`role_id` = `rp`.`role_id`
LEFT JOIN `permissions` AS `p`
    ON `rp`.`permission_id` = `p`.`id`
    OR `p`.`id` IN (
        SELECT `up_direct`.`permission_id`
        FROM `user_permissions` AS `up_direct`
        WHERE `up_direct`.`user_id` = `u`.`id`
    )
LEFT JOIN `user_permissions` AS `up`
    ON `u`.`id` = `up`.`user_id`
    AND `p`.`id` = `up`.`permission_id`
    AND (`up`.`expires_at` IS NULL OR `up`.`expires_at` > CURRENT_TIMESTAMP())
WHERE `p`.`id` IS NOT NULL;
