// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController,Authorize]
public sealed class EventSafetyController(EventSafetyService safety):ControllerBase
{
    [AllowAnonymous]
    [HttpPost("api/events/safety/guardian-consents/grant")]
    [HttpPost("api/v2/events/safety/guardian-consents/grant")]
    public Task<IActionResult> Grant([FromBody]JsonElement b,CancellationToken ct)=>Run(safety.GrantGuardianAsync(Text(b,"token")??"",Text(b,"guardian_email")??"",Key(),ct));
    [HttpGet("api/events/{id:int}/safety"),HttpGet("api/v2/events/{id:int}/safety")]
    public Task<IActionResult> Show(int id,CancellationToken ct)=>Run(safety.ReadAsync(Tenant(),id,UserId(),ct));
    [HttpPut("api/events/{id:int}/safety/requirements"),HttpPut("api/v2/events/{id:int}/safety/requirements")]
    public Task<IActionResult> Save(int id,[FromBody]JsonElement b,CancellationToken ct)=>Run(safety.SaveDraftAsync(Tenant(),id,UserId(),b,Key(),ct));
    [HttpPost("api/events/{id:int}/safety/requirements/publish"),HttpPost("api/v2/events/{id:int}/safety/requirements/publish")]
    public Task<IActionResult> Publish(int id,[FromBody]JsonElement b,CancellationToken ct)=>Run(safety.PublishAsync(Tenant(),id,UserId(),Long(b,"expected_revision"),Int(b,"expected_version"),Key(),ct));
    [HttpPost("api/events/{id:int}/safety/requirements/archive"),HttpPost("api/v2/events/{id:int}/safety/requirements/archive")]
    public Task<IActionResult> Archive(int id,[FromBody]JsonElement b,CancellationToken ct)=>Run(safety.ArchiveAsync(Tenant(),id,UserId(),Long(b,"expected_revision"),Int(b,"expected_version"),Key(),ct));
    [HttpPost("api/events/{id:int}/safety/code-of-conduct/acknowledgements"),HttpPost("api/v2/events/{id:int}/safety/code-of-conduct/acknowledgements")]
    public Task<IActionResult> Ack(int id,[FromBody]JsonElement b,CancellationToken ct)=>Run(safety.AcknowledgeAsync(Tenant(),id,UserId(),Text(b,"text_version")??"",Text(b,"text_hash")??"",Key(),ct));
    [HttpDelete("api/events/{id:int}/safety/code-of-conduct/acknowledgements/{ackId:long}"),HttpDelete("api/v2/events/{id:int}/safety/code-of-conduct/acknowledgements/{ackId:long}")]
    public Task<IActionResult> WithdrawAck(int id,long ackId,CancellationToken ct)=>Run(safety.WithdrawAckAsync(Tenant(),id,UserId(),ackId,Key(),ct));
    [HttpPost("api/events/{id:int}/safety/guardian-consents"),HttpPost("api/v2/events/{id:int}/safety/guardian-consents")]
    public Task<IActionResult> RequestGuardian(int id,[FromBody]JsonElement b,CancellationToken ct)=>Run(safety.RequestGuardianAsync(Tenant(),id,UserId(),Text(b,"guardian_name"),Text(b,"guardian_email"),Text(b,"relationship_code"),Text(b,"preferred_language"),Key(),ct));
    [HttpDelete("api/events/{id:int}/safety/guardian-consents/{consentId:long}"),HttpDelete("api/v2/events/{id:int}/safety/guardian-consents/{consentId:long}")]
    public Task<IActionResult> WithdrawGuardian(int id,long consentId,CancellationToken ct)=>Run(safety.WithdrawGuardianAsync(Tenant(),id,UserId(),consentId,Key(),ct));
    [HttpGet("api/events/{id:int}/safety/reviews"),HttpGet("api/v2/events/{id:int}/safety/reviews")]
    public Task<IActionResult> Reviews(int id,[FromQuery]int page=1,[FromQuery(Name="per_page")]int perPage=25,CancellationToken ct=default)=>Run(safety.ReviewsAsync(Tenant(),id,UserId(),page,perPage,ct));
    [HttpPost("api/events/{id:int}/safety/reviews"),HttpPost("api/v2/events/{id:int}/safety/reviews")]
    public Task<IActionResult> Record(int id,[FromBody]JsonElement b,CancellationToken ct)=>Run(safety.RecordReviewAsync(Tenant(),id,UserId(),Int(b,"user_id"),Text(b,"decision")??"",Text(b,"reason_code")??"",Date(b,"effective_from"),DateN(b,"effective_until"),LongN(b,"expected_version"),Key(),ct));
    [HttpDelete("api/events/{id:int}/safety/reviews/{denialId:long}"),HttpDelete("api/v2/events/{id:int}/safety/reviews/{denialId:long}")]
    public async Task<IActionResult> WithdrawReview(int id,long denialId,CancellationToken ct){var b=await JsonSerializer.DeserializeAsync<JsonElement>(Request.Body,cancellationToken:ct);return await Run(safety.WithdrawReviewAsync(Tenant(),id,UserId(),denialId,Long(b,"expected_version"),Key(),ct));}
    private async Task<IActionResult> Run(Task<EventSafetyResult> task){var r=await task;Response.Headers.CacheControl="private, no-store";Response.Headers.Pragma="no-cache";Response.Headers["X-Event-Safety-Contract"]="1";return r.Succeeded?StatusCode(r.Status,new{success=true,data=r.Data}):StatusCode(r.Error!.Status,new{success=false,error=new{code=r.Error.Code,message=r.Error.Message,field=r.Error.Field}});}
    private int Tenant()=>User.GetTenantId()??throw new UnauthorizedAccessException();private int UserId()=>User.GetUserId()??throw new UnauthorizedAccessException();private string Key()=>Request.Headers["Idempotency-Key"].ToString().Trim();private static string? Text(JsonElement x,string n)=>x.ValueKind==JsonValueKind.Object&&x.TryGetProperty(n,out var p)&&p.ValueKind==JsonValueKind.String?p.GetString():null;private static int Int(JsonElement x,string n)=>x.ValueKind==JsonValueKind.Object&&x.TryGetProperty(n,out var p)&&p.TryGetInt32(out var v)?v:0;private static long Long(JsonElement x,string n)=>x.ValueKind==JsonValueKind.Object&&x.TryGetProperty(n,out var p)&&p.TryGetInt64(out var v)?v:0;private static long? LongN(JsonElement x,string n)=>x.ValueKind==JsonValueKind.Object&&x.TryGetProperty(n,out var p)&&p.ValueKind!=JsonValueKind.Null&&p.TryGetInt64(out var v)?v:null;private static DateTime Date(JsonElement x,string n)=>DateTimeOffset.TryParse(Text(x,n),out var d)?d.UtcDateTime:default;private static DateTime? DateN(JsonElement x,string n)=>x.ValueKind==JsonValueKind.Object&&x.TryGetProperty(n,out var p)&&p.ValueKind==JsonValueKind.Null?null:DateTimeOffset.TryParse(Text(x,n),out var d)?d.UtcDateTime:default(DateTime?);
}
