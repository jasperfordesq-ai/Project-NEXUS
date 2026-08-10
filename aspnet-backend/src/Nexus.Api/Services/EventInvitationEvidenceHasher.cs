// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;

namespace Nexus.Api.Services;

public sealed class EventInvitationEvidenceHasher
{
    private readonly byte[] _key;

    public EventInvitationEvidenceHasher(IConfiguration configuration)
    {
        var configured = configuration["EventRegistration:EvidenceHashKey"]
            ?? configuration["Jwt:Secret"];
        if (string.IsNullOrWhiteSpace(configured))
            throw new InvalidOperationException("EventRegistration:EvidenceHashKey or Jwt:Secret must be configured.");
        _key = SHA256.HashData(Encoding.UTF8.GetBytes(configured));
    }

    public string Email(int tenantId, string email)
        => Hmac($"event-invitation|{tenantId}|{email.Trim().ToLowerInvariant()}");

    public string Token(int tenantId, int eventId, string token)
        => Hmac($"event-invitation|{tenantId}|{eventId}|{token}");

    private string Hmac(string value)
        => Convert.ToHexString(HMACSHA256.HashData(_key, Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}
