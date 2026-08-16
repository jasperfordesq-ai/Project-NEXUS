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

## 🔴 Correction, same day, before this document was an hour old

The section below originally said the 10 August dump was the **only** copy and
had **never been restore-tested**. Both were wrong, and the record already said
so — I wrote the risk list from the server inspection alone without checking the
project history first, which is the same mistake this document was correcting.

What is actually true:

- **An off-server copy exists** at `C:\platforms\backups\nexus-aspnet\` on the
  dev workstation — `aspnet-nexus_dev-20260810-140401.{dump,sql.gz,sha256}`,
  sha256-verified byte-identical at download time.
- **It was restore-tested on 2026-08-10**, not merely written: restored into a
  throwaway `postgres:16.4-bookworm`, giving 265/265 tables, 53/53 EF
  migrations, 49,958 rows.

So the genuine remaining gap is much narrower than the list below implies, and
it is a **delta**, not an absence:

| Dump | Off-server copy | Restore-tested |
| --- | --- | --- |
| `…-140401` (14:04) | ✅ dev workstation | ✅ 265 tables / 53 migrations / 49,958 rows |
| `…-163536` (16:35, 33s before shutdown) | ❌ server only | ❌ checksum-verified only |

The database was still running between 14:04 and 16:35, so anything written in
those 2½ hours exists only in the 16:35 dump, which has no second copy. On a day
the deployment was being retired that is probably very little — but "probably"
is not a recovery position.

One further caveat that outranks all of this, from the project record: **the
deployed database is 112 EF migrations behind the repository** (53 applied vs
165 in git). The dump is a rollback point, not a source of truth about schema.

## What the real risks are now

The migrate-on-start hazard is **dormant, not gone**. It becomes live the moment
anyone starts that container — and at that point the 10 August dump stops being
current.

Three genuine gaps remain:

1. 🟡 **The final dump has no second copy.** The 16:35 capture — the only one
   taken after 14:04, and the one that reflects the database at shutdown — exists
   only on the server. Copying it is a one-minute job.
2. 🟡 **That final dump is checksum-verified but not restore-tested.** Its
   2½-hours-older sibling is, which makes a bad surprise unlikely rather than
   impossible.
3. 🟡 **The scheduled job is still broken**, so nothing new is being taken. That
   only matters if the database is ever started again.

None of these is "there is no backup". The honest summary is: **a proven
recovery point exists off-server; the last 2½ hours before shutdown is the only
part with a single copy.**

## What I recommend, and what needs your decision

**Owner decision required — I have not done either of these.** Both move or
touch production data, which needs explicit authorization.

1. **Copy the 16:35 dump off the server** (2.0 MB, plus its `.sha256`) to sit
   beside the 14:04 one already at `C:\platforms\backups\nexus-aspnet\`. This
   closes the only real gap. It is a *decision* because it moves production data
   to another machine.
2. **Restore-test that dump too**, and diff its table and row counts against the
   14:04 figures already recorded (265 / 53 / 49,958). That measures the 2½-hour
   delta instead of assuming it.

Given the 14:04 copy is already proven, this is prudence rather than urgency.

**Not recommended until both are done:** starting the ASP.NET containers for any
reason. Migrate-on-start is forward-only and a container rollback cannot undo a
schema change.

**Not worth doing:** repairing the scheduled backup job in the dead repository.
It backs up a database that is switched off. Fix it only if that backend is ever
brought back.

## Why this correction matters

"No backup exists" and "a restore-tested copy exists off-server, with a 2½-hour
tail that has only one copy" call for very different responses. The first says
*stop everything*. The second says *copy one more 2 MB file, then carry on* —
and it is the second that is true.

🔴 And the meta-lesson, since I made the same error inside the document written
to correct it: **check the project record before writing a risk assessment from
a fresh inspection.** The inspection told me what was on the server. It could not
tell me what was already on this workstation, or what had already been proven.

The pause on ASP.NET production work should still hold, but for its real
reasons: no deployment path, a 2 1/2-hour tail with only one copy, and no owner
decision on whether that backend has a future at all. "No backup" is not one
of them.
