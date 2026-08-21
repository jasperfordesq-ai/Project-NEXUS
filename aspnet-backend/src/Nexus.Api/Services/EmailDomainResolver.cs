// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace Nexus.Api.Services;

/// <summary>
/// The outcome of a mail-deliverability DNS lookup for one domain.
///
/// 🔴 The three-way split is the whole point of this type, and it is the one
/// place this edition deliberately knows MORE than the V1 PHP implementation.
/// PHP's <c>checkdnsrr()</c> returns plain <c>false</c> for BOTH "this domain
/// publishes no mail records" and "the resolver did not answer", and the V1
/// source says so in a comment. Collapsing those two into one answer means a
/// resolver outage refuses every registration on the platform. Keeping them
/// apart lets the validator refuse the first and allow the second.
/// </summary>
public enum DomainMailResolution
{
    /// <summary>The domain publishes an MX record, or an A/AAAA record it can receive mail on (RFC 5321 §5.1).</summary>
    HasRecords,

    /// <summary>The resolver answered authoritatively and there is no MX and no A/AAAA record. A real refusal.</summary>
    NoRecords,

    /// <summary>The lookup itself did not complete — timeout, no resolver, SERVFAIL, REFUSED, malformed reply. NOT evidence about the domain.</summary>
    LookupFailed,
}

public interface IEmailDomainResolver
{
    Task<DomainMailResolution> ResolveAsync(string domain, CancellationToken ct = default);
}

/// <summary>
/// Minimal DNS client for MX and A/AAAA lookups over UDP.
///
/// Why hand-rolled rather than a NuGet package: the .NET base class library
/// has no MX lookup at all (<c>System.Net.Dns</c> resolves addresses only),
/// and an A-only check would refuse every mail-only domain that publishes MX
/// without an apex A record — a fail-CLOSED regression against Laravel. This
/// is ~120 lines of RFC 1035 wire format against a well-defined query, and it
/// adds no third-party dependency to a public AGPL repository.
///
/// Resolvers come from the OS network configuration, with the option to pin
/// them via <c>EmailDeliverability:DnsServers</c> (comma-separated) for hosts
/// whose configured resolver is not reachable from the container.
/// </summary>
public class DnsEmailDomainResolver : IEmailDomainResolver
{
    private const int DnsPort = 53;
    private const ushort TypeA = 1;
    private const ushort TypeMx = 15;
    private const ushort TypeAaaa = 28;
    private const ushort ClassIn = 1;

    private const int RcodeNoError = 0;
    private const int RcodeNameError = 3; // NXDOMAIN — authoritative "no such domain".

    private readonly IConfiguration _config;
    private readonly ILogger<DnsEmailDomainResolver> _logger;

    public DnsEmailDomainResolver(IConfiguration config, ILogger<DnsEmailDomainResolver> logger)
    {
        _config = config;
        _logger = logger;
    }

    private TimeSpan QueryTimeout =>
        TimeSpan.FromMilliseconds(Math.Clamp(_config.GetValue("EmailDeliverability:DnsTimeoutMs", 3000), 250, 15000));

    public async Task<DomainMailResolution> ResolveAsync(string domain, CancellationToken ct = default)
    {
        var servers = ResolverAddresses();
        if (servers.Count == 0)
        {
            _logger.LogInformation("dns.no_resolver_configured domain={Domain}", domain);
            return DomainMailResolution.LookupFailed;
        }

        // MX first, then A, then AAAA — the RFC 5321 §5.1 implicit-MX fallback.
        // A single authoritative "record present" answer is enough to accept.
        var anyLookupFailed = false;
        foreach (var type in new[] { TypeMx, TypeA, TypeAaaa })
        {
            switch (await QueryAsync(servers, domain, type, ct))
            {
                case QueryOutcome.RecordsPresent:
                    return DomainMailResolution.HasRecords;

                // NXDOMAIN is authoritative for the NAME, not just this record
                // type, so no later lookup can change the answer. Stop here —
                // otherwise a timeout on the follow-up A query would downgrade
                // a proven-nonexistent domain to "allow".
                case QueryOutcome.NameDoesNotExist:
                    return DomainMailResolution.NoRecords;

                case QueryOutcome.Failed:
                    anyLookupFailed = true;
                    break;

                case QueryOutcome.TypeAbsent:
                    break; // no record of THIS type — fall through to the next
                }
        }

        // If ANY of the three lookups failed to complete we have not proved the
        // domain undeliverable, so we must not report NoRecords — that would
        // turn a resolver problem into a refused registration.
        return anyLookupFailed ? DomainMailResolution.LookupFailed : DomainMailResolution.NoRecords;
    }

    private List<IPEndPoint> ResolverAddresses()
    {
        var configured = _config["EmailDeliverability:DnsServers"];
        var endpoints = new List<IPEndPoint>();

        if (!string.IsNullOrWhiteSpace(configured))
        {
            // Accepts a bare address ("10.0.0.2") or an address with an
            // explicit port ("10.0.0.2:5353"). The port form matters for
            // split-horizon resolvers that do not listen on 53, and it is what
            // lets DnsEmailDomainResolverTests point this at a loopback server
            // instead of the internet.
            foreach (var candidate in configured.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (IPEndPoint.TryParse(candidate, out var endpoint))
                {
                    endpoints.Add(endpoint.Port == 0 ? new IPEndPoint(endpoint.Address, DnsPort) : endpoint);
                }
            }
            return endpoints;
        }

        try
        {
            foreach (var nic in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up) continue;
                foreach (var address in nic.GetIPProperties().DnsAddresses)
                {
                    var endpoint = new IPEndPoint(address, DnsPort);
                    if (!endpoints.Contains(endpoint)) endpoints.Add(endpoint);
                }
            }
        }
        catch (System.Net.NetworkInformation.NetworkInformationException ex)
        {
            _logger.LogInformation(ex, "dns.resolver_enumeration_failed");
        }
        catch (PlatformNotSupportedException ex)
        {
            _logger.LogInformation(ex, "dns.resolver_enumeration_unsupported");
        }

