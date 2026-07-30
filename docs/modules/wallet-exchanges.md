# Wallet & Exchanges Module Guide

Last reviewed: 2026-07-30

This guide is a how-to/reference for maintainers of the time-credit **Wallet** and the structured **Exchanges** workflow in Project NEXUS. It describes the exchange lifecycle, the ledger invariants that keep credits conserved, the idempotency guard on transfers, money-column precision, tenant scoping, feature gates, failure modes, and the regression tests that protect this surface.

Time credits ("hours") are the platform's internal unit of account. They are not money, but the ledger is treated with the same rigour as money: every movement is atomic and value-conserving.

## Audience & supported workflows

Use this guide when changing wallet balances, the transfer path, or any step of the exchange state machine.

Supported workflows:

- **Direct transfer** — a member sends credits to another member from their wallet.
- **Structured exchange** — a request against a listing that moves through accept → (optional broker approval) → work → dual confirmation → completion, minting the transfer only at completion.
- **Group exchange** — a multi-participant exchange with equal / custom / weighted hour splits, settled in one atomic completion.
- **Exchange rating** — a 1–5 star satisfaction rating left by either party after completion.

## Tenant & feature-gate rules

- **Tenant scoping is mandatory.** Every query is scoped by `App\Core\TenantContext::getId()` (directly, or via the `HasTenantScope` trait on Eloquent models). `users.balance`, `transactions`, and `exchange_requests` all carry `tenant_id`. Balance debits/credits in `ExchangeWorkflowService::createTransaction()` and `GroupExchangeService::complete()` filter on both `id` and `tenant_id`.
- **Module gate:** wallet (`module: wallet`).
- **Feature gate:** the exchange workflow is gated by `exchange_workflow`, resolved at runtime through `BrokerControlConfigService::isExchangeWorkflowEnabled()`. When disabled, exchange endpoints return `FEATURE_DISABLED` (HTTP 400) and the "needs attention" surfaces return `0` — see `ExchangesController` and `ExchangeService::countNeedingAttention()`. The dashboard "exchanges need your attention" count is the single source of truth shared by the React and accessible frontends.
- The transfer endpoint additionally requires onboarding completion (`onboarding-required` middleware) and is rate-limited.

## Key code & data locations

Routes are defined in [`routes/api.php`](../../routes/api.php). Do not copy the endpoint table here — read the route file or the OpenAPI/`docs/API.md` reference for the live list. Primary entry points:

| Concern | Route prefix | Controller |
| --- | --- | --- |
| Wallet balance / transactions / transfer | `/v2/wallet/*` | `App\Http\Controllers\Api\WalletController` |
| Wallet extras (statement, donations, community fund, ratings) | `/v2/wallet/*`, `/v2/exchanges/{id}/rate` | `App\Http\Controllers\Api\WalletFeaturesController` |
| Exchange lifecycle | `/v2/exchanges/*` | `App\Http\Controllers\Api\ExchangesController` |
| Group exchanges | `/v2/group-exchanges/*` | `App\Http\Controllers\Api\GroupExchangeController` |
| Broker approvals | `/v2/admin/broker/exchanges/*` | `App\Http\Controllers\Api\AdminBrokerController` |

Services:

- `app/Services/WalletService.php` — balance aggregation, transaction history, the `transfer()` credit-movement path and its idempotency guard.
- `app/Services/ExchangeService.php` — lightweight exchange listing/create/accept/decline/complete plus the "needs attention" dashboard signal.
- `app/Services/ExchangeWorkflowService.php` — the full state machine, broker approval, dual-party confirmation, and the credit-minting transaction at completion.
- `app/Services/ExchangeRatingService.php` — post-completion 1–5 star ratings (one per rater per exchange).
- `app/Services/GroupExchangeService.php` — multi-participant exchanges and split calculation.
- `app/Listeners/UpdateWalletBalance.php` — post-transaction side effects only (XP + badge checks), wired to `TransactionCompleted` in `app/Providers/EventServiceProvider.php`.

Models / tables:

- `transactions` — the wallet ledger (`App\Models\Transaction`).
- `exchange_requests` — exchange state (`App\Models\ExchangeRequest`).
- `exchange_history` — append-only audit trail of status transitions (`App\Models\ExchangeHistory`).
- `exchange_ratings`, `group_exchanges`, `group_exchange_participants`, `users.balance`.

