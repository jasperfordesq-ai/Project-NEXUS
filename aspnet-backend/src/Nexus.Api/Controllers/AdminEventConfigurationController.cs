// Copyright Â© 2024â€“2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/v2/admin/config/events")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminEventConfigurationController(NexusDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Show(CancellationToken ct) => Result(await Service().InspectAsync(Tenant(), ct));

    [HttpGet("audit-log")]
    public async Task<IActionResult> AuditLog(CancellationToken ct) => Result(await Service().AuditAsync(Tenant(), ct));

    [HttpPut]
    public async Task<IActionResult> Update([FromBody] EventConfigurationUpdateRequest request, CancellationToken ct)
    {
        if (!Version(request.Version, out var version)) return Result(Invalid("version"));
        return Result(await Service().UpdateAsync(Tenant(), Actor(), version, request.Settings, request.Reason, request.ConfirmDisruptive, ct));
    }

    [HttpPost("restore-defaults")]
    public async Task<IActionResult> Restore([FromBody] EventConfigurationRestoreRequest request, CancellationToken ct)
    {
        if (!Version(request.Version, out var version)) return Result(Invalid("version"));
        return Result(await Service().RestoreAsync(Tenant(), Actor(), version, request.Reason, request.Keys, ct));
    }

    private EventConfigurationPolicyService Service() => new(db);
    private int Tenant() => User.GetTenantId() ?? throw new UnauthorizedAccessException();
    private int Actor() => User.GetUserId() ?? throw new UnauthorizedAccessException();
    private IActionResult Result(EventConfigurationPolicyResult result) => result.Succeeded
        ? Ok(new { success = true, data = result.Data })
        : StatusCode(result.Error!.Status, new { success = false, errors = new[] { new { code = result.Error.Code, message = result.Error.Message, field = result.Error.Field } } });
    private static EventConfigurationPolicyResult Invalid(string field) => new(null, new("VALIDATION_ERROR", "Event configuration is invalid", 422, field));
    private static bool Version(JsonElement value, out int version)
    {
        version = -1;
        return value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out version) && version >= 0
            || value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out version) && version >= 0;
    }
}

public sealed record EventConfigurationUpdateRequest(
    JsonElement Version,
    IReadOnlyDictionary<string, JsonElement>? Settings,
    string? Reason,
    [property: JsonPropertyName("confirm_disruptive")] bool ConfirmDisruptive = false);

public sealed record EventConfigurationRestoreRequest(JsonElement Version, string? Reason, IReadOnlyCollection<string>? Keys);
