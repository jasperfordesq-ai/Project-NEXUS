// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;
using Nexus.Contracts.Events;
using Nexus.Messaging;

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin controller - tenant-scoped administrative operations.
/// Requires "admin" role for all endpoints.
/// </summary>
[ApiController]
[Route("api/admin")]
[Route("api/v2/admin")]
[Authorize(Policy = "AdminOnly")]
public class AdminController : ControllerBase
{
    private const string AdminUserRolesKeyPrefix = "admin.user_roles.";

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly IEventPublisher _eventPublisher;
    private readonly ILogger<AdminController> _logger;
    private readonly CacheService _cache;
    private readonly FileUploadService _fileUploadService;

    public AdminController(
        NexusDbContext db,
        TenantContext tenantContext,
        IEventPublisher eventPublisher,
        ILogger<AdminController> logger,
        CacheService cache,
        FileUploadService fileUploadService)
    {
        _db = db;
        _tenantContext = tenantContext;
        _eventPublisher = eventPublisher;
        _logger = logger;
        _cache = cache;
        _fileUploadService = fileUploadService;
    }

    private int? GetCurrentUserId() => User.GetUserId();
    private bool IsLaravelV2Request => Request.Path.StartsWithSegments("/api/v2");

    private IActionResult LaravelData(object data) => Ok(new
    {
        data,
        meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
    });

    private IActionResult LaravelError(string code, string message, int status)
    {
        var payload = new { errors = new[] { new { code, message } } };
        return status switch
        {
            StatusCodes.Status400BadRequest => BadRequest(payload),
            StatusCodes.Status403Forbidden => StatusCode(StatusCodes.Status403Forbidden, payload),
            StatusCodes.Status404NotFound => NotFound(payload),
            StatusCodes.Status422UnprocessableEntity => UnprocessableEntity(payload),
            _ => StatusCode(status, payload)
        };
    }

    private IActionResult LaravelValidationError(string message, string field)
        => UnprocessableEntity(new
        {
            errors = new[] { new { code = "VALIDATION_ERROR", message, field } }
        });

    private string FormatAdminUserStatus(User user)
    {
        if (user.IsActive && user.SuspendedAt == null) return "active";
        if (user.SuspendedAt != null && (user.SuspensionReason?.Contains("ban", StringComparison.OrdinalIgnoreCase) ?? false)) return "banned";
        if (user.SuspendedAt != null) return "suspended";
        return "pending";
    }

    private object MapLaravelAdminUser(
        User user,
        int listingCount = 0,
        IReadOnlyCollection<string>? assignedRoles = null,
        bool includeDetailFlags = true)
    {
        var payload = new Dictionary<string, object?>
        {
            ["id"] = user.Id,
            ["name"] = $"{user.FirstName} {user.LastName}".Trim(),
            ["first_name"] = user.FirstName,
            ["last_name"] = user.LastName,
            ["email"] = user.Email,
            ["avatar_url"] = user.AvatarUrl,
            ["location"] = null,
            ["bio"] = user.Bio,
            ["tagline"] = null,
            ["phone"] = null,
            ["role"] = user.Role,
            ["status"] = FormatAdminUserStatus(user),
            // Laravel's list resource exposes only these two raw flags.
            ["is_super_admin"] = user.IsSuperAdmin,
            ["is_tenant_super_admin"] = user.IsTenantSuperAdmin
        };

        // Laravel show/update adds raw god plus its role-derived is_admin field.
        if (includeDetailFlags)
        {
            payload["is_god"] = user.IsGod;
            payload["is_admin"] = user.Role is "admin" or "tenant_admin";
        }

        payload["balance"] = 0m;
        payload["listing_count"] = listingCount;
        payload["profile_type"] = "individual";
        payload["organization_name"] = null;
        payload["tenant_id"] = user.TenantId;
        payload["tenant_name"] = user.Tenant?.Name ?? "Unknown";
        payload["has_2fa_enabled"] = user.TwoFactorEnabled;
        payload["is_approved"] = user.IsActive;
        payload["email_verified_at"] = user.EmailVerifiedAt;
        payload["is_verified"] = user.EmailVerified;
        payload["vetting_status"] = "none";
        payload["insurance_status"] = "none";
        payload["created_at"] = user.CreatedAt;
        payload["last_active_at"] = user.LastLoginAt;
        payload["last_login_at"] = user.LastLoginAt;
        payload["onboarding_completed"] = true;
        payload["badges"] = Array.Empty<object>();
        payload["roles"] = assignedRoles ?? Array.Empty<string>();
        return payload;
    }

    private async Task<Dictionary<int, string[]>> LoadAssignedRolesAsync(IEnumerable<int> userIds)
    {
        var ids = userIds.Distinct().ToArray();
        if (ids.Length == 0)
        {
            return new Dictionary<int, string[]>();
        }

        var keys = ids.Select(id => AdminUserRolesKeyPrefix + id).ToArray();
        var rows = await _db.TenantConfigs
            .AsNoTracking()
            .Where(config => keys.Contains(config.Key))
            .Select(config => new { config.Key, config.Value })
            .ToListAsync();

        return rows
            .Select(row => new
            {
                UserId = ParseUserRolesKey(row.Key),
                Roles = ParseAssignedRoles(row.Value)
            })
            .Where(row => row.UserId > 0)
            .ToDictionary(row => row.UserId, row => row.Roles);
    }

    private async Task<string[]> LoadAssignedRolesAsync(int userId)
    {
        var roles = await LoadAssignedRolesAsync(new[] { userId });
        return roles.GetValueOrDefault(userId, Array.Empty<string>());
    }

    private static int ParseUserRolesKey(string key)
    {
        return key.StartsWith(AdminUserRolesKeyPrefix, StringComparison.OrdinalIgnoreCase)
            && int.TryParse(key[AdminUserRolesKeyPrefix.Length..], out var userId)
            ? userId
            : 0;
    }

    private static string[] ParseAssignedRoles(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return Array.Empty<string>();
        }

        try
        {
            return JsonSerializer.Deserialize<List<string>>(raw)?
                .Where(role => !string.IsNullOrWhiteSpace(role))
                .Select(role => role.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(role => role, StringComparer.OrdinalIgnoreCase)
                .ToArray() ?? Array.Empty<string>();
        }
        catch (JsonException)
        {
            return Array.Empty<string>();
        }
    }

    #region Dashboard