## Exchange lifecycle / state machine

`ExchangeWorkflowService` owns the authoritative state machine. Allowed transitions are declared in its `TRANSITIONS` constant and enforced on every status change inside `updateStatus()`, which locks the row (`lockForUpdate`) and rejects any transition not in the allow-list. The `exchange_requests.status` column is an enum whose values are a **superset** of the workflow states — it additionally carries a legacy `scheduled` value that the `TRANSITIONS` allow-list does not use (some `ExchangeService` filters still reference it).

```
                       ┌─ pending_broker ─┐
request → pending_provider                ├→ accepted → in_progress → pending_confirmation → completed
                       └──────────────────┘                                   │
   (provider declines / either party cancels → cancelled)                     └→ disputed → completed
                                                                                          (or cancelled)
```

State-by-state:

1. **Request → `pending_provider`.** `createRequest()` records the request against a listing. Self-requests are rejected. The provider (listing owner) is notified. `proposed_hours` is clamped to `[0.25, 24]`.
2. **Provider accepts / declines.** Accept moves to `accepted`, *or* to `pending_broker` if broker approval is required (see below). Decline moves to `cancelled`. Both guard on the caller being the provider and the current status being `pending_provider`.
3. **Optional broker approval.** When required, a broker approves (→ `accepted`) or rejects (→ `cancelled`) from `pending_broker` only.
4. **Work.** `startProgress()` (→ `in_progress`) and `markReadyForConfirmation()` (→ `pending_confirmation`) are **provider-only** — this closes a direct-call IDOR where a requester could otherwise drive the workflow.
5. **Dual-party confirmation.** Both parties confirm hours via `confirmCompletion()`. Confirmed hours are clamped to the configured variance band around `proposed_hours` (`max_hour_variance_percent`, default 25%). The exchange row is locked for the whole confirmation to prevent concurrent-confirmation races.
6. **Completion or dispute** (`processConfirmations()`):
   - Hours agree (difference `< 0.01`) → complete at that figure.
   - Hours differ but within `0.25` h tolerance → complete at the average.
   - Hours differ by more than the tolerance → **`disputed`**; both parties are emailed in their own locale. A broker/admin resolves the dispute, which completes the exchange (`disputed → completed`).
7. **Completion settles the ledger.** `completeExchange()` → `createTransaction()` performs the credit movement (see invariants) and links `transaction_id` back onto the exchange. Notifications are sent only **after** the financial transaction commits.
8. **Rating.** After `completed`, either party may submit one 1–5 star rating via `ExchangeRatingService::submitRating()`; a second attempt by the same rater is rejected.

Terminal states (`completed`, `cancelled`, `expired`) accept no further transitions.

## Ledger invariants

These invariants hold for credit movements, with the row-level shape differing by path:

- **Double-entry / conservation.** For a **direct transfer** (`WalletService::transfer()`) and a **structured exchange completion** (`ExchangeWorkflowService::createTransaction()`), a movement of `n` hours debits the sender by exactly `n`, credits the receiver by exactly `n`, and writes **one** `transactions` row; net system balance is unchanged. System-originated rows (community fund, admin grant, starting balance) are the deliberate exception and carry a distinct `transaction_type`. **Group exchange settles differently:** `GroupExchangeService::complete()` writes a credit `transactions` row only for provider participants (with `sender_id = organizer_id`) and debits non-provider participants via a guarded conditional `decrement` with no separate ledger row, so per-row debit==credit does not hold for the group path — the whole settlement is balanced across participants and runs atomically in one `DB::transaction`.
- **Atomicity.** The balance updates and the ledger insert run inside a single `DB::transaction(...)`. On any failure the whole movement rolls back — no partial debit, no orphan ledger row. In exchange completion the financial transaction is isolated from notifications: notifications run *outside* the DB transaction so a notification failure can never roll back a credit transfer.
- **Row locking & deadlock avoidance.** `WalletService::transfer()` locks both user rows with `lockForUpdate()` in ascending id order (min id, then max id) so two members transferring to each other simultaneously cannot deadlock. Exchange and group completion likewise lock the rows they mutate.
- **No negative balances.** Every debit path re-reads the sender's balance under lock and aborts if `balance < amount`. The group-exchange debit uses a conditional `where('balance', '>=', $hours)->decrement(...)` and throws if zero rows are affected.
- **Precision is preserved.** Splits are rounded to 2 decimal places, never truncated to integer (truncating once caused 3×3.33 h to credit 9 h while debiting 10 h).

