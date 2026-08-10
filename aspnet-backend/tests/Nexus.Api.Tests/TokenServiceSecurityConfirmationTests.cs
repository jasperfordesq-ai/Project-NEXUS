// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.IdentityModel.Tokens.Jwt;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

public sealed class TokenServiceSecurityConfirmationTests
{
    private readonly TokenService _service = new(new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Jwt:Secret"] = Convert.ToBase64String(new byte[32]),
            ["Jwt:Issuer"] = "NexusTestIssuer",
            ["Jwt:Audience"] = "NexusTestAudience",
            ["Jwt:AccessTokenExpiryMinutes"] = "120"
        })
        .Build());

    [Fact]
    public void SecurityConfirmation_IsSignedShortLivedAndBoundToUserAndTenant()
    {
        var token = _service.GenerateSecurityConfirmationToken(41, 7, "password");
        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(token);

        _service.ValidateSecurityConfirmationToken(token, 41, 7).Should().BeTrue();
        _service.ValidateSecurityConfirmationToken(token, 42, 7).Should().BeFalse();
        _service.ValidateSecurityConfirmationToken(token, 41, 8).Should().BeFalse();
        _service.ValidateSecurityConfirmationToken("not-a-token", 41, 7).Should().BeFalse();
        jwt.Claims.Single(claim => claim.Type == "type").Value.Should().Be("security_confirmation");
        jwt.Claims.Single(claim => claim.Type == "method").Value.Should().Be("password");
        (jwt.ValidTo - jwt.ValidFrom).Should().Be(TimeSpan.FromMinutes(5));
    }

    [Fact]
    public void PasskeyAccessToken_RecordsPossessionAndUserVerificationMethods()
    {
        var user = new User
        {
            Id = 41,
            TenantId = 7,
            Role = "member",
            Email = "member@example.test"
        };

        var jwt = new JwtSecurityTokenHandler().ReadJwtToken(
            _service.GenerateJwt(user, "passkey", "user_verification"));

        jwt.Claims.Where(claim => claim.Type == "amr").Select(claim => claim.Value)
            .Should().BeEquivalentTo("passkey", "user_verification");
    }
}
