# ASP.NET database: what the backup position actually is

**Established 2026-08-16 by read-only inspection of the production host.**
This corrects a claim carried in several documents since 2026-08-10, which has
been the stated reason for treating this backend as untouchable.

## The claim that was being repeated

> The live ASP.NET database has had no successful backup since 2026-03-08 (156
> consecutive failures), and the app runs `Database.MigrateAsync()` on every
> start, so restarting that container can irreversibly change live data with
> nothing to restore from.

Every sentence of that is true about the **scheduled off-server backup job** in
the old repository — its root cause is `ssh-keyscan -H` with an empty host
variable, which kills the job before it reaches the backup command. It is
**incomplete** about the actual data, in a way that matters.

## What is actually on the server

| Fact | Evidence |
| --- | --- |
| A PostgreSQL dump exists, taken **2026-08-10 16:35:37Z** | `/opt/nexus-backend/backups/aspnet-nexus_dev-20260810-163536.dump`, 2.0 MB |
| It is **intact** | `sha256sum -c` against its own `.sha256` → **OK** |
| It is a **real** dump, not a stub | File header is `PGDMP` (PostgreSQL custom format) |
| The database container **stopped 33 seconds later**, at 16:36:10Z | `docker inspect nexus-backend-db --format '{{.State.FinishedAt}}'` |
| It has **not run since** | Container state `Exited (0)`, and no newer files in `backups/` |
| Older dumps exist too | ~15 MB across `backups/`, including pre-deploy dumps back to March |

So there **is** a recovery point, it is **checksum-verified**, and because the
database has been stopped ever since, it is **current** — nothing has changed
behind it.

The three containers (`nexus-backend-api`, `-db`, `-rabbitmq`) are all `Exited`.
The data sits at rest in the `nexus-backend-db-data` Docker volume.

## What the real risks are now

The migrate-on-start hazard is **dormant, not gone**. It becomes live the moment
anyone starts that container — and at that point the 10 August dump stops being
current.

Three genuine gaps remain:

1. 🔴 **One copy, on the same machine as the data.** Losing the VM loses the
   database and its only backup together. This is the real exposure, and it is
   not what the documents have been describing.
2. 🔴 **Never restore-tested.** A dump that passes a checksum is intact, not
   proven restorable. Nobody has loaded it into an empty database and confirmed
   the tables and row counts.
3. 🟡 **The scheduled job is still broken**, so nothing new is being taken. That
   only matters if the database is ever started again.

## What I recommend, and what needs your decision

**Owner decision required — I have not done either of these.** Both move or
touch production data, which needs explicit authorization.

1. **Copy the dump off the server** (2.0 MB, one file plus its `.sha256`).
   This removes the single-point-of-failure and takes a minute. It is a
   *decision* because it moves production data to another machine, so where it
   lands matters.
2. **Restore-test it** into a disposable PostgreSQL instance and record the
   table and row counts. Proves the recovery point is real rather than assumed.
   No production access needed once (1) is done.

**Not recommended until both are done:** starting the ASP.NET containers for any
reason. Migrate-on-start is forward-only and a container rollback cannot undo a
schema change.

**Not worth doing:** repairing the scheduled backup job in the dead repository.
It backs up a database that is switched off. Fix it only if that backend is ever
brought back.

## Why this correction matters

"No backup exists" and "one unverified backup exists, on the same box" call for
different responses. The first says *stop everything*. The second says *copy one
2 MB file somewhere else, then carry on* — and it is the second that is true.

The pause on ASP.NET production work should still hold, but for its real
reasons: no deployment path, no verified restore, and no owner decision on
whether that backend has a future at all.
