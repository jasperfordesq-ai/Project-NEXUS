// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Laravel's THREE SHORT legal routes, which had no counterpart here.
 *
 * 🔴 Why a new file. This backend already serves `legal/acceptance/status` and
 * `legal/acceptance/accept-all`. Laravel registers those AND a shorter trio
 * (routes/api.php:4013-4015):
 *
 *     GET  /api/legal/status
 *     POST /api/legal/accept
 *     POST /api/legal/accept-all
 *
 * Probed live on 2026-08-18, this backend answered 404 for the status route and
 * 405 for both POSTs — a path matched with the wrong verb, which is why a route
 * inventory counted them as present. They are three of the nine genuine
 * method-level gaps, and they matter more than their size: a browser session hits
 * the legal-acceptance gate before it can do anything else, so an unrunnable
 * accept call locks a member out with no way forward.
 *
 * Every contract below was read from the RUNNING disposable Laravel on
 * 2026-08-19, not inferred:
 *
 *     GET  /api/legal/status      -> {"data":{"success":true,"documents":[],
 *                                     "has_pending":false},"meta":{...}}
 *     POST /api/legal/accept  {}  -> 400 {"errors":[{"code":"VALIDATION_ERROR",
 *                                     "message":"Missing document_id or version_id"}]}
 *     POST /api/legal/accept-all  -> {"data":{"message":"All legal documents
 *                                     accepted"},"meta":{...}}
 *
 * 🔴 NON-v2 ONLY, and that is deliberate. My first version of this file also
 * registered /api/v2/legal/status, /api/v2/legal/accept and
 * /api/v2/legal/accept-all. Laravel has NO such routes — verified live: it answers
 * 404 for the v2 status path and 405 for both v2 POSTs, and routes/api.php:4013-4015
 * registers only the bare forms. The v2 aliases were mine, invented, and served
 * nobody: the React client uses /v2/legal/acceptance/status, which is a different
 * endpoint that already existed. An extra route is not harmless — it is surface a
 * client could come to depend on and then lose against the production backend.
 *
 * The WRITE harness caught this on its first run, which is a fair advertisement for
 * measuring writes: a read-only corpus would never have posted to those paths.
 *
 * 🔴 Note `success` sits INSIDE `data` on the status route. That is Laravel's own
 * shape (LegalController::status passes it into respondWithData), not a mistake
 * copied from this backend's habits — and it is why LaravelDataEnvelopeFilter,
 * which strips a TOP-LEVEL `success`, leaves it alone.
 */

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

[ApiController]
public class LegalShortRoutesController : ControllerBase
{
    private readonly NexusDbContext _db;

    public LegalShortRoutesController(NexusDbContext db) => _db = db;

    /// <summary>
    /// GET /api/legal/status — Laravel LegalController::status.
    ///
    /// 🔴 The row shape inside `documents` could NOT be verified: the disposable
    /// Laravel has no legal documents, so it answered with an empty list. The
    /// projection here deliberately reuses the one already built for
    /// `legal/acceptance/status`, which was written against Laravel's
    /// getUserAcceptanceStatus, rather than inventing a second shape. Treat the row
    /// fields as unverified until a fixture with legal documents exists.
    /// </summary>
    [HttpGet("api/legal/status")]
    [Authorize]
    public async Task<IActionResult> Status()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var documents = await BuildAcceptanceRowsAsync(userId.Value);
        var hasPending = documents.Any(d => d.acceptance_status != "current");

        return Ok(new
        {
            data = new
            {
                success = true,
                documents,
                has_pending = hasPending,
            },
            meta = Meta(),
        });
    }

    /// <summary>
    /// POST /api/legal/accept — Laravel LegalController::accept.
    ///
    /// Laravel's validation ladder, in order, each branch verified against its
    /// source (LegalController.php:259-296):
    ///   missing document_id or version_id      -> 400 VALIDATION_ERROR
    ///   version absent / other tenant          -> 404 NOT_FOUND
    ///   version is not the document's current   -> 400 VALIDATION_ERROR
    ///
    /// 🔴 This backend's legal schema is DOCUMENT-LEVEL — there are no version rows
    /// (recorded in the acceptance/status handler and in queue package 5). So a
    /// document's id doubles as its current version id, exactly as
    /// `legal/acceptance/status` already reports it via `current_version_id`. The
    /// third branch therefore compares version_id against the document id. When
    /// version rows land, this comparison is the line to change, and the error
    /// codes and order must not move.
    /// </summary>
    [HttpPost("api/legal/accept")]
    [Authorize]
    public async Task<IActionResult> Accept([FromBody] LegalAcceptRequest? request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var documentId = request?.DocumentId ?? 0;
        var versionId = request?.VersionId ?? 0;

        if (documentId <= 0 || versionId <= 0)
        {
            return BadRequest(new
            {
                errors = new[]
                {
                    new { code = "VALIDATION_ERROR", message = "Missing document_id or version_id" }
                }
            });
        }

        // The tenant filter is global (NexusDbContext applies one to every
        // ITenantEntity), so a document belonging to another community is already
        // invisible here and resolves as NOT_FOUND — which is Laravel's branch.
        //
        // Laravel's ladder, in ORDER (LegalController.php:271-279):
        //   1. resolve the VERSION; absent or other-tenant -> 404 NOT_FOUND
        //   2. resolve the DOCUMENT and check the version is its current one;
        //      otherwise -> 400 VALIDATION_ERROR
        // With a document-level schema a document's id IS its current version id, so
        // "resolve the version" becomes "find the document with that id".
        var version = await _db.LegalDocuments.FirstOrDefaultAsync(d => d.Id == versionId);
        if (version is null)
        {
            return NotFound(new
            {
                errors = new[]
                {
                    new { code = "NOT_FOUND", message = "Legal version not found" }
                }
            });
        }

        var document = await _db.LegalDocuments.FirstOrDefaultAsync(d => d.Id == documentId);
        if (document is null || documentId != versionId)
        {
            return BadRequest(new
            {
                errors = new[]
                {
                    new { code = "VALIDATION_ERROR", message = "Not the current version" }
                }
            });
        }

        var already = await _db.LegalDocumentAcceptances
            .FirstOrDefaultAsync(a => a.UserId == userId.Value && a.LegalDocumentId == documentId);

        var acceptedAt = DateTime.UtcNow;
        if (already is null)
        {
            _db.LegalDocumentAcceptances.Add(new LegalDocumentAcceptance
            {
                TenantId = document.TenantId,
                UserId = userId.Value,
                LegalDocumentId = documentId,
                AcceptedAt = acceptedAt,
                IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
                UserAgent = Request.Headers.UserAgent.ToString() is { Length: > 0 } ua
                    ? ua[..Math.Min(ua.Length, 500)]
                    : null,
            });
            await _db.SaveChangesAsync();
        }
        else
        {
            // Laravel records through the service, which is idempotent per
            // document; re-accepting refreshes the timestamp rather than erroring.
            acceptedAt = already.AcceptedAt;
        }

        return Ok(new
        {
            data = new
            {
                success = true,
                message = "Acceptance recorded",
                accepted_at = acceptedAt,
            },
            meta = Meta(),
        });
    }

    /// <summary>
    /// POST /api/legal/accept-all — Laravel LegalController::acceptAll, which
    /// returns only a message. Records an acceptance for every active document that
    /// requires one and that the member has not already accepted.
    /// </summary>
    [HttpPost("api/legal/accept-all")]
    [Authorize]
    public async Task<IActionResult> AcceptAll()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var pending = await _db.LegalDocuments
            .Where(d => d.IsActive
                && d.RequiresAcceptance
                && !_db.LegalDocumentAcceptances.Any(a => a.UserId == userId.Value && a.LegalDocumentId == d.Id))
            .Select(d => new { d.Id, d.TenantId })
            .ToListAsync();

        if (pending.Count > 0)
        {
            var now = DateTime.UtcNow;
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
            var agent = Request.Headers.UserAgent.ToString();
            if (agent.Length > 500) agent = agent[..500];

            foreach (var d in pending)
            {
                _db.LegalDocumentAcceptances.Add(new LegalDocumentAcceptance
                {
                    TenantId = d.TenantId,
                    UserId = userId.Value,
                    LegalDocumentId = d.Id,
                    AcceptedAt = now,
                    IpAddress = ip,
                    UserAgent = string.IsNullOrEmpty(agent) ? null : agent,
                });
            }

            await _db.SaveChangesAsync();
        }

        return Ok(new { data = new { message = "All legal documents accepted" }, meta = Meta() });
    }

    /// <summary>
    /// The per-document acceptance rows, matching the projection
    /// `legal/acceptance/status` already publishes so the two routes cannot drift
    /// apart. See the note on <see cref="Status"/> about version rows.
    /// </summary>
    private async Task<List<AcceptanceRow>> BuildAcceptanceRowsAsync(int userId)
    {
        var rows = await _db.LegalDocuments
            .Where(d => d.IsActive && d.RequiresAcceptance)
            .Select(d => new
            {
                d.Id,
                d.Slug,
                d.Title,
                d.Version,
                AcceptedAt = _db.LegalDocumentAcceptances
                    .Where(a => a.UserId == userId && a.LegalDocumentId == d.Id)
                    .Select(a => (DateTime?)a.AcceptedAt)
                    .FirstOrDefault()
            })
            .ToListAsync();

        return rows
            .Select(d => new AcceptanceRow(
                d.Id,
                d.Slug,
                d.Title,
                d.Id,
                d.Version,
                d.AcceptedAt == null ? "not_accepted" : "current",
                d.AcceptedAt))
            .ToList();
    }

    public sealed record AcceptanceRow(
        int document_id,
        string document_type,
        string title,
        int current_version_id,
        string? current_version,
        string acceptance_status,
        DateTime? accepted_at);

    public sealed class LegalAcceptRequest
    {
        [System.Text.Json.Serialization.JsonPropertyName("document_id")]
        public int DocumentId { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("version_id")]
        public int VersionId { get; set; }
    }

    /// <summary>
    /// Laravel's `meta` block, built here rather than by
    /// <see cref="Filters.LaravelDataEnvelopeFilter"/>.
    ///
    /// 🔴 Why this route builds its own. That filter is scoped to `/api/v2` paths,
    /// because Laravel's v1 helpers emit a different envelope and every endpoint
    /// measured against the running Laravel to justify the filter was a v2 path.
    /// These three routes are deliberately NOT v2 — Laravel registers only the bare
    /// `/api/legal/...` forms and answers 404/405 on the v2 spellings — yet it still
    /// answers them through `respondWithData`, so they do carry `meta.base_url`.
    /// Filling it in here keeps the shared filter inside its evidence instead of
    /// widening it on a single sample.
    ///
    /// Evidence, read from the running disposable Laravel on 2026-08-19:
    /// `GET /api/legal/status` and `POST /api/legal/accept-all` both return
    /// `"meta":{"base_url":"http://127.0.0.1"}`.
    ///
    /// 🔴 `POST /api/legal/accept` is NOT directly measured, and should not be read
    /// as if it were. Its success path needs an active legal document, and the
    /// disposable Laravel has none — deliberately, because seeding an enforceable
    /// document would switch on the acceptance gate for the harness member and make
    /// every other write in the corpus answer from behind it. It is included here on
    /// the strength of its two measured siblings sharing Laravel's one helper. If a
    /// disposable fixture ever gains a legal document, measure this route directly
    /// and replace this note with the result.
    /// </summary>
    private object Meta() => new { base_url = $"{Request.Scheme}://{Request.Host}" };
}
