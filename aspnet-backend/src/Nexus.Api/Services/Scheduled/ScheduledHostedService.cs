// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services.Scheduled;

/// <summary>Observable outcome from one scheduled or manual execution attempt.</summary>
public enum ScheduledJobExecutionOutcome
{
    Success,
    Failed,
    Busy,
    Disabled,
    Cancelled
}

/// <summary>
/// Result returned by the public manual-execution seam. The persisted run id
/// and <c>Persisted</c> flag prevent callers from claiming an outcome
/// that could not be written to the operational run log.
/// </summary>
public sealed record ScheduledJobExecutionResult(
    string JobName,
    ScheduledJobExecutionOutcome Outcome,
    int? RunRecordId,
    DateTime StartedAt,
    DateTime CompletedAt,
    TimeSpan Elapsed,
    string Output,
    string? ErrorType,
    bool Persisted);

/// <summary>
/// Base class for scheduled background jobs (Phase 63 — V1 cron task port).
///
/// V1 ran 5 Job classes + 39 Laravel scheduled commands via Laravel's
/// kernel. V2 had only one BackgroundService prior to this phase. This class
/// provides a uniform pattern for all subsequent ports:
///
///  - Configurable interval via appsettings: <c>Scheduled:{JobName}:IntervalMinutes</c>
///    and a kill-switch <c>Scheduled:{JobName}:Enabled</c> (default true).
///  - Iterates every active tenant for tenant-scoped work.
///  - Catches per-tenant failures so one bad tenant does not stall the loop.
///  - Logs structured start / finish / per-tenant failure events.
/// </summary>
public abstract class ScheduledHostedService : BackgroundService
{
    protected readonly IServiceScopeFactory ScopeFactory;
    protected readonly IConfiguration Configuration;
    protected readonly ILogger Logger;
    private readonly SemaphoreSlim _executionGate = new(1, 1);

    private enum ExecutionTrigger
    {
        Scheduled,
        Manual
    }

    protected ScheduledHostedService(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger logger)
    {
        ScopeFactory = scopeFactory;
        Configuration = configuration;
        Logger = logger;
    }

    /// <summary>Short, log-safe identifier (e.g. "SyncFederationPartners").</summary>
    protected abstract string JobName { get; }

    /// <summary>
    /// Public accessor so the admin observability endpoint can enumerate the
    /// registered job set without using reflection on a protected member.
    /// </summary>
    public string Name => JobName;

    /// <summary>Public accessor for the configured/default interval.</summary>
    public TimeSpan ResolvedInterval
    {
        get
        {
            var configuredMinutes = Configuration.GetValue<double?>($"Scheduled:{JobName}:IntervalMinutes");
            return configuredMinutes.HasValue && configuredMinutes.Value > 0
                ? TimeSpan.FromMinutes(configuredMinutes.Value)
                : DefaultInterval;
        }
    }

    /// <summary>True if the job is enabled (kill-switch off).</summary>
    public bool IsEnabled =>
        Configuration.GetValue<bool?>($"Scheduled:{JobName}:Enabled") ?? true;

    /// <summary>Default interval if none configured. Pick something sensible per job.</summary>
    protected abstract TimeSpan DefaultInterval { get; }

    /// <summary>
    /// Resolve the delay after a completed run. Interval-based jobs use the
    /// configured/default interval; calendar-aligned jobs may override this
    /// while still respecting an explicit interval override.
    /// </summary>
    protected virtual TimeSpan DelayAfterRun(TimeSpan resolvedInterval) => resolvedInterval;

    /// <summary>
    /// Initial delay before the first run, to avoid all jobs firing at startup.
    /// Default: 30 seconds. Override per-job to spread load.
    /// </summary>
    protected virtual TimeSpan StartupDelay => TimeSpan.FromSeconds(30);

    /// <summary>
    /// True if this job iterates per-tenant. Default true. Override and return
    /// false for global jobs (e.g. log pruning).
    /// </summary>
    protected virtual bool PerTenant => true;

    /// <summary>Run for one tenant. Implement in subclass.</summary>
    protected virtual Task RunForTenantAsync(IServiceProvider services, int tenantId, CancellationToken ct) =>
        Task.CompletedTask;

