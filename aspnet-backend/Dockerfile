# =============================================================================
# Dockerfile for Nexus.Api (.NET 8.0)
# Multi-stage build: SDK for build, Runtime for production
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build
# -----------------------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:8.0.404-bookworm-slim AS build
WORKDIR /src

# Copy solution and project files first (better layer caching)
COPY Nexus.sln ./
COPY src/Nexus.Api/Nexus.Api.csproj src/Nexus.Api/
COPY src/Nexus.Contracts/Nexus.Contracts.csproj src/Nexus.Contracts/
COPY src/Nexus.Messaging/Nexus.Messaging.csproj src/Nexus.Messaging/
COPY tests/Nexus.Api.Tests/Nexus.Api.Tests.csproj tests/Nexus.Api.Tests/

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
FROM mcr.microsoft.com/dotnet/aspnet:8.0-bookworm-slim AS runtime
WORKDIR /app

# Install curl for health checks and create non-root user
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && adduser --disabled-password --gecos "" --uid 1000 appuser

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