## Money column precision

| Column | Type | Notes |
| --- | --- | --- |
| `users.balance` | `decimal(10,2)` | Member wallet balance. |
| `transactions.amount` | `decimal(10,2)` | Ledger amount. |
| `exchange_requests.proposed_hours` | `decimal(5,2)` | |
| `exchange_requests.requester_confirmed_hours` / `provider_confirmed_hours` / `final_hours` | `decimal(5,2)` | |
| `org_wallets.balance` | `decimal(10,2)` | Separate organisation wallet subsystem. |

All credit amounts are `decimal(10,2)` — fractional credits are first-class. `WalletService::transfer()` rejects amounts with more than 2 decimal places and caps a single transfer at 1000 hours.

> Note: the `nexus_test` database may type `balance`/`amount` as integers, which is why several money tests use whole-hour amounts. Production and the schema dump (`database/schema/mysql-schema.sql`) use `decimal(10,2)`.

## Idempotency (duplicate-submit guard on transfers)

`WalletService::transfer()` carries an explicit anti-double-submit guard (re-implemented from the federation "H6" pattern). The row lock alone prevents over-spend below zero but **not** duplicate *intent*: a double-click or network retry of a well-funded amount would otherwise create two real, legitimate-looking debits.

How it works:

1. A fingerprint is computed for the request:
   - If a client **`Idempotency-Key`** is supplied, the fingerprint is `sha1('key:' . key)` with a **24-hour** window. `WalletController::transfer()` accepts the key from the `Idempotency-Key` **HTTP header** or an `idempotency_key` body field.
   - Otherwise a **content fingerprint** (`receiver | amount | description`) is used with a **120-second** window, so an accidental double-click is still caught without a client key.
2. The fingerprint is claimed atomically with `Cache::add(...)` (tenant + sender scoped).
3. On a **duplicate** within the window: if the original transaction already committed, the service **replays** it — it returns the *same* transaction and does **not** debit again. If the twin is still in flight, the duplicate is rejected (`Duplicate transfer ignored`) rather than risk a double debit.
4. On **failure** of the underlying transfer, the claim is released so a legitimate retry of a *failed* transfer is not blocked.
5. The guard **fails open** on any cache error — cache flakiness must never block a legitimate transfer.

Note this guard is specific to `WalletService::transfer()` (the direct member-to-member path). Exchange completion and group completion rely instead on locked, status-predicated updates to make double-completion a no-op.

## Tenant scoping & cross-tenant transactions

All native wallet/exchange queries filter by the active tenant. Inbound **federation** transactions (from external partners) live in `federation_transactions` and are surfaced read-only in wallet history with synthetic negative ids and a `source: 'federation'` marker; they are credited by the federation webhook handler and are scoped by `receiver_tenant_id`.

> **This inflow is built and dormant — no external partner is crediting wallets today.** The handler is `FederationExternalWebhookController::receive`, whose route (`routes/api.php:3585`) carries the `federation.external:webhooks` middleware. External federation is off by default and has been off in production since 2026-07-27, so `EnsureExternalFederationEnabled` answers every request with HTTP 503 + `Retry-After` and code `FEDERATION_EXTERNAL_DISABLED` before the controller executes. Treat `federation_transactions` as a historical/latent table when reasoning about ledger integrity or reconciliation, not as live traffic. Internal cross-tenant transactions are a different, live mechanism.

## TransactionCompleted side effects

`WalletService::transfer()` dispatches `App\Events\TransactionCompleted` after the transfer commits. Per `EventServiceProvider`, this fans out to:

- `UpdateWalletBalance` — **XP awards + badge checks only** (the balance itself is already updated in the transfer; despite the class name this listener does not move money). It is queued, runs `tries = 1`, and is idempotent: a per-transaction cache claim suppresses duplicate deliveries, backed by a unique index on `user_xp_log`.
- `NotifyTransactionCompleted` — recipient notification.
- `PushTransactionToFederatedPartner` — federation push.

Exchange and group completions write their `transactions` rows directly and do not all flow through `WalletService::transfer()`, so do not assume `TransactionCompleted` fires for every ledger row.

## Failure modes & recovery

