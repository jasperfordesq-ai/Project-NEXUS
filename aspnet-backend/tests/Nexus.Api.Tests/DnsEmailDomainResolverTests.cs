// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Nexus.Api.Services;

namespace Nexus.Api.Tests;

/// <summary>
/// Exercises the hand-rolled DNS client itself against a loopback UDP server,
/// so the wire format and the three-way outcome mapping are proved rather than
/// assumed.
///
/// Lesson earned here: RegistrationEmailGuardUnitTests proves the fail-open
/// POLICY with a scripted resolver, which is a different claim from "the
/// resolver reports LookupFailed when DNS is actually broken". Only one of
/// those keeps members able to register during an outage, and a scripted
/// double can never test it. Everything below runs on 127.0.0.1 with no
/// external network, so it is deterministic in CI.
/// </summary>
public class DnsEmailDomainResolverTests
{
    private const ushort TypeMx = 15;
    private const ushort TypeA = 1;
    private const ushort TypeAaaa = 28;

    /// <summary>
    /// Minimal DNS server on a loopback ephemeral port. <paramref name="reply"/>
    /// maps the queried record type to (rcode, answerCount); returning null
    /// means "do not answer at all", which is how a timeout is simulated.
    /// </summary>
    private sealed class FakeDnsServer : IDisposable
    {
        private readonly Socket _socket;
        private readonly CancellationTokenSource _cts = new();

        public int QueriesReceived;

        public FakeDnsServer(Func<ushort, (int Rcode, int AnswerCount)?> reply)
        {
            _socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            _socket.Bind(new IPEndPoint(IPAddress.Loopback, 0));
            Endpoint = (IPEndPoint)_socket.LocalEndPoint!;
            _ = Task.Run(() => ServeAsync(reply, _cts.Token));
        }

        public IPEndPoint Endpoint { get; }

        private async Task ServeAsync(Func<ushort, (int Rcode, int AnswerCount)?> reply, CancellationToken ct)
        {
            var buffer = new byte[512];
            while (!ct.IsCancellationRequested)
            {
                SocketReceiveFromResult received;
                try
                {
                    received = await _socket.ReceiveFromAsync(
                        buffer, SocketFlags.None, new IPEndPoint(IPAddress.Any, 0), ct);
                }
                catch (OperationCanceledException) { return; }
                catch (SocketException) { return; }
                catch (ObjectDisposedException) { return; }

                Interlocked.Increment(ref QueriesReceived);

                var query = buffer.AsSpan(0, received.ReceivedBytes);
                // QTYPE sits in the last four bytes of a single-question query.
                var qtype = BinaryPrimitives.ReadUInt16BigEndian(query[^4..^2]);

                var answer = reply(qtype);
                if (answer is null) continue; // silence → the client must time out

                var response = new byte[received.ReceivedBytes];
                query.CopyTo(response);
                // Response bit + recursion desired/available, plus the rcode.
                BinaryPrimitives.WriteUInt16BigEndian(
                    response.AsSpan(2, 2), (ushort)(0x8180 | (answer.Value.Rcode & 0x0F)));
                BinaryPrimitives.WriteUInt16BigEndian(
                    response.AsSpan(6, 2), (ushort)answer.Value.AnswerCount);

                // The resolver decides from the header alone, so echoing the
                // question with a corrected header is a sufficient reply.
                await _socket.SendToAsync(response, SocketFlags.None, received.RemoteEndPoint, ct);
            }
        }

        public void Dispose()
        {
            _cts.Cancel();
            _socket.Dispose();
            _cts.Dispose();
        }
    }