    /// <summary>
    /// Get admin dashboard metrics.
    /// Optimized to use batched queries for better performance.
    /// </summary>
    [HttpGet("dashboard")]
    public async Task<IActionResult> GetDashboard()
    {
        var thirtyDaysAgo = DateTime.UtcNow.AddDays(-30);

        // Batch user stats into single query
        var userStats = await _db.Users
            .AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Total = g.Count(),
                Active = g.Count(u => u.IsActive),
                NewLast30Days = g.Count(u => u.CreatedAt >= thirtyDaysAgo)
            })
            .FirstOrDefaultAsync() ?? new { Total = 0, Active = 0, NewLast30Days = 0 };

        // Batch listing stats into single query
        var listingStats = await _db.Listings
            .AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Total = g.Count(),
                Active = g.Count(l => l.Status == ListingStatus.Active),
                Pending = g.Count(l => l.Status == ListingStatus.Pending)
            })
            .FirstOrDefaultAsync() ?? new { Total = 0, Active = 0, Pending = 0 };

        // Batch transaction stats into single query
        var transactionStats = await _db.Transactions
            .AsNoTracking()
            .ExcludeInternalWalletAdapters()
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Total = g.Count(),
                Last30Days = g.Count(t => t.CreatedAt >= thirtyDaysAgo),
                TotalCredits = g.Where(t => t.Status == TransactionStatus.Completed).Sum(t => t.Amount)
            })
            .FirstOrDefaultAsync() ?? new { Total = 0, Last30Days = 0, TotalCredits = 0m };

        // Community stats - sequential to avoid concurrent EF Core operations on same DbContext
        var categoryCount = await _db.Categories.AsNoTracking().CountAsync();
        var groupCount = await _db.Groups.AsNoTracking().CountAsync();
        var eventCount = await _db.Events.AsNoTracking().CountAsync(e => !e.IsCancelled);

        return Ok(new
        {
            users = new
            {
                total = userStats.Total,
                active = userStats.Active,
                suspended = userStats.Total - userStats.Active,
                new_last_30_days = userStats.NewLast30Days
            },
            listings = new
            {
                total = listingStats.Total,
                active = listingStats.Active,
                pending_review = listingStats.Pending
            },
            transactions = new
            {
                total = transactionStats.Total,
                last_30_days = transactionStats.Last30Days,
                total_credits_transferred = transactionStats.TotalCredits
            },
            community = new
            {
                categories = categoryCount,
                groups = groupCount,
                upcoming_events = eventCount
            }
        });
    }

    #endregion

    #region User Management

    /// <summary>
    /// List all users with filtering and pagination.
    /// </summary>
    [HttpGet("users")]
    public async Task<IActionResult> ListUsers(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? role = null,
        [FromQuery] string? status = null,
        [FromQuery] string? search = null,
        [FromQuery] string? sort = null,
        [FromQuery] string? order = null)
    {
        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);
        var skip = (page - 1) * limit;

        var tenantId = _tenantContext.TenantId;
        var query = _db.Users.Include(u => u.Tenant).AsQueryable();

        if (tenantId.HasValue)
        {
            query = query.Where(u => u.TenantId == tenantId.Value);
        }

        if (!string.IsNullOrEmpty(role))
        {
            query = query.Where(u => u.Role == role);
        }

        if (!string.IsNullOrEmpty(status) && !string.Equals(status, "all", StringComparison.OrdinalIgnoreCase))
        {
            query = status.ToLowerInvariant() switch
            {
                "active" => query.Where(u => u.IsActive && u.SuspendedAt == null),
                "pending" => query.Where(u => !u.IsActive && u.SuspendedAt == null),
                "suspended" => query.Where(u => !u.IsActive && u.SuspendedAt != null && (u.SuspensionReason == null || !u.SuspensionReason.ToLower().Contains("ban"))),
                "banned" => query.Where(u => !u.IsActive && u.SuspendedAt != null && u.SuspensionReason != null && u.SuspensionReason.ToLower().Contains("ban")),
                "never_logged_in" => query.Where(u => u.IsActive && u.LastLoginAt == null),
                "onboarding_incomplete" => query.Where(u => !u.IsActive),
                _ => query
            };
        }

        if (!string.IsNullOrEmpty(search))
        {
            var searchLower = search.ToLower();
            var isNumericSearch = int.TryParse(search, out var searchedId);
            query = query.Where(u =>
                u.Email.ToLower().Contains(searchLower) ||
                u.FirstName.ToLower().Contains(searchLower) ||
                u.LastName.ToLower().Contains(searchLower) ||
                (u.FirstName + " " + u.LastName).ToLower().Contains(searchLower) ||
                (isNumericSearch && u.Id == searchedId));
        }

        var total = await query.CountAsync();

        var descending = !string.Equals(order, "asc", StringComparison.OrdinalIgnoreCase);
        query = (sort?.ToLowerInvariant()) switch
        {
            "name" => descending
                ? query.OrderByDescending(u => u.FirstName).ThenByDescending(u => u.LastName)
                : query.OrderBy(u => u.FirstName).ThenBy(u => u.LastName),
            "email" => descending ? query.OrderByDescending(u => u.Email) : query.OrderBy(u => u.Email),
            "role" => descending ? query.OrderByDescending(u => u.Role) : query.OrderBy(u => u.Role),
            "status" => descending ? query.OrderByDescending(u => u.IsActive) : query.OrderBy(u => u.IsActive),
            _ => descending ? query.OrderByDescending(u => u.CreatedAt) : query.OrderBy(u => u.CreatedAt)
        };

        var userEntities = await query
            .Skip(skip)
            .Take(limit)
            .ToListAsync();

        var userIds = userEntities.Select(u => u.Id).ToArray();
        var listingCounts = await _db.Listings
            .Where(l => userIds.Contains(l.UserId) && l.Status == ListingStatus.Active)
            .GroupBy(l => l.UserId)
            .Select(g => new { UserId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.UserId, x => x.Count);

        if (IsLaravelV2Request)
        {
            var assignedRoles = await LoadAssignedRolesAsync(userIds);
            var totalPages = total > 0 ? (int)Math.Ceiling((double)total / limit) : 0;
            return Ok(new
            {
                data = userEntities.Select(u => MapLaravelAdminUser(
                    u,
                    listingCounts.GetValueOrDefault(u.Id),
                    assignedRoles.GetValueOrDefault(u.Id, Array.Empty<string>()),
                    includeDetailFlags: false)).ToArray(),
                meta = new
                {
                    base_url = $"{Request.Scheme}://{Request.Host}",
                    current_page = page,
                    per_page = limit,
                    total,
                    total_pages = totalPages,
                    has_more = page < totalPages
                }
            });
        }

        var users = userEntities
            .Select(u => new
            {
                id = u.Id,
                email = u.Email,
                first_name = u.FirstName,
                last_name = u.LastName,
                role = u.Role,
                is_active = u.IsActive,
                created_at = u.CreatedAt,
                last_login_at = u.LastLoginAt,
                suspended_at = u.SuspendedAt,
                suspension_reason = u.SuspensionReason
            })
            .ToList();

        return Ok(new
        {
            data = users,
            pagination = new
            {
                page,
                limit,
                total,
                pages = (int)Math.Ceiling((double)total / limit)
            }
        });
    }

    /// <summary>
    /// Get user details with activity stats.
    /// </summary>
    [HttpGet("users/{id:int}")]
    public async Task<IActionResult> GetUser(int id)
    {
        var tenantId = _tenantContext.TenantId;
        var query = _db.Users.Include(u => u.Tenant).Where(u => u.Id == id);
        if (tenantId.HasValue)
        {
            query = query.Where(u => u.TenantId == tenantId.Value);
        }

        var userEntity = await query.FirstOrDefaultAsync();

        if (userEntity == null)
        {
            return IsLaravelV2Request
                ? LaravelError("NOT_FOUND", "User not found", StatusCodes.Status404NotFound)
                : NotFound(new { error = "User not found" });
        }

        if (IsLaravelV2Request)
        {
            var v2ListingCount = await _db.Listings.CountAsync(l => l.UserId == id && l.Status == ListingStatus.Active);
            var assignedRoles = await LoadAssignedRolesAsync(id);
            return LaravelData(MapLaravelAdminUser(userEntity, v2ListingCount, assignedRoles));
        }

        var user = await _db.Users
            .Where(u => u.Id == id && (!tenantId.HasValue || u.TenantId == tenantId.Value))
            .Select(u => new
            {
                id = u.Id,
                email = u.Email,
                first_name = u.FirstName,
                last_name = u.LastName,
                role = u.Role,
                is_active = u.IsActive,
                created_at = u.CreatedAt,
                last_login_at = u.LastLoginAt,
                suspended_at = u.SuspendedAt,
                suspension_reason = u.SuspensionReason,
                suspended_by_user_id = u.SuspendedByUserId,
                total_xp = u.TotalXp,
                level = u.Level
            })
            .FirstOrDefaultAsync();

        // Get activity stats
        var listingCount = await _db.Listings.CountAsync(l => l.UserId == id);
        var transactionCount = await _db.Transactions
            .ExcludeInternalWalletAdapters()
            .CountAsync(t => t.SenderId == id || t.ReceiverId == id);
        var connectionCount = await _db.Connections.CountAsync(c =>
            (c.RequesterId == id || c.AddresseeId == id) && c.Status == Connection.Statuses.Accepted);

        return Ok(new
        {
            user,
            stats = new
            {
                listings = listingCount,
                transactions = transactionCount,
                connections = connectionCount
            }
        });
    }

    /// <summary>
    /// Update a user's details (role, name, email).
    /// </summary>
    [HttpPut("users/{id:int}")]
    public async Task<IActionResult> UpdateUser(int id, [FromBody] AdminUpdateUserRequest request)
    {
        var adminUserId = GetCurrentUserId();
        if (adminUserId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.TenantId;
        var user = await _db.Users.Include(u => u.Tenant)
            .FirstOrDefaultAsync(x => x.Id == id && (!tenantId.HasValue || x.TenantId == tenantId.Value));
        if (user == null)
        {
            return IsLaravelV2Request
                ? LaravelError("NOT_FOUND", "User not found", StatusCodes.Status404NotFound)
                : NotFound(new { error = "User not found" });
        }

        // The legacy endpoint keeps its historical self-demotion guard. Laravel
        // v2 permits regular role edits here and reserves privilege flags for
        // the dedicated super-admin toggles.
        if (!IsLaravelV2Request && id == adminUserId && request.Role != null && request.Role != "admin")
        {
            return BadRequest(new { error = "Cannot change your own admin role" });
        }

        // Input validation
        var errors = new List<string>();
        if (request.FirstName != null && request.FirstName.Length > 100)
            errors.Add("FirstName must be 100 characters or less");
        if (request.LastName != null && request.LastName.Length > 100)
            errors.Add("LastName must be 100 characters or less");
        if (request.Email != null && request.Email.Length > 255)
            errors.Add("Email must be 255 characters or less");
        if (errors.Count > 0)
            return BadRequest(new { error = "Validation failed", details = errors });

        var updated = false;

        if (request.Role != null && request.Role != user.Role)
        {
            if (IsLaravelV2Request)
            {
                var allowedRoles = new[] { "member", "admin", "broker" };
                if (!allowedRoles.Contains(request.Role, StringComparer.Ordinal))
                {
                    return LaravelValidationError("Invalid role", "role");
                }
            }
            else if (request.Role != "admin" && request.Role != "member")
            {
                return BadRequest(new { error = "Role must be 'admin' or 'member'" });
            }

            user.Role = request.Role;
            updated = true;
        }

        if (request.FirstName != null && request.FirstName != user.FirstName)
        {
            user.FirstName = request.FirstName.Trim();
            updated = true;
        }

        if (request.LastName != null && request.LastName != user.LastName)
        {
            user.LastName = request.LastName.Trim();
            updated = true;
        }

        if (request.Email != null && request.Email != user.Email)
        {
            // Check for duplicate email
            var emailExists = await _db.Users.AnyAsync(u => u.Email == request.Email && u.Id != id);
            if (emailExists)
            {
                return BadRequest(new { error = "Email already in use" });
            }
            user.Email = request.Email.Trim().ToLower();
            updated = true;
        }

        if (updated)
        {
            await _db.SaveChangesAsync();
            _logger.LogInformation("Admin {AdminId} updated user {UserId}", adminUserId, id);

            await _eventPublisher.PublishAsync(new UserUpdatedEvent
            {
                TenantId = user.TenantId,
                UserId = user.Id,
                Email = user.Email,
                FirstName = user.FirstName,
                LastName = user.LastName,
                Role = user.Role
            });
        }

        if (IsLaravelV2Request)
        {
            var assignedRoles = await LoadAssignedRolesAsync(id);
            return LaravelData(MapLaravelAdminUser(user, assignedRoles: assignedRoles));
        }

        return Ok(new
        {
            success = true,
            message = "User updated",
            user = new
            {
                id = user.Id,
                email = user.Email,
                first_name = user.FirstName,
                last_name = user.LastName,
                role = user.Role,
                is_active = user.IsActive
            }
        });
    }

    /// <summary>
    /// Suspend a user.
    /// </summary>
    [HttpPut("users/{id:int}/suspend")]
    public async Task<IActionResult> SuspendUser(int id, [FromBody] SuspendUserRequest request)
    {
        var adminUserId = GetCurrentUserId();
        if (adminUserId == null) return Unauthorized(new { error = "Invalid token" });

        if (id == adminUserId)
        {
            return BadRequest(new { error = "Cannot suspend yourself" });
        }

        var user = await _db.Users.FirstOrDefaultAsync(x => x.Id == id);
        if (user == null)
        {
            return NotFound(new { error = "User not found" });
        }

        if (!user.IsActive)
        {
            return BadRequest(new { error = "User is already suspended" });
        }

        user.IsActive = false;
        user.SuspendedAt = DateTime.UtcNow;
        user.SuspensionReason = request.Reason;
        user.SuspendedByUserId = adminUserId;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} suspended user {UserId}. Reason: {Reason}",
            adminUserId, id, request.Reason);

        await _eventPublisher.PublishAsync(new UserSuspendedEvent
        {
            TenantId = user.TenantId,
            UserId = user.Id,
            SuspendedByUserId = adminUserId.Value,
            Reason = request.Reason
        });

        return Ok(new
        {
            success = true,
            message = "User suspended",
            user = new
            {
                id = user.Id,
                is_active = user.IsActive,
                suspended_at = user.SuspendedAt,
                suspension_reason = user.SuspensionReason
            }
        });
    }

    /// <summary>
    /// Activate (unsuspend) a user.
    /// </summary>
    [HttpPut("users/{id:int}/activate")]
    public async Task<IActionResult> ActivateUser(int id)
    {
        var adminUserId = GetCurrentUserId();
        if (adminUserId == null) return Unauthorized(new { error = "Invalid token" });

        var user = await _db.Users.FirstOrDefaultAsync(x => x.Id == id);
        if (user == null)
        {
            return NotFound(new { error = "User not found" });
        }

        if (user.IsActive)
        {
            return BadRequest(new { error = "User is already active" });
        }

        user.IsActive = true;
        user.SuspendedAt = null;
        user.SuspensionReason = null;
        user.SuspendedByUserId = null;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} activated user {UserId}", adminUserId, id);

        await _eventPublisher.PublishAsync(new UserActivatedEvent
        {
            TenantId = user.TenantId,
            UserId = user.Id
        });

        return Ok(new
        {
            success = true,
            message = "User activated",
            user = new
            {
                id = user.Id,
                is_active = user.IsActive
            }
        });
    }

    #endregion

    #region Content Moderation

    /// <summary>
    /// Get pending listings awaiting review.
    /// </summary>
    [HttpGet("listings/pending")]
    public async Task<IActionResult> GetPendingListings(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);
        var skip = (page - 1) * limit;

        var query = _db.Listings.Where(l => l.Status == ListingStatus.Pending);
        var total = await query.CountAsync();

        var listings = await query
            .OrderBy(l => l.CreatedAt)
            .Skip(skip)
            .Take(limit)
            .Select(l => new
            {
                id = l.Id,
                title = l.Title,
                description = l.Description,
                type = l.Type.ToString().ToLower(),
                status = l.Status.ToString().ToLower(),
                location = l.Location,
                estimated_hours = l.EstimatedHours,
                created_at = l.CreatedAt,
                user = new
                {
                    id = l.User!.Id,
                    email = l.User.Email,
                    first_name = l.User.FirstName,
                    last_name = l.User.LastName
                }
            })
            .ToListAsync();

        return Ok(new
        {
            data = listings,
            pagination = new
            {
                page,
                limit,
                total,
                pages = (int)Math.Ceiling((double)total / limit)
            }
        });
    }

    /// <summary>
    /// Approve a pending listing.
    /// </summary>
    [HttpPost("listings/{id:int}/approve")]
    [HttpPut("listings/{id:int}/approve")]
    public async Task<IActionResult> ApproveListing(int id)
    {
        var adminUserId = GetCurrentUserId();
        if (adminUserId == null) return Unauthorized(new { error = "Invalid token" });

        var listing = await _db.Listings.FirstOrDefaultAsync(x => x.Id == id);
        if (listing == null)
        {
            return NotFound(new { error = "Listing not found" });
        }

        if (listing.Status != ListingStatus.Pending)
        {
            return BadRequest(new { error = $"Listing status is '{listing.Status}', not 'Pending'" });
        }

        listing.Status = ListingStatus.Active;
        listing.ReviewedAt = DateTime.UtcNow;
        listing.ReviewedByUserId = adminUserId;
        listing.RejectionReason = null;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} approved listing {ListingId}", adminUserId, id);

        await _eventPublisher.PublishAsync(new ListingApprovedEvent
        {
            TenantId = listing.TenantId,
            ListingId = listing.Id,
            ApprovedByUserId = adminUserId.Value
        });

        return Ok(new
        {
            success = true,
            message = "Listing approved",
            listing = new
            {
                id = listing.Id,
                status = listing.Status.ToString().ToLower(),
                reviewed_at = listing.ReviewedAt,
                reviewed_by_user_id = listing.ReviewedByUserId
            }
        });
    }

    /// <summary>
    /// Reject a pending listing.
    /// </summary>
    [HttpPut("listings/{id:int}/reject")]
    public async Task<IActionResult> RejectListing(int id, [FromBody] RejectListingRequest request)
    {
        var adminUserId = GetCurrentUserId();
        if (adminUserId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.Reason))
        {
            return BadRequest(new { error = "Rejection reason is required" });
        }

        var listing = await _db.Listings.FirstOrDefaultAsync(x => x.Id == id);
        if (listing == null)
        {
            return NotFound(new { error = "Listing not found" });
        }

        if (listing.Status != ListingStatus.Pending)
        {
            return BadRequest(new { error = $"Listing status is '{listing.Status}', not 'Pending'" });
        }

        listing.Status = ListingStatus.Rejected;
        listing.ReviewedAt = DateTime.UtcNow;
        listing.ReviewedByUserId = adminUserId;
        listing.RejectionReason = request.Reason;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} rejected listing {ListingId}. Reason: {Reason}",
            adminUserId, id, request.Reason);

        await _eventPublisher.PublishAsync(new ListingRejectedEvent
        {
            TenantId = listing.TenantId,
            ListingId = listing.Id,
            RejectedByUserId = adminUserId.Value
        });

        return Ok(new
        {
            success = true,
            message = "Listing rejected",
            listing = new
            {
                id = listing.Id,
                status = listing.Status.ToString().ToLower(),
                rejection_reason = listing.RejectionReason,
                reviewed_at = listing.ReviewedAt,
                reviewed_by_user_id = listing.ReviewedByUserId
            }
        });
    }

    #endregion

    #region Categories

    /// <summary>
    /// List all categories.
    /// </summary>
    [HttpGet("categories")]
    public async Task<IActionResult> ListCategories()
    {
        var categories = await _db.Categories
            .OrderBy(c => c.SortOrder)
            .ThenBy(c => c.Name)
            .Select(c => new
            {
                id = c.Id,
                name = c.Name,
                description = c.Description,
                slug = c.Slug,
                parent_category_id = c.ParentCategoryId,
                sort_order = c.SortOrder,
                is_active = c.IsActive,
                created_at = c.CreatedAt,
                updated_at = c.UpdatedAt,
                listing_count = c.Listings.Count
            })
            .ToListAsync();

        return Ok(new { data = categories });
    }

    /// <summary>
    /// Create a new category.
    /// </summary>
    [HttpPost("categories")]
    public async Task<IActionResult> CreateCategory([FromBody] AdminCreateCategoryRequest request)
    {
        var adminUserId = GetCurrentUserId();
        if (adminUserId == null) return Unauthorized(new { error = "Invalid token" });

        // Input validation
        var errors = new List<string>();
        if (string.IsNullOrWhiteSpace(request.Name))
            errors.Add("Name is required");
        else if (request.Name.Length > 100)
            errors.Add("Name must be 100 characters or less");
        if (request.Description != null && request.Description.Length > 1000)
            errors.Add("Description must be 1000 characters or less");
        if (request.Slug != null && request.Slug.Length > 100)
            errors.Add("Slug must be 100 characters or less");
        if (errors.Count > 0)
            return BadRequest(new { error = "Validation failed", details = errors });

        // Generate slug from name if not provided
        // Note: request.Name is validated non-null above
        var slug = request.Slug ?? GenerateSlug(request.Name!);

        // Check for duplicate slug
        var slugExists = await _db.Categories.AnyAsync(c => c.Slug == slug);
        if (slugExists)
        {
            return BadRequest(new { error = "Category with this slug already exists" });
        }

        // Validate parent category if provided
        if (request.ParentCategoryId.HasValue)
        {
            var parentExists = await _db.Categories.AnyAsync(c => c.Id == request.ParentCategoryId.Value);
            if (!parentExists)
            {
                return BadRequest(new { error = "Parent category not found" });
            }
        }

        var category = new Category
        {
            Name = request.Name!.Trim(),
            Description = request.Description?.Trim(),
            Slug = slug,
            ParentCategoryId = request.ParentCategoryId,
            SortOrder = request.SortOrder ?? 0,
            IsActive = request.IsActive ?? true
        };

        _db.Categories.Add(category);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} created category {CategoryId}: {Name}",
            adminUserId, category.Id, category.Name);

        // Invalidate category cache
        _cache.InvalidateCategories(category.TenantId);

        await _eventPublisher.PublishAsync(new CategoryCreatedEvent
        {
            TenantId = category.TenantId,
            CategoryId = category.Id,
            Name = category.Name,
            Description = category.Description,
            Slug = category.Slug,
            ParentCategoryId = category.ParentCategoryId,
            SortOrder = category.SortOrder,
            IsActive = category.IsActive
        });

        return CreatedAtAction(nameof(ListCategories), new
        {
            success = true,
            message = "Category created",
            category = new
            {
                id = category.Id,
                name = category.Name,
                description = category.Description,
                slug = category.Slug,
                parent_category_id = category.ParentCategoryId,
                sort_order = category.SortOrder,
                is_active = category.IsActive,
                created_at = category.CreatedAt
            }
        });
    }

    /// <summary>
    /// Update a category.
    /// </summary>
    [HttpPut("categories/{id:int}")]
    public async Task<IActionResult> UpdateCategory(int id, [FromBody] AdminUpdateCategoryRequest request)
    {
        var adminUserId = GetCurrentUserId();
        if (adminUserId == null) return Unauthorized(new { error = "Invalid token" });

        var category = await _db.Categories.FirstOrDefaultAsync(x => x.Id == id);
        if (category == null)
        {
            return NotFound(new { error = "Category not found" });
        }

        // Input validation
        var errors = new List<string>();
        if (request.Name != null && request.Name.Length > 100)
            errors.Add("Name must be 100 characters or less");
        if (request.Description != null && request.Description.Length > 1000)
            errors.Add("Description must be 1000 characters or less");
        if (request.Slug != null && request.Slug.Length > 100)
            errors.Add("Slug must be 100 characters or less");
        if (errors.Count > 0)
            return BadRequest(new { error = "Validation failed", details = errors });

        var updated = false;

        if (request.Name != null && request.Name != category.Name)
        {
            category.Name = request.Name.Trim();
            updated = true;
        }

        if (request.Description != null && request.Description != category.Description)
        {
            category.Description = request.Description.Trim();
            updated = true;
        }

        if (request.Slug != null && request.Slug != category.Slug)
        {
            var slugExists = await _db.Categories.AnyAsync(c => c.Slug == request.Slug && c.Id != id);
            if (slugExists)
            {
                return BadRequest(new { error = "Category with this slug already exists" });
            }
            category.Slug = request.Slug;
            updated = true;
        }

        if (request.ParentCategoryId.HasValue)
        {
            if (request.ParentCategoryId.Value == id)
            {
                return BadRequest(new { error = "Category cannot be its own parent" });
            }
            var parentExists = await _db.Categories.AnyAsync(c => c.Id == request.ParentCategoryId.Value);
            if (!parentExists)
            {
                return BadRequest(new { error = "Parent category not found" });
            }
            category.ParentCategoryId = request.ParentCategoryId;
            updated = true;
        }

        if (request.SortOrder.HasValue && request.SortOrder != category.SortOrder)
        {
            category.SortOrder = request.SortOrder.Value;
            updated = true;
        }

        if (request.IsActive.HasValue && request.IsActive != category.IsActive)
        {
            category.IsActive = request.IsActive.Value;
            updated = true;
        }

        if (updated)
        {
            category.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            _logger.LogInformation("Admin {AdminId} updated category {CategoryId}", adminUserId, id);

            // Invalidate category cache
            _cache.InvalidateCategories(category.TenantId);

            await _eventPublisher.PublishAsync(new CategoryUpdatedEvent
            {
                TenantId = category.TenantId,
                CategoryId = category.Id,
                Name = category.Name,
                Description = category.Description,
                Slug = category.Slug,
                ParentCategoryId = category.ParentCategoryId,
                SortOrder = category.SortOrder,
                IsActive = category.IsActive
            });
        }

        return Ok(new
        {
            success = true,
            message = "Category updated",
            category = new
            {
                id = category.Id,
                name = category.Name,
                description = category.Description,
                slug = category.Slug,
                parent_category_id = category.ParentCategoryId,
                sort_order = category.SortOrder,
                is_active = category.IsActive,
                updated_at = category.UpdatedAt
            }
        });
    }

    /// <summary>
    /// Delete a category.
    /// </summary>
    [HttpDelete("categories/{id:int}")]
    public async Task<IActionResult> DeleteCategory(int id)
    {
        var adminUserId = GetCurrentUserId();
        if (adminUserId == null) return Unauthorized(new { error = "Invalid token" });

        var category = await _db.Categories
            .Include(c => c.Listings)
            .Include(c => c.ChildCategories)
            .FirstOrDefaultAsync(c => c.Id == id);

        if (category == null)
        {
            return NotFound(new { error = "Category not found" });
        }

        if (category.Listings.Any())
        {
            return BadRequest(new { error = $"Cannot delete category with {category.Listings.Count} listings. Reassign listings first." });
        }

        if (category.ChildCategories.Any())
        {
            return BadRequest(new { error = $"Cannot delete category with {category.ChildCategories.Count} subcategories. Delete or reassign subcategories first." });
        }

        var tenantId = category.TenantId;
        _db.Categories.Remove(category);
        await _db.SaveChangesAsync();

        // Invalidate category cache
        _cache.InvalidateCategories(tenantId);

        _logger.LogInformation("Admin {AdminId} deleted category {CategoryId}: {Name}",
            adminUserId, id, category.Name);

        return Ok(new
        {
            success = true,
            message = "Category deleted"
        });
    }

    #endregion

    #region Tenant Config

    /// <summary>
    /// Get all tenant configuration.
    /// </summary>
    [HttpGet("config")]
    public async Task<IActionResult> GetConfig()
    {
        var configs = await _db.TenantConfigs
            .OrderBy(c => c.Key)
            .Select(c => new
            {
                id = c.Id,
                key = c.Key,
                value = c.Value,
                updated_at = c.UpdatedAt
            })
            .ToListAsync();

        // Also return as a dictionary for easier access
        var configDict = configs.ToDictionary(c => c.key, c => c.value);

        return Ok(new
        {
            data = configs,
            config = configDict
        });
    }

    /// <summary>
    /// Update tenant configuration (batch update).
    /// </summary>
    [HttpPut("config")]
    public async Task<IActionResult> UpdateConfig([FromBody] UpdateConfigRequest request)
    {
        var adminUserId = GetCurrentUserId();
        if (adminUserId == null) return Unauthorized(new { error = "Invalid token" });

        if (request.Config == null || !request.Config.Any())
        {
            return BadRequest(new { error = "Config object is required" });
        }

        var existingConfigs = await _db.TenantConfigs.ToListAsync();
        var updated = new List<string>();
        var created = new List<string>();

        foreach (var kvp in request.Config)
        {
            var existing = existingConfigs.FirstOrDefault(c => c.Key == kvp.Key);
            if (existing != null)
            {
                if (existing.Value != kvp.Value)
                {
                    existing.Value = kvp.Value;
                    existing.UpdatedAt = DateTime.UtcNow;
                    updated.Add(kvp.Key);
                }
            }
            else
            {
                _db.TenantConfigs.Add(new TenantConfig
                {
                    Key = kvp.Key,
                    Value = kvp.Value
                });
                created.Add(kvp.Key);
            }
        }

        await _db.SaveChangesAsync();

        // Invalidate config cache
        _cache.InvalidateConfig(_tenantContext.GetTenantIdOrThrow());

        _logger.LogInformation("Admin {AdminId} updated config. Created: {Created}, Updated: {Updated}",
            adminUserId, created.Count, updated.Count);

        return Ok(new
        {
            success = true,
            message = "Config updated",
            created = created,
            updated = updated
        });
    }

    /// <summary>
    /// Laravel parity: POST /api/v2/admin/settings/header-logo.
    /// Uploads the tenant light header logo override.
    /// </summary>
    [HttpPost("settings/header-logo")]
    [RequestSizeLimit(2 * 1024 * 1024)]
    public Task<IActionResult> UploadHeaderLogo([FromForm] IFormFile? logo, CancellationToken ct = default)
        => UploadHeaderLogoVariantAsync(logo, "logo_url", updateTenantLogoUrl: true, ct);

    /// <summary>
    /// Laravel parity: POST /api/v2/admin/settings/header-logo-dark.
    /// Uploads the tenant dark header logo override.
    /// </summary>
    [HttpPost("settings/header-logo-dark")]
    [RequestSizeLimit(2 * 1024 * 1024)]
    public Task<IActionResult> UploadHeaderLogoDark([FromForm] IFormFile? logo, CancellationToken ct = default)
        => UploadHeaderLogoVariantAsync(logo, "logo_dark_url", updateTenantLogoUrl: false, ct);

    /// <summary>
    /// Laravel parity: POST /api/v2/admin/settings/partner-logo.
    /// Uploads the tenant partner/footer logo override.
    /// </summary>
    [HttpPost("settings/partner-logo")]
    [RequestSizeLimit(2 * 1024 * 1024)]
    public Task<IActionResult> UploadPartnerLogo([FromForm] IFormFile? logo, CancellationToken ct = default)
        => UploadHeaderLogoVariantAsync(logo, "general.partner_logo_url", updateTenantLogoUrl: false, ct, "partner_logo");

    /// <summary>
    /// Laravel parity: DELETE /api/v2/admin/settings/header-logo.
    /// Clears the tenant light header logo override.
    /// </summary>
    [HttpDelete("settings/header-logo")]
    public Task<IActionResult> RemoveHeaderLogo(CancellationToken ct = default)
        => RemoveHeaderLogoVariantAsync("logo_url", clearTenantLogoUrl: true, ct);

    /// <summary>
    /// Laravel parity: DELETE /api/v2/admin/settings/header-logo-dark.
    /// Clears the tenant dark header logo override.
    /// </summary>
    [HttpDelete("settings/header-logo-dark")]
    public Task<IActionResult> RemoveHeaderLogoDark(CancellationToken ct = default)
        => RemoveHeaderLogoVariantAsync("logo_dark_url", clearTenantLogoUrl: false, ct);

    private async Task<IActionResult> RemoveHeaderLogoVariantAsync(
        string configKey,
        bool clearTenantLogoUrl,
        CancellationToken ct)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var config = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == configKey, ct);
        if (config != null)
        {
            _db.TenantConfigs.Remove(config);
        }

        if (clearTenantLogoUrl)
        {
            var tenant = await _db.Tenants
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(t => t.Id == tenantId, ct);
            if (tenant != null)
            {
                tenant.LogoUrl = null;
                tenant.UpdatedAt = DateTime.UtcNow;
            }
        }

        await _db.SaveChangesAsync(ct);
        _cache.InvalidateConfig(tenantId);

        return Ok(new { data = new { url = (string?)null } });
    }

    private async Task<IActionResult> UploadHeaderLogoVariantAsync(
        IFormFile? logo,
        string configKey,
        bool updateTenantLogoUrl,
        CancellationToken ct,
        string entityType = "tenant_logo")
    {
        var adminUserId = GetCurrentUserId();
        if (adminUserId == null) return Unauthorized(new { error = "Invalid token" });

        if (logo == null || logo.Length == 0)
        {
            return BadRequest(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "No image uploaded.", field = "logo" } }
            });
        }

        if (logo.Length > 2 * 1024 * 1024)
        {
            return UnprocessableEntity(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "Image must be 2 MB or smaller.", field = "logo" } }
            });
        }

        var contentType = NormalizeLogoContentType(logo);
        if (contentType == null)
        {
            return UnprocessableEntity(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "File must be an image (JPEG, PNG, GIF, WebP, or SVG).", field = "logo" } }
            });
        }

        if (contentType == "image/svg+xml" && !await IsAllowedSvgAsync(logo, ct))
        {
            return UnprocessableEntity(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "SVG logo must be a valid image without scripts.", field = "logo" } }
            });
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        await using var stream = logo.OpenReadStream();
        var (upload, error) = await _fileUploadService.UploadAsync(
            stream,
            logo.FileName,
            contentType,
            logo.Length,
            adminUserId.Value,
            tenantId,
            FileCategory.TenantLogo,
            tenantId,
            entityType);

        if (error != null)
        {
            return UnprocessableEntity(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = error, field = "logo" } }
            });
        }

        var url = _fileUploadService.GetDownloadUrl(upload!);
        await SetTenantConfigValueAsync(tenantId, configKey, url, ct);

        if (updateTenantLogoUrl)
        {
            var tenant = await _db.Tenants
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(t => t.Id == tenantId, ct);
            if (tenant != null)
            {
                tenant.LogoUrl = url;
                tenant.UpdatedAt = DateTime.UtcNow;
            }
        }

        await _db.SaveChangesAsync(ct);
        _cache.InvalidateConfig(tenantId);

        return Ok(new { data = new { url } });
    }

    private async Task SetTenantConfigValueAsync(int tenantId, string key, string value, CancellationToken ct)
    {
        var existing = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == key, ct);

        if (existing == null)
        {
            _db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = tenantId,
                Key = key,
                Value = value
            });
            return;
        }

        existing.Value = value;
        existing.UpdatedAt = DateTime.UtcNow;
    }

    private static string? NormalizeLogoContentType(IFormFile logo)
    {
        var contentType = logo.ContentType?.Trim().ToLowerInvariant();
        var extension = Path.GetExtension(logo.FileName).ToLowerInvariant();

        if (contentType == "image/jpeg" ||
            contentType == "image/png" ||
            contentType == "image/gif" ||
            contentType == "image/webp")
        {
            return contentType;
        }

        if (contentType == "image/svg+xml" || extension == ".svg")
        {
            return "image/svg+xml";
        }

        return null;
    }

    private static async Task<bool> IsAllowedSvgAsync(IFormFile logo, CancellationToken ct)
    {
        await using var stream = logo.OpenReadStream();
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true, leaveOpen: false);
        var content = await reader.ReadToEndAsync(ct);
        return content.Contains("<svg", StringComparison.OrdinalIgnoreCase) &&
               !content.Contains("<script", StringComparison.OrdinalIgnoreCase) &&
               !content.Contains("javascript:", StringComparison.OrdinalIgnoreCase);
    }

    #endregion

    #region Roles

    /// <summary>
    /// List all roles.
    /// </summary>
    [HttpGet("roles")]
    public async Task<IActionResult> ListRoles()
    {
        var roles = await _db.Roles
            .OrderBy(r => r.IsSystem ? 0 : 1)
            .ThenBy(r => r.Name)
            .Select(r => new
            {
                id = r.Id,
                name = r.Name,
                description = r.Description,
                permissions = r.Permissions,
                is_system = r.IsSystem,
                created_at = r.CreatedAt,
                updated_at = r.UpdatedAt
            })
            .ToListAsync();

        return Ok(new { data = roles });
    }

    /// <summary>
    /// Create a new custom role.
    /// </summary>
    [HttpPost("roles")]
    public async Task<IActionResult> CreateRole([FromBody] CreateRoleRequest request)
    {
        var adminUserId = GetCurrentUserId();
        if (adminUserId == null) return Unauthorized(new { error = "Invalid token" });

        // Input validation
        var errors = new List<string>();
        if (string.IsNullOrWhiteSpace(request.Name))
            errors.Add("Name is required");
        else if (request.Name.Length > 50)
            errors.Add("Name must be 50 characters or less");
        if (request.Description != null && request.Description.Length > 500)
            errors.Add("Description must be 500 characters or less");
        if (request.Permissions != null && request.Permissions.Length > 4000)
            errors.Add("Permissions must be 4000 characters or less");
        if (errors.Count > 0)
            return BadRequest(new { error = "Validation failed", details = errors });

        // Check for duplicate name
        // Note: request.Name is validated non-null above
        var nameExists = await _db.Roles.AnyAsync(r => r.Name == request.Name!.ToLower());
        if (nameExists)
        {
            return BadRequest(new { error = "Role with this name already exists" });
        }

        var role = new Role
        {
            Name = request.Name!.ToLower().Trim(),
            Description = request.Description?.Trim(),
            Permissions = request.Permissions ?? "[]",
            IsSystem = false
        };

        _db.Roles.Add(role);
        await _db.SaveChangesAsync();

        // Invalidate role cache
        _cache.InvalidateRoles(role.TenantId);

        _logger.LogInformation("Admin {AdminId} created role {RoleId}: {Name}",
            adminUserId, role.Id, role.Name);

        return CreatedAtAction(nameof(ListRoles), new
        {
            success = true,
            message = "Role created",
            role = new
            {
                id = role.Id,
                name = role.Name,
                description = role.Description,
                permissions = role.Permissions,
                is_system = role.IsSystem,
                created_at = role.CreatedAt
            }
        });
    }

    /// <summary>
    /// Update a role.
    /// </summary>
    [HttpPut("roles/{id:int}")]
    public async Task<IActionResult> UpdateRole(int id, [FromBody] AdminUpdateRoleRequest request)
    {
        var adminUserId = GetCurrentUserId();
        if (adminUserId == null) return Unauthorized(new { error = "Invalid token" });

        var role = await _db.Roles.FirstOrDefaultAsync(x => x.Id == id);
        if (role == null)
        {
            return NotFound(new { error = "Role not found" });
        }

        // System roles cannot be renamed
        if (role.IsSystem && request.Name != null && request.Name != role.Name)
        {
            return BadRequest(new { error = "Cannot rename system roles" });
        }

        // Input validation
        var errors = new List<string>();
        if (request.Name != null && request.Name.Length > 50)
            errors.Add("Name must be 50 characters or less");
        if (request.Description != null && request.Description.Length > 500)
            errors.Add("Description must be 500 characters or less");
        if (request.Permissions != null && request.Permissions.Length > 4000)
            errors.Add("Permissions must be 4000 characters or less");
        if (errors.Count > 0)
            return BadRequest(new { error = "Validation failed", details = errors });

        var updated = false;

        if (request.Name != null && request.Name != role.Name)
        {
            var nameExists = await _db.Roles.AnyAsync(r => r.Name == request.Name.ToLower() && r.Id != id);
            if (nameExists)
            {
                return BadRequest(new { error = "Role with this name already exists" });
            }
            role.Name = request.Name.ToLower().Trim();
            updated = true;
        }

        if (request.Description != null && request.Description != role.Description)
        {
            role.Description = request.Description.Trim();
            updated = true;
        }

        if (request.Permissions != null && request.Permissions != role.Permissions)
        {
            role.Permissions = request.Permissions;
            updated = true;
        }

        if (updated)
        {
            role.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            // Invalidate role cache
            _cache.InvalidateRoles(role.TenantId);

            _logger.LogInformation("Admin {AdminId} updated role {RoleId}", adminUserId, id);
        }

        return Ok(new
        {
            success = true,
            message = "Role updated",
            role = new
            {
                id = role.Id,
                name = role.Name,
                description = role.Description,
                permissions = role.Permissions,
                is_system = role.IsSystem,
                updated_at = role.UpdatedAt
            }
        });
    }

    /// <summary>
    /// Delete a custom role.
    /// </summary>
    [HttpDelete("roles/{id:int}")]
    public async Task<IActionResult> DeleteRole(int id)
    {
        var adminUserId = GetCurrentUserId();
        if (adminUserId == null) return Unauthorized(new { error = "Invalid token" });

        var role = await _db.Roles.FirstOrDefaultAsync(x => x.Id == id);
        if (role == null)
        {
            return NotFound(new { error = "Role not found" });
        }

        if (role.IsSystem)
        {
            return BadRequest(new { error = "Cannot delete system roles" });
        }

        // Check if any users have this role
        var usersWithRole = await _db.Users.CountAsync(u => u.Role == role.Name);
        if (usersWithRole > 0)
        {
            return BadRequest(new { error = $"Cannot delete role with {usersWithRole} users. Reassign users first." });
        }

        var tenantId = role.TenantId;
        _db.Roles.Remove(role);
        await _db.SaveChangesAsync();

        // Invalidate role cache
        _cache.InvalidateRoles(tenantId);

        _logger.LogInformation("Admin {AdminId} deleted role {RoleId}: {Name}",
            adminUserId, id, role.Name);

        return Ok(new
        {
            success = true,
            message = "Role deleted"
        });
    }

    #endregion

    #region Helpers

    private static string GenerateSlug(string name)
    {
        return name
            .ToLower()
            .Replace(" ", "-")
            .Replace("&", "and")
            .Replace("'", "")
            .Replace("\"", "");
    }

    #endregion
}

