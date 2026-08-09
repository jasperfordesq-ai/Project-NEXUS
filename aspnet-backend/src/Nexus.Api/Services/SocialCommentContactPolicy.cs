// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Nexus.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Nexus.Api.Services;

public interface ISocialCommentContactPolicy
{
    Task AssertAllowedAsync(
        int senderId,
        IReadOnlyCollection<int> recipientIds,
        int tenantId,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Applies the shared safeguarding boundary to comment owners, reply authors,
/// and mentioned members while holding the caller's write transaction.
/// </summary>
public sealed class SocialCommentContactPolicy(
    NexusDbContext db,
    SafeguardingInteractionPolicy safeguarding) : ISocialCommentContactPolicy
{
    public async Task AssertAllowedAsync(
        int senderId,
        IReadOnlyCollection<int> recipientIds,
        int tenantId,
        CancellationToken cancellationToken = default)
    {
        var recipients = recipientIds
            .Where(id => id > 0 && id != senderId)
            .Distinct()
            .OrderBy(id => id)
            .ToArray();
        if (recipients.Length == 0)
        {
            return;
        }

        var decision = db.Database.IsRelational()
            ? await safeguarding.EvaluateLockedManyLocalContactsAsync(
                senderId,
                recipients,
                tenantId,
                "comment_create",
                cancellationToken)
            : await safeguarding.EvaluateManyLocalContactsAsync(
                senderId,
                recipients,
                tenantId,
                "comment_create",
                cancellationToken);

        if (decision.IsAllowed)
        {
            return;
        }

        var message = decision.Code switch
        {
            "SAFEGUARDING_POLICY_UNAVAILABLE" => "The safeguarding policy is temporarily unavailable.",
            "VETTING_REQUIRED" => $"Community vetting confirmation is required: {string.Join(", ", decision.RequiredAttestationLabels ?? Array.Empty<string>())}.",
            _ => "Direct contact is restricted by the recipient's safeguarding preferences."
        };
        throw new SafeguardingPolicyException(decision.Code, message);
    }
}
