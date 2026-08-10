# =============================================================================
# Dockerfile for Nexus.Api (.NET 10.0)
# Multi-stage build: SDK for build, Runtime for production
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build
# -----------------------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy solution and project files first (better layer caching)
COPY Nexus.sln ./
COPY src/Nexus.Api/Nexus.Api.csproj src/Nexus.Api/
COPY src/Nexus.Contracts/Nexus.Contracts.csproj src/Nexus.Contracts/
COPY src/Nexus.Messaging/Nexus.Messaging.csproj src/Nexus.Messaging/
COPY tests/Nexus.Api.Tests/Nexus.Api.Tests.csproj tests/Nexus.Api.Tests/
# 🔴 Nexus.sln references FIVE projects; this list must contain all five or
# `dotnet restore` fails on the solution with MSB3202. Nexus.Messaging.Tests was
# added upstream in 0f983d61 without a matching COPY, so this image could not be
# built at all — a pre-existing break, not a consequence of the 2026-08-09 move
# (this file is byte-identical to the upstream one). Nothing in CI built this
# image, which is why it went unnoticed; the aspnet-docker-build job added on
# 2026-08-10 is what would now catch it.
COPY tests/Nexus.Messaging.Tests/Nexus.Messaging.Tests.csproj tests/Nexus.Messaging.Tests/

# Restore dependencies
RUN dotnet restore

# Copy everything else
COPY . .

# Build the application
WORKDIR /src/src/Nexus.Api
RUN dotnet build -c Release -o /app/build

# Publish the application
RUN dotnet publish -c Release -o /app/publish /p:UseAppHost=false

# -----------------------------------------------------------------------------
# Stage 2: Runtime (lightweight ASP.NET runtime image)
# EF migrations run via a separate SDK-based step when needed.
# -----------------------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

# Install curl for health checks and create the non-root runtime user.
#
# 🔴 The .NET 10 runtime image is Ubuntu 24.04, not Debian bookworm as .NET 8's
# was. Two consequences, both of which failed the build with exit 127 / useradd
# errors before this was written the way it is now:
#
#   1. Debian's `adduser` wrapper does not exist on Ubuntu's base image. Only
#      `useradd` is present.
#   2. UID 1000 is ALREADY TAKEN by Ubuntu's stock `ubuntu` account, so
#      creating appuser at 1000 fails outright.
#
# UID 1000 is kept deliberately rather than moved to a free number: any host
# bind-mount or existing volume owned by 1000 keeps working exactly as it did
# under .NET 8. The stock `ubuntu` account is unused here, so it is removed to
# free the ID. `--user-group` guarantees the matching `appuser` group that the
# `chown -R appuser:appuser` below depends on.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && if getent passwd ubuntu >/dev/null; then userdel -r ubuntu; fi \
    && useradd --create-home --user-group --uid 1000 --shell /usr/sbin/nologin appuser

# Copy published output only (no source needed at runtime)
COPY --from=build /app/publish .

# Create writable upload storage and switch to non-root user
RUN mkdir -p /app/uploads \
    && chown -R appuser:appuser /app
USER appuser

# Expose port 8080 (container internal port)
EXPOSE 8080

# Configure ASP.NET Core to listen on port 8080
ENV ASPNETCORE_URLS=http://+:8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl --fail http://localhost:8080/health || exit 1

# Entry point
ENTRYPOINT ["dotnet", "Nexus.Api.dll"]