| Failure | How it is handled |
| --- | --- |
| **Insufficient balance** (transfer) | Re-checked under row lock; throws `Insufficient balance`. No ledger row, no balance change. |
| **Insufficient balance** (exchange completion) | `createTransaction()` throws the typed `INSUFFICIENT_BALANCE`; the surrounding `DB::transaction` rolls back so no credits move and the counterparty's confirmation is preserved. The confirm endpoint returns a 4xx rather than a generic 500. |
| **Insufficient balance** (group exchange) | Conditional debit affects 0 rows → throws; the whole completion (all participants) rolls back. |
| **Concurrent transfer / self-deadlock** | Both user rows locked in ascending-id order. |
| **Concurrent / double completion** | The exchange row is locked and status-predicated; a second completer becomes a no-op. Group completion claims the row with a `whereNotIn(status, ['completed','cancelled'])` update first; a losing racer credits no one. |
| **Double-submit transfer** | Idempotency guard replays the original (one debit) — see above. |
| **Invalid state transition** | `updateStatus()` rejects transitions not in `TRANSITIONS`. |
| **Self / banned / inactive recipient** | Rejected before any movement. |
| **Notification / email failure** | Caught and logged; never rolls back a committed financial transaction (notifications run after commit). |

Recovery: ledger movements are atomic, so a failed operation leaves no partial state — retry the operation. For a stuck exchange, inspect `exchange_history` for the last valid transition and the `status` enum to see what transition is allowed next.

## Security & privacy invariants

- Never move credits outside a `DB::transaction` with the relevant rows locked.
- Every `UPDATE`/`DELETE` on `transactions`, `exchange_requests`, and `users.balance` must include `tenant_id`.
- Provider-only workflow steps (`start`, `markReadyForConfirmation`) must stay provider-gated to prevent IDOR.
- Transaction history honours `deleted_for_sender` / `deleted_for_receiver` soft-hide flags per side.
- Cancellation by a non-party requires broker/admin privileges (`cancelExchange()` throws `UNAUTHORIZED` otherwise).

## Test commands & key regression tests

Run the backend suites (run heavy suites one at a time):

```bash
vendor/bin/phpunit --testsuite=Laravel,LaravelMigrated --colors=always
```

Targeted runs:

```bash
vendor/bin/phpunit tests/Laravel/Feature/Services/WalletServiceDoubleSubmitTest.php
vendor/bin/phpunit tests/Laravel/Integration/ExchangeWorkflowTest.php
```

Important regression tests:

| Test | What it locks down |
| --- | --- |
| `tests/Laravel/Feature/Services/WalletServiceDoubleSubmitTest.php` | One debit per double-submit (with key and content fingerprint); distinct keys are not collapsed; a failed transfer releases its claim so a funded retry succeeds. |
| `tests/Laravel/Feature/Services/WalletServiceFractionalTest.php` | Fractional (`decimal(10,2)`) credit handling. |
| `tests/Laravel/Feature/Services/WalletServiceEdgeCasesTest.php`, `WalletServiceTest.php` | Insufficient balance, self-transfer, recipient resolution, caps. |
| `tests/Laravel/Integration/ExchangeWorkflowTest.php` | Full lifecycle incl. confirmation, completion, and dispute path. |
| `tests/Laravel/Unit/Services/ExchangeWorkflowServiceTest.php` | State-machine transitions and broker-approval branching. |
| `tests/Laravel/Feature/Services/GroupExchangeServiceTest.php`, `tests/Laravel/Feature/Controllers/GroupExchangeControllerTest.php` | Atomic multi-participant settlement, split precision, double-complete no-op. |
| `tests/Laravel/Unit/Services/ExchangeRatingServiceTest.php` | One rating per rater, range validation, participant check. |
| `tests/Laravel/Unit/Listeners/UpdateWalletBalanceTest.php` | XP/badge side effects are idempotent on re-delivery. |
| `tests/Laravel/Feature/Federation/FederationV2InternalTransferTest.php` | Money conservation + atomicity on the federation transfer path (origin of the idempotency pattern). |

## Related references

- [ARCHITECTURE.md](../ARCHITECTURE.md) — runtime boundaries.
- [MODULES.md](../MODULES.md) — module map and guide checklist.
- [`routes/api.php`](../../routes/api.php) — authoritative endpoint list (do not duplicate here).
- Federation: [FEDERATION_API_MANUAL.md](../FEDERATION_API_MANUAL.md) for cross-platform transfers.
