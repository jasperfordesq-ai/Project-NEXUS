// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController,Authorize]
public sealed class EventOfflineCheckinController(EventOfflineCheckinService service):ControllerBase
{
    [HttpGet("api/events/{id:int}/offline-checkin"),HttpGet("api/v2/events/{id:int}/offline-checkin")]
    public Task<IActionResult> Workspace(int id,CancellationToken ct)=>Run(service.WorkspaceAsync(Tenant(),id,UserId(),ct));
    [HttpGet("api/events/{id:int}/offline-checkin/credentials/me"),HttpGet("api/v2/events/{id:int}/offline-checkin/credentials/me")]
    public Task<IActionResult> Mine(int id,CancellationToken ct)=>Run(service.MyCredentialAsync(Tenant(),id,UserId(),ct));
    [HttpPost("api/events/{id:int}/offline-checkin/credentials"),HttpPost("api/v2/events/{id:int}/offline-checkin/credentials")]
    public Task<IActionResult> Issue(int id,[FromBody]JsonElement body,CancellationToken ct)=>Run(service.IssueCredentialAsync(Tenant(),id,UserId(),LongN(body,"registration_id"),Key(),ct));
    [HttpPost("api/events/{id:int}/offline-checkin/credentials/{credentialId:long}/rotate"),HttpPost("api/v2/events/{id:int}/offline-checkin/credentials/{credentialId:long}/rotate")]
    public Task<IActionResult> RotateCredential(int id,long credentialId,[FromBody]JsonElement body,CancellationToken ct)=>Run(service.RotateCredentialAsync(Tenant(),id,credentialId,UserId(),Int(body,"expected_version"),Key(),ct));
    [HttpPost("api/events/{id:int}/offline-checkin/credentials/{credentialId:long}/revoke"),HttpPost("api/v2/events/{id:int}/offline-checkin/credentials/{credentialId:long}/revoke")]
    public Task<IActionResult> RevokeCredential(int id,long credentialId,[FromBody]JsonElement body,CancellationToken ct)=>Run(service.RevokeCredentialAsync(Tenant(),id,credentialId,UserId(),Int(body,"expected_version"),Text(body,"reason"),ct));
    [HttpPost("api/events/{id:int}/offline-checkin/devices"),HttpPost("api/v2/events/{id:int}/offline-checkin/devices")]
    public Task<IActionResult> RegisterDevice(int id,[FromBody]JsonElement body,CancellationToken ct)=>Run(service.RegisterDeviceAsync(Tenant(),id,UserId(),Text(body,"label"),Date(body,"expires_at"),Key(),ct));
    [HttpPost("api/events/{id:int}/offline-checkin/devices/{deviceId:long}/rotate"),HttpPost("api/v2/events/{id:int}/offline-checkin/devices/{deviceId:long}/rotate")]
    public Task<IActionResult> RotateDevice(int id,long deviceId,[FromBody]JsonElement body,CancellationToken ct)=>Run(service.RotateDeviceAsync(Tenant(),id,deviceId,UserId(),Int(body,"expected_version"),Key(),ct));
    [HttpPost("api/events/{id:int}/offline-checkin/devices/{deviceId:long}/revoke"),HttpPost("api/v2/events/{id:int}/offline-checkin/devices/{deviceId:long}/revoke")]
    public Task<IActionResult> RevokeDevice(int id,long deviceId,[FromBody]JsonElement body,CancellationToken ct)=>Run(service.RevokeDeviceAsync(Tenant(),id,deviceId,UserId(),Int(body,"expected_version"),Text(body,"reason"),ct));
    [HttpPost("api/events/{id:int}/offline-checkin/manifest"),HttpPost("api/v2/events/{id:int}/offline-checkin/manifest")]
    public Task<IActionResult> Manifest(int id,[FromBody]JsonElement body,CancellationToken ct)=>Run(service.ManifestAsync(Tenant(),id,UserId(),Text(body,"device_secret")??"",IntN(body,"ttl_minutes"),ct));
    [HttpPost("api/events/{id:int}/offline-checkin/sync"),HttpPost("api/v2/events/{id:int}/offline-checkin/sync")]
    public Task<IActionResult> Sync(int id,[FromBody]JsonElement body,CancellationToken ct)=>Run(service.StageAsync(Tenant(),id,UserId(),body,ct));
    [HttpGet("api/events/{id:int}/offline-checkin/batches/{batchId:long}"),HttpGet("api/v2/events/{id:int}/offline-checkin/batches/{batchId:long}")]
    public Task<IActionResult> Batch(int id,long batchId,CancellationToken ct)=>Run(service.BatchAsync(Tenant(),id,batchId,UserId(),ct));
    [HttpGet("api/events/{id:int}/offline-checkin/conflicts"),HttpGet("api/v2/events/{id:int}/offline-checkin/conflicts")]
    public Task<IActionResult> Conflicts(int id,[FromQuery]int page=1,CancellationToken ct=default)=>Run(service.ConflictsAsync(Tenant(),id,UserId(),page,ct));
    [HttpPost("api/events/{id:int}/offline-checkin/conflicts/{itemId:long}"),HttpPost("api/v2/events/{id:int}/offline-checkin/conflicts/{itemId:long}")]
    public Task<IActionResult> Resolve(int id,long itemId,[FromBody]JsonElement body,CancellationToken ct)=>Run(service.ResolveAsync(Tenant(),id,itemId,UserId(),Int(body,"expected_decision_version"),Text(body,"disposition")??"",Long(body,"expected_attendance_version"),Text(body,"reason"),Key(),ct));
    [HttpPost("api/events/{id:int}/offline-checkin/scan"),HttpPost("api/v2/events/{id:int}/offline-checkin/scan")]
    public Task<IActionResult> Scan(int id,[FromBody]JsonElement body,CancellationToken ct)=>Run(service.ScanAsync(Tenant(),id,UserId(),Text(body,"device_secret")??"",Text(body,"credential")??"",Text(body,"action")??"",Long(body,"expected_attendance_version"),Key(),Text(body,"reason"),ct));
    private async Task<IActionResult> Run(Task<EventOfflineResult> task){var r=await task;Response.Headers.CacheControl="private, no-store";return r.Succeeded?StatusCode(r.Status,new{success=true,data=r.Data}):StatusCode(r.Error!.Status,new{success=false,error=new{code=r.Error.Code,message=r.Error.Message,field=r.Error.Field}});}
    private int Tenant()=>User.GetTenantId()??throw new UnauthorizedAccessException();private int UserId()=>User.GetUserId()??throw new UnauthorizedAccessException();private string Key()=>Request.Headers["Idempotency-Key"].ToString().Trim();private static string? Text(JsonElement x,string n)=>x.TryGetProperty(n,out var p)&&p.ValueKind==JsonValueKind.String?p.GetString():null;private static int Int(JsonElement x,string n)=>x.TryGetProperty(n,out var p)&&p.TryGetInt32(out var v)?v:0;private static int? IntN(JsonElement x,string n)=>x.TryGetProperty(n,out var p)&&p.TryGetInt32(out var v)?v:null;private static long Long(JsonElement x,string n)=>x.TryGetProperty(n,out var p)&&p.TryGetInt64(out var v)?v:0;private static long? LongN(JsonElement x,string n)=>x.TryGetProperty(n,out var p)&&p.ValueKind!=JsonValueKind.Null&&p.TryGetInt64(out var v)?v:null;private static DateTime? Date(JsonElement x,string n)=>DateTimeOffset.TryParse(Text(x,n),out var d)?d.UtcDateTime:null;
}