    /// <summary>Run once globally (no tenant scope). Override for global jobs.</summary>
    protected virtual Task RunGlobalAsync(IServiceProvider services, CancellationToken ct) =>
        Task.CompletedTask;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Integration hosts need the real registered job instances for manual
        // execution and diagnostics, but starting every natural loop at once
        // creates nondeterministic database traffic against their disposable
        // PostgreSQL container. The switch suppresses only automatic hosted
        // execution; IsEnabled and RunNowAsync retain their normal semantics.
        if (Configuration.GetValue<bool>("BackgroundServices:SuppressAutomaticExecution"))
        {
            Logger.LogInformation(
                "Scheduled job {JobName} automatic execution suppressed by configuration",
                JobName);
            return;
        }

        // Resolve the singleton registry once (it's optional so existing tests
        // that build the host without registering it keep working).
        var registry = TryGetRegistry();

        var enabled = Configuration.GetValue<bool?>($"Scheduled:{JobName}:Enabled") ?? true;
        if (!enabled)
        {
            Logger.LogInformation("Scheduled job {JobName} disabled via Scheduled:{JobName}:Enabled=false", JobName, JobName);
            registry?.RecordDisabled(JobName);
            return;
        }

        var configuredMinutes = Configuration.GetValue<double?>($"Scheduled:{JobName}:IntervalMinutes");
        var interval = configuredMinutes.HasValue && configuredMinutes.Value > 0
            ? TimeSpan.FromMinutes(configuredMinutes.Value)
            : DefaultInterval;

        Logger.LogInformation(
            "Scheduled job {JobName} starting. Interval={Interval}. PerTenant={PerTenant}",
            JobName, interval, PerTenant);