        return endpoints;
    }

    /// <summary>
    /// Per-query outcome. Four states rather than three because "this record
    /// type is absent" (try the next type) and "this name does not exist"
    /// (stop, authoritative) are different answers.
    /// </summary>
    private enum QueryOutcome
    {
        RecordsPresent,
        TypeAbsent,
        NameDoesNotExist,
        Failed,
    }

    private async Task<QueryOutcome> QueryAsync(
        List<IPEndPoint> servers, string domain, ushort type, CancellationToken ct)
    {
        byte[] query;
        ushort id;
        try
        {
            (query, id) = BuildQuery(domain, type);
        }
        catch (ArgumentException ex)
        {
            // A name we cannot even encode is not a transport failure; the
            // validator's syntax gate should already have refused it.
            _logger.LogInformation(ex, "dns.unencodable_name domain={Domain}", domain);
            return QueryOutcome.NameDoesNotExist;
        }

        var lastOutcome = QueryOutcome.Failed;

        foreach (var server in servers)
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(QueryTimeout);
            try
            {
                using var socket = new Socket(server.AddressFamily, SocketType.Dgram, ProtocolType.Udp);
                await socket.SendToAsync(query, SocketFlags.None, server, timeout.Token);

                var buffer = new byte[4096];
                var received = await socket.ReceiveFromAsync(
                    buffer, SocketFlags.None, new IPEndPoint(server.Address.AddressFamily == AddressFamily.InterNetworkV6 ? IPAddress.IPv6Any : IPAddress.Any, 0), timeout.Token);

                lastOutcome = ReadAnswer(buffer.AsSpan(0, received.ReceivedBytes), id);
                if (lastOutcome != QueryOutcome.Failed) return lastOutcome;
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                _logger.LogInformation("dns.timeout domain={Domain} type={Type} server={Server}", domain, type, server.Address);
                lastOutcome = QueryOutcome.Failed;
            }
            catch (SocketException ex)
            {
                _logger.LogInformation("dns.socket_error domain={Domain} type={Type} server={Server} error={Error}",
                    domain, type, server.Address, ex.SocketErrorCode);
                lastOutcome = QueryOutcome.Failed;
            }
        }

        return lastOutcome;
    }

    private static (byte[] Query, ushort Id) BuildQuery(string domain, ushort type)
    {
        var id = (ushort)Random.Shared.Next(1, ushort.MaxValue);
        using var stream = new MemoryStream();

        Span<byte> header = stackalloc byte[12];
        BinaryPrimitives.WriteUInt16BigEndian(header[..2], id);
        BinaryPrimitives.WriteUInt16BigEndian(header[2..4], 0x0100); // standard query, recursion desired
        BinaryPrimitives.WriteUInt16BigEndian(header[4..6], 1);      // one question
        stream.Write(header);

        foreach (var label in domain.Split('.', StringSplitOptions.RemoveEmptyEntries))
        {
            var bytes = Encoding.ASCII.GetBytes(label);
            if (bytes.Length is 0 or > 63) throw new ArgumentException($"DNS label out of range: '{label}'", nameof(domain));
            stream.WriteByte((byte)bytes.Length);
            stream.Write(bytes);
        }
        stream.WriteByte(0); // root label

        Span<byte> tail = stackalloc byte[4];
        BinaryPrimitives.WriteUInt16BigEndian(tail[..2], type);
        BinaryPrimitives.WriteUInt16BigEndian(tail[2..], ClassIn);
        stream.Write(tail);

        return (stream.ToArray(), id);
    }

    /// <summary>
    /// Decides the outcome from a reply, WITHOUT walking the record bodies —
    /// the answer count and RCODE carry everything we need. Anything we cannot
    /// interpret with confidence is LookupFailed, never NoRecords.
    /// </summary>
    private static QueryOutcome ReadAnswer(ReadOnlySpan<byte> reply, ushort expectedId)
    {
        if (reply.Length < 12) return QueryOutcome.Failed;
        if (BinaryPrimitives.ReadUInt16BigEndian(reply[..2]) != expectedId) return QueryOutcome.Failed;

        var flags = BinaryPrimitives.ReadUInt16BigEndian(reply[2..4]);
        var isResponse = (flags & 0x8000) != 0;
        var truncated = (flags & 0x0200) != 0;
        var rcode = flags & 0x000F;
        if (!isResponse) return QueryOutcome.Failed;

        var answerCount = BinaryPrimitives.ReadUInt16BigEndian(reply[6..8]);

        // Truncation means there IS data, we just did not receive all of it —
        // for a presence check that is a positive answer, not a failure.
        if (truncated && answerCount == 0) return QueryOutcome.RecordsPresent;

        return rcode switch
        {
            // NOERROR with answers = records exist. NOERROR with none is
            // NODATA: this type is absent, which for MX legitimately means
            // "fall back to A" rather than "undeliverable".
            RcodeNoError => answerCount > 0 ? QueryOutcome.RecordsPresent : QueryOutcome.TypeAbsent,

            // NXDOMAIN is authoritative and final for the whole name.
            RcodeNameError => QueryOutcome.NameDoesNotExist,

            // FORMERR / SERVFAIL / NOTIMP / REFUSED and anything else: the
            // resolver did not answer the question. Never a refusal.
            _ => QueryOutcome.Failed,
        };
    }
}