#region Request Models

public class AdminUpdateUserRequest
{
    [JsonPropertyName("role")]
    public string? Role { get; set; }

    [JsonPropertyName("first_name")]
    public string? FirstName { get; set; }

    [JsonPropertyName("last_name")]
    public string? LastName { get; set; }

    [JsonPropertyName("email")]
    public string? Email { get; set; }
}

public class SuspendUserRequest
{
    [JsonPropertyName("reason")]
    public string? Reason { get; set; }
}

public class RejectListingRequest
{
    [JsonPropertyName("reason")]
    public string? Reason { get; set; }
}

public class AdminCreateCategoryRequest
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("slug")]
    public string? Slug { get; set; }

    [JsonPropertyName("parent_category_id")]
    public int? ParentCategoryId { get; set; }

    [JsonPropertyName("sort_order")]
    public int? SortOrder { get; set; }

    [JsonPropertyName("is_active")]
    public bool? IsActive { get; set; }
}

public class AdminUpdateCategoryRequest
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("slug")]
    public string? Slug { get; set; }

    [JsonPropertyName("parent_category_id")]
    public int? ParentCategoryId { get; set; }

    [JsonPropertyName("sort_order")]
    public int? SortOrder { get; set; }

    [JsonPropertyName("is_active")]
    public bool? IsActive { get; set; }
}

public class UpdateConfigRequest
{
    [JsonPropertyName("config")]
    public Dictionary<string, string>? Config { get; set; }
}

public class CreateRoleRequest
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("permissions")]
    public string? Permissions { get; set; }
}

public class AdminUpdateRoleRequest
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("permissions")]
    public string? Permissions { get; set; }
}

#endregion