    private static DnsEmailDomainResolver ResolverFor(IPEndPoint server, int timeoutMs = 1500)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["EmailDeliverability:DnsServers"] = $"{server.Address}:{server.Port}",
                ["EmailDeliverability:DnsTimeoutMs"] = timeoutMs.ToString(),
            })
            .Build();

        return new DnsEmailDomainResolver(config, NullLogger<DnsEmailDomainResolver>.Instance);
    }

    [Fact]
    public async Task MxRecordPresent_ReportsHasRecords()
    {
        using var server = new FakeDnsServer(qtype => qtype == TypeMx ? (0, 1) : (0, 0));

        (await ResolverFor(server.Endpoint).ResolveAsync("example-with-mx.ie"))
            .Should().Be(DomainMailResolution.HasRecords);

        server.QueriesReceived.Should().Be(1, "an MX hit needs no fallback lookup");
    }

    [Fact]
    public async Task NoMxButAnARecord_ReportsHasRecords()
    {
        // RFC 5321 §5.1 implicit MX: a domain with only an A record still
        // receives mail, so refusing it would refuse real addresses.
        using var server = new FakeDnsServer(qtype => qtype switch
        {
            TypeMx => (0, 0),   // NODATA
            TypeA => (0, 1),
            _ => (0, 0),
        });

        (await ResolverFor(server.Endpoint).ResolveAsync("a-record-only.ie"))
            .Should().Be(DomainMailResolution.HasRecords);
    }

    [Fact]
    public async Task NoMxNoANoAaaa_ReportsNoRecords()
    {
        using var server = new FakeDnsServer(_ => (0, 0));

        (await ResolverFor(server.Endpoint).ResolveAsync("nothing-published.ie"))
            .Should().Be(DomainMailResolution.NoRecords);

        server.QueriesReceived.Should().Be(3, "MX, then A, then AAAA before concluding");
    }

    [Fact]
    public async Task NxDomain_ReportsNoRecordsAndStopsImmediately()
    {
        using var server = new FakeDnsServer(_ => (3, 0)); // NXDOMAIN

        (await ResolverFor(server.Endpoint).ResolveAsync("no-such-domain-at-all.ie"))
            .Should().Be(DomainMailResolution.NoRecords);

        server.QueriesReceived.Should().Be(1,
            "NXDOMAIN is authoritative for the whole name; a follow-up timeout must not downgrade it to allow");
    }

    [Fact]
    public async Task ServFail_ReportsLookupFailed()
    {
        // 🔴 SERVFAIL means the resolver could not answer. Treating it as
        // "no records" is what turns a DNS incident into a total sign-up
        // outage — the exact failure this whole design avoids.
        using var server = new FakeDnsServer(_ => (2, 0)); // SERVFAIL

        (await ResolverFor(server.Endpoint).ResolveAsync("resolver-is-broken.ie"))
            .Should().Be(DomainMailResolution.LookupFailed);
    }

    [Fact]
    public async Task Refused_ReportsLookupFailed()
    {
        using var server = new FakeDnsServer(_ => (5, 0)); // REFUSED

        (await ResolverFor(server.Endpoint).ResolveAsync("resolver-refuses.ie"))
            .Should().Be(DomainMailResolution.LookupFailed);
    }

    [Fact]
    public async Task NoReplyAtAll_ReportsLookupFailed()
    {
        using var server = new FakeDnsServer(_ => null); // never answers

        (await ResolverFor(server.Endpoint, timeoutMs: 300).ResolveAsync("silent-resolver.ie"))
            .Should().Be(DomainMailResolution.LookupFailed);
    }

    [Fact]
    public async Task NoResolverConfigured_ReportsLookupFailedRatherThanRefusing()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                // Present but unparseable, so no endpoint survives and the
                // OS enumeration branch is bypassed.
                ["EmailDeliverability:DnsServers"] = "not-an-ip-address",
            })
            .Build();

        var resolver = new DnsEmailDomainResolver(config, NullLogger<DnsEmailDomainResolver>.Instance);

        (await resolver.ResolveAsync("anything.ie")).Should().Be(DomainMailResolution.LookupFailed);
    }

    [Fact]
    public async Task TruncatedReply_IsTreatedAsRecordsPresent()
    {
        // TC with no answers in the datagram still means records exist; we
        // just did not receive them all. For a presence check that is a yes.
        using var tcServer = new TruncatingDnsServer();

        (await ResolverFor(tcServer.Endpoint).ResolveAsync("truncated-reply.ie"))
            .Should().Be(DomainMailResolution.HasRecords);
    }

    /// <summary>Answers every query with the TC (truncated) bit set and no answers.</summary>
    private sealed class TruncatingDnsServer : IDisposable
    {
        private readonly Socket _socket;
        private readonly CancellationTokenSource _cts = new();

        public TruncatingDnsServer()
        {
            _socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            _socket.Bind(new IPEndPoint(IPAddress.Loopback, 0));
            Endpoint = (IPEndPoint)_socket.LocalEndPoint!;
            _ = Task.Run(ServeAsync);
        }

        public IPEndPoint Endpoint { get; }

        private async Task ServeAsync()
        {
            var buffer = new byte[512];
            while (!_cts.IsCancellationRequested)
            {
                SocketReceiveFromResult received;
                try
                {
                    received = await _socket.ReceiveFromAsync(
                        buffer, SocketFlags.None, new IPEndPoint(IPAddress.Any, 0), _cts.Token);
                }
                catch (OperationCanceledException) { return; }
                catch (SocketException) { return; }
                catch (ObjectDisposedException) { return; }

                var response = buffer.AsSpan(0, received.ReceivedBytes).ToArray();
                BinaryPrimitives.WriteUInt16BigEndian(response.AsSpan(2, 2), 0x8380); // response + TC + NOERROR
                BinaryPrimitives.WriteUInt16BigEndian(response.AsSpan(6, 2), 0);
                await _socket.SendToAsync(response, SocketFlags.None, received.RemoteEndPoint, _cts.Token);
            }
        }

        public void Dispose()
        {
            _cts.Cancel();
            _socket.Dispose();
            _cts.Dispose();
        }
    }
}
