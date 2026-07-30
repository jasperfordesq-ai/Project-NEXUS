# Database & Migrations

Last reviewed: 2026-07-30

> **Diátaxis:** explanation + how-to. How Project NEXUS structures its database, the two migration systems, and how to add schema changes safely.

The platform runs on **MariaDB 10.11** (MySQL-compatible), with **Redis 7** for cache/queues and **Meilisearch** for search indexing.

## Multi-tenancy is the first invariant

Project NEXUS is multi-tenant: many communities share one database, isolated by a `tenant_id` column on tenant-scoped tables. **Every query, INSERT, UPDATE, and DELETE on a tenant-scoped table must be scoped by `tenant_id`.**

```php
$tenantId = TenantContext::getId();
$stmt = Database::query(
    "SELECT * FROM users WHERE tenant_id = ? AND status = ?",
    [$tenantId, 'active']
);
```

Never concatenate SQL; always use prepared statements. For `IN (...)` clauses, build placeholders with `implode(',', array_fill(0, count($ids), '?'))` — never pass an array as a single parameter. Every `DELETE`/`UPDATE` on a tenant-scoped table must include `AND tenant_id = ?`.

## Two migration systems

| System | Location | Status |
|--------|----------|--------|
| **Laravel migrations** | `database/migrations/` | **Primary — use for all new changes** |
| Legacy SQL migrations | `migrations/` | Historical record — **do not add new ones** |

New schema changes use standard Laravel migrations (`php artisan make:migration`). Make them **idempotent** with `Schema::hasTable()` / `Schema::hasColumn()` guards so they are safe to re-run:

```php
if (! Schema::hasColumn('users', 'preferred_language')) {
    Schema::table('users', function (Blueprint $table) {
        $table->string('preferred_language', 8)->default('en');
    });
}
```

When adding foreign keys, check **column-type consistency** (signed vs unsigned int) against the referenced table, or the FK creation will fail.

## The schema dump

`database/schema/mysql-schema.sql` is the **full current schema** plus `laravel_migrations` table data, committed to git so a new contributor can stand up a working database. Its size and migration count change frequently, so verify the file itself rather than relying on copied counts:

```bash
docker compose --profile docker-php up -d app
docker exec nexus-php-app php artisan migrate --seed
```

The `--profile docker-php` flag is required: the `app` service is profile-gated in `compose.yml` (line 22), so a bare `docker compose up -d` never creates the `nexus-php-app` container and the `docker exec` on the next line fails with "no such container". `npm run dev:docker` wraps the same invocation. Four opt-in application services are profile-gated — `app` (`docker-php`), `frontend` (`docker-frontend`), `queue` (`docker-queue`) and `sales` (`docker-sales`) — plus `phpmyadmin` (`nexus-phpmyadmin`) behind the `tools` profile (`compose.yml` line 294), for five profile-gated services in total.

The seed step creates the master tenant (`tenant_id=1`) and a first-run platform administrator. Development installs default to `admin@project-nexus.local` / `ChangeMe123!`; set `NEXUS_BOOTSTRAP_ADMIN_EMAIL` and `NEXUS_BOOTSTRAP_ADMIN_PASSWORD` before seeding to use different credentials.

After running migrations that change the schema, **refresh the dump and commit it**:

```bash
bash scripts/refresh-schema-dump.sh
# then commit the updated database/schema/mysql-schema.sql
```

> Before writing code that queries a table, verify the **actual** column names against the schema dump or live schema — do not assume. (Several past bugs came from assumed column names; see the GDPR guide's "residual schema-drift caveats" for examples.)

## Adding a migration — checklist

1. `php artisan make:migration add_foo_to_bar_table`
2. Use `Schema::hasTable()` / `Schema::hasColumn()` guards for idempotency.
3. Run locally: `docker exec nexus-php-app php artisan migrate`.
4. Refresh the schema dump: `bash scripts/refresh-schema-dump.sh`.
5. Commit **both** the migration file and the updated `database/schema/mysql-schema.sql`.

## Running migrations on production

Laravel migrations run automatically during a blue/green deploy (`bluegreen-deploy.sh` runs `php artisan migrate --force` against the new colour before the traffic switch). To run them manually, see [DEPLOYMENT.md](DEPLOYMENT.md). Raw SQL migrations use the checked-in `make migrate*` wrappers.