        try
        {
            await Task.Delay(StartupDelay, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            var result = await ExecuteSingleRunAsync(ExecutionTrigger.Scheduled, stoppingToken);
            if (result.Outcome == ScheduledJobExecutionOutcome.Cancelled && stoppingToken.IsCancellationRequested)
                break;

            try
            {
                await Task.Delay(DelayAfterRun(interval), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        Logger.LogInformation("Scheduled job {JobName} stopped", JobName);
    }

    /// <summary>
    /// Execute the same job body used by the natural hosted-service loop.
    /// A concurrent attempt returns Busy immediately instead of queueing a
    /// duplicate run behind work that is already in progress.
    /// </summary>
    public Task<ScheduledJobExecutionResult> RunNowAsync(CancellationToken ct = default) =>
        ExecuteSingleRunAsync(ExecutionTrigger.Manual, ct);

    private async Task<ScheduledJobExecutionResult> ExecuteSingleRunAsync(
        ExecutionTrigger trigger,
        CancellationToken ct)
    {
        var startedAt = DateTime.UtcNow;
        var triggerName = trigger == ExecutionTrigger.Manual ? "manual" : "scheduled";
        var registry = TryGetRegistry();

        if (!IsEnabled)
        {
            registry?.RecordDisabled(JobName);
            return await RecordSkippedAttemptAsync(
                ScheduledJobExecutionOutcome.Disabled,
                startedAt,
                $"{JobName} is disabled and was not executed.",
                "JobDisabled");
        }

        bool acquired;
        try
        {
            acquired = await _executionGate.WaitAsync(0, ct);
        }
        catch (OperationCanceledException)
        {
            return await RecordSkippedAttemptAsync(
                ScheduledJobExecutionOutcome.Cancelled,
                startedAt,
                $"{JobName} {triggerName} run was cancelled before execution.",
                nameof(OperationCanceledException));
        }

        if (!acquired)
        {
            Logger.LogWarning(
                "Scheduled job {JobName} {Trigger} run skipped because another execution is active",
                JobName,
                triggerName);
            return await RecordSkippedAttemptAsync(
                ScheduledJobExecutionOutcome.Busy,
                startedAt,
                $"{JobName} is already running; the {triggerName} attempt was not executed.",
                "JobAlreadyRunning");
        }

        try
        {
            registry?.RecordStart(JobName);
            var runId = await BeginRunRecordAsync(startedAt, ct);
            if (trigger == ExecutionTrigger.Manual && runId is null)
            {
                var persistenceError = new InvalidOperationException(
                    $"Could not persist the start of manual scheduled job {JobName}.");
                registry?.RecordFailure(JobName, persistenceError);
                var failedAt = DateTime.UtcNow;
                return new ScheduledJobExecutionResult(
                    JobName,
                    ScheduledJobExecutionOutcome.Failed,
                    null,
                    startedAt,
                    failedAt,
                    failedAt - startedAt,
                    persistenceError.Message,
                    "ScheduledJobRunPersistenceError",
                    false);
            }

            try
            {
                await RunOnceAsync(ct);
                var completedAt = DateTime.UtcNow;
                var elapsed = completedAt - startedAt;
                var output = $"{JobName} {triggerName} run completed successfully.";
                Logger.LogInformation(
                    "Scheduled job {JobName} {Trigger} run completed in {ElapsedMs}ms",
                    JobName,
                    triggerName,
                    elapsed.TotalMilliseconds);
                registry?.RecordSuccess(JobName, elapsed);
                var persisted = await CompleteRunRecordAsync(
                    runId,
                    ScheduledJobRunStatus.Success,
                    elapsed,
                    output,
                    null,
                    CancellationToken.None);

                return new ScheduledJobExecutionResult(
                    JobName,
                    ScheduledJobExecutionOutcome.Success,
                    runId,
                    startedAt,
                    completedAt,
                    elapsed,
                    output,
                    null,
                    persisted);
            }
            catch (OperationCanceledException ex)
            {
                var completedAt = DateTime.UtcNow;
                var elapsed = completedAt - startedAt;
                var output = $"{JobName} {triggerName} run was cancelled before completion.";
                Logger.LogWarning(ex, "Scheduled job {JobName} {Trigger} run was cancelled", JobName, triggerName);
                registry?.RecordFailure(JobName, ex);
                var persisted = await CompleteRunRecordAsync(
                    runId,
                    ScheduledJobRunStatus.Skipped,
                    elapsed,
                    output,
                    nameof(OperationCanceledException),
                    CancellationToken.None);

                return new ScheduledJobExecutionResult(
                    JobName,
                    ScheduledJobExecutionOutcome.Cancelled,
                    runId,
                    startedAt,
                    completedAt,
                    elapsed,
                    output,
                    nameof(OperationCanceledException),
                    persisted);
            }
            catch (Exception ex)
            {
                var completedAt = DateTime.UtcNow;
                var elapsed = completedAt - startedAt;
                var output = $"{JobName} {triggerName} run failed: {ex.Message}";
                Logger.LogError(ex, "Scheduled job {JobName} {Trigger} run failed", JobName, triggerName);
                CaptureScheduledException(ex, triggerName);
                registry?.RecordFailure(JobName, ex);
                var persisted = await CompleteRunRecordAsync(
                    runId,
                    ScheduledJobRunStatus.Failed,
                    elapsed,
                    output,
                    ex.GetType().Name,
                    CancellationToken.None);

                return new ScheduledJobExecutionResult(
                    JobName,
                    ScheduledJobExecutionOutcome.Failed,
                    runId,
                    startedAt,
                    completedAt,
                    elapsed,
                    output,
                    ex.GetType().Name,
                    persisted);
            }
        }
        finally
        {
            _executionGate.Release();
        }
    }

    private async Task<ScheduledJobExecutionResult> RecordSkippedAttemptAsync(
        ScheduledJobExecutionOutcome outcome,
        DateTime startedAt,
        string output,
        string errorType)
    {
        var runId = await BeginRunRecordAsync(startedAt, CancellationToken.None);
        var completedAt = DateTime.UtcNow;
        var elapsed = completedAt - startedAt;
        var persisted = await CompleteRunRecordAsync(
            runId,
            ScheduledJobRunStatus.Skipped,
            elapsed,
            output,
            errorType,
            CancellationToken.None);

        return new ScheduledJobExecutionResult(
            JobName,
            outcome,
            runId,
            startedAt,
            completedAt,
            elapsed,
            output,
            errorType,
            persisted);
    }

    private void CaptureScheduledException(Exception ex, string triggerName)
    {
        try
        {
            Sentry.SentrySdk.CaptureException(ex, scope =>
            {
                scope.SetTag("job_name", JobName);
                scope.SetTag("source", "scheduled_hosted_service");
                scope.SetTag("trigger", triggerName);
            });
        }
        catch
        {
            // Sentry may throw when uninitialized; never fail the worker loop.
        }
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        using var scope = ScopeFactory.CreateScope();
        if (!PerTenant)
        {
            await RunGlobalAsync(scope.ServiceProvider, ct);
            return;
        }

        // Iterate every tenant. We use a dedicated scope per tenant so that the
        // scoped TenantContext + DbContext are fresh and don't bleed.
        var bootstrapDb = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
        var tenantIds = await GetActiveTenantIdsAsync(bootstrapDb, ct);
        var failures = new List<Exception>();

        foreach (var tenantId in tenantIds)
        {
            if (ct.IsCancellationRequested) break;
            using var tenantScope = ScopeFactory.CreateScope();
            try
            {
                var tenantContext = tenantScope.ServiceProvider.GetRequiredService<TenantContext>();
                tenantContext.SetTenant(tenantId);
                await RunForTenantAsync(tenantScope.ServiceProvider, tenantId, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                Logger.LogWarning(
                    ex,
                    "Scheduled job {JobName} failed for tenant {TenantId} — continuing with next tenant",
                    JobName, tenantId);
                failures.Add(new InvalidOperationException(
                    $"Scheduled job {JobName} failed for tenant {tenantId}: {ex.Message}",
                    ex));
            }
        }

        ct.ThrowIfCancellationRequested();
        if (failures.Count > 0)
            throw new AggregateException($"Scheduled job {JobName} failed for {failures.Count} tenant(s).", failures);
    }

    private static async Task<List<int>> GetActiveTenantIdsAsync(NexusDbContext db, CancellationToken ct)
    {
        // Tenants are not tenant-scoped themselves — read directly.
        return await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.ToListAsync(
            db.Tenants.Where(t => t.IsActive).Select(t => t.Id), ct);
    }

    /// <summary>
    /// Insert a Running row at the start of a tick. Returns the row id so the
    /// completion handler can update the same row. Returns null if the write
    /// fails (e.g. DB unavailable) — observability must never block job work.
    /// </summary>
    private async Task<int?> BeginRunRecordAsync(DateTime startedAt, CancellationToken ct)
    {
        try
        {
            using var scope = ScopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var run = new ScheduledJobRun
            {
                JobName = JobName,
                StartedAt = startedAt,
                Status = ScheduledJobRunStatus.Running
            };
            db.ScheduledJobRuns.Add(run);
            await db.SaveChangesAsync(ct);
            return run.Id;
        }
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Could not write start row for scheduled job {JobName}", JobName);
            return null;
        }
    }

    private async Task<bool> CompleteRunRecordAsync(
        int? runId,
        ScheduledJobRunStatus status,
        TimeSpan elapsed,
        string? output,
        string? errorType,
        CancellationToken ct)
    {
        if (runId is null) return false;
        try
        {
            using var scope = ScopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<NexusDbContext>();
            var run = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions
                .FirstOrDefaultAsync(db.ScheduledJobRuns, r => r.Id == runId.Value, ct);
            if (run is null) return false;
            run.Status = status;
            run.CompletedAt = DateTime.UtcNow;
            run.DurationMs = elapsed.TotalMilliseconds;
            if (!string.IsNullOrEmpty(output))
                run.ErrorMessage = output.Length <= 2000 ? output : output[..2000];
            run.ErrorType = errorType;
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Could not write completion row for scheduled job {JobName}", JobName);
            return false;
        }
    }

    /// <summary>
    /// Resolve the singleton registry without throwing if it isn't registered
    /// (some test hosts skip it). Logs a warning once on the first miss so
    /// production misconfigurations are surfaced.
    /// </summary>
    private ScheduledJobsRegistry? TryGetRegistry()
    {
        try
        {
            using var scope = ScopeFactory.CreateScope();
            return scope.ServiceProvider.GetService<ScheduledJobsRegistry>();
        }
        catch
        {
            return null;
        }
    }
}
