// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Manages subscription plans and member subscriptions.
/// </summary>
public class SubscriptionService
{
    private readonly NexusDbContext _db;

    public SubscriptionService(NexusDbContext db) => _db = db;

    public async Task<List<SubscriptionPlan>> ListPlansAsync(int tenantId, bool adminView = false)
        => await _db.SubscriptionPlans
            .Where(p => p.TenantId == tenantId && (adminView || (p.IsActive && p.IsPublic)))
            .OrderBy(p => p.Price)
            .ToListAsync();

    public async Task<SubscriptionPlan?> GetPlanAsync(int tenantId, int planId)
        => await _db.SubscriptionPlans.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Id == planId);

    public async Task<(SubscriptionPlan?, string?)> CreatePlanAsync(
        int tenantId, string name, string? description, decimal price, string currency,
        int maxMembers, int maxListings, int maxExchanges, string[] features)
    {
        var plan = new SubscriptionPlan
        {
            TenantId = tenantId,
            Name = name,
            Description = description,
            Price = price,
            Currency = currency,
            MaxMembers = maxMembers,
            MaxListings = maxListings,
            MaxExchangesPerMonth = maxExchanges,
            Features = System.Text.Json.JsonSerializer.Serialize(features)
        };
        _db.SubscriptionPlans.Add(plan);
        await _db.SaveChangesAsync();
        return (plan, null);
    }

    public async Task<(SubscriptionPlan?, string?)> UpdatePlanAsync(
        int tenantId, int planId, string? name, string? description, decimal? price, bool? isActive, bool? isPublic)
    {
        var plan = await GetPlanAsync(tenantId, planId);
        if (plan == null) return (null, "Plan not found");
        if (name != null) plan.Name = name;
        if (description != null) plan.Description = description;
        if (price.HasValue) plan.Price = price.Value;
        if (isActive.HasValue) plan.IsActive = isActive.Value;
        if (isPublic.HasValue) plan.IsPublic = isPublic.Value;
        plan.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return (plan, null);
    }

    public async Task<(bool, string?)> DeletePlanAsync(int tenantId, int planId)
    {
        // Use serializable transaction to prevent TOCTOU race:
        // without it, a subscriber could be assigned between the AnyAsync check and Remove
        await using var transaction = await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        try
        {
            var plan = await _db.SubscriptionPlans.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Id == planId);
            if (plan == null)
            {
                await transaction.RollbackAsync();
                return (false, "Plan not found");
            }
            var hasActive = await _db.UserSubscriptions.AnyAsync(s => s.PlanId == planId && s.Status == SubscriptionStatus.Active);
            if (hasActive)
            {
                await transaction.RollbackAsync();
                return (false, "Plan has active subscribers");
            }
            _db.SubscriptionPlans.Remove(plan);
            await _db.SaveChangesAsync();
            await transaction.CommitAsync();
            return (true, null);
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync();
            return (false, "Failed to delete plan. Please try again.");
        }
    }

    public async Task<UserSubscription?> GetUserSubscriptionAsync(int tenantId, int userId)
        => await _db.UserSubscriptions
            .Include(s => s.Plan)
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.UserId == userId && s.Status == SubscriptionStatus.Active);

    public async Task<(UserSubscription?, string?)> AssignPlanAsync(int tenantId, int userId, int planId)
    {
        // Wrap in transaction to prevent concurrent requests creating duplicate active subscriptions
        await using var transaction = await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        try
        {
            var plan = await _db.SubscriptionPlans.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Id == planId);
            if (plan == null || !plan.IsActive)
            {
                await transaction.RollbackAsync();
                return (null, "Plan not found or inactive");
            }
            var existing = await _db.UserSubscriptions
                .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.UserId == userId && s.Status == SubscriptionStatus.Active);
            if (existing != null)
            {
                existing.Status = SubscriptionStatus.Cancelled;
                existing.CancelledAt = DateTime.UtcNow;
            }
            var sub = new UserSubscription
            {
                TenantId = tenantId,
                UserId = userId,
                PlanId = planId,
                StartedAt = DateTime.UtcNow,
                NextBillingDate = DateTime.UtcNow.AddMonths(1)
            };
            _db.UserSubscriptions.Add(sub);
            await _db.SaveChangesAsync();
            await transaction.CommitAsync();
            await _db.Entry(sub).Reference(s => s.Plan).LoadAsync();
            return (sub, null);
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync();
            return (null, "Failed to assign plan. Please try again.");
        }
    }

    public async Task<(bool, string?)> CancelSubscriptionAsync(int tenantId, int userId)
    {
        var sub = await GetUserSubscriptionAsync(tenantId, userId);
        if (sub == null) return (false, "No active subscription");
        sub.Status = SubscriptionStatus.Cancelled;
        sub.CancelledAt = DateTime.UtcNow;
        sub.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return (true, null);
    }

    public async Task<(List<UserSubscription>, int)> ListSubscriptionsAsync(int tenantId, int page, int limit)
    {
        var q = _db.UserSubscriptions.Include(s => s.User).Include(s => s.Plan)
            .Where(s => s.TenantId == tenantId).OrderByDescending(s => s.CreatedAt);
        var total = await q.CountAsync();
        var items = await q.Skip((page - 1) * limit).Take(limit).ToListAsync();
        return (items, total);
    }

    public async Task<List<UserSubscription>> GetExpiringSubscriptionsAsync(int tenantId, int daysAhead)
    {
        var cutoff = DateTime.UtcNow.AddDays(daysAhead);
        return await _db.UserSubscriptions.Include(s => s.User).Include(s => s.Plan)
            .Where(s => s.TenantId == tenantId && s.Status == SubscriptionStatus.Active && s.ExpiresAt <= cutoff)
            .OrderBy(s => s.ExpiresAt)
            .ToListAsync();
    }
}
