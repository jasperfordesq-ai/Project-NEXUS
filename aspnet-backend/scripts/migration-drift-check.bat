@echo off
REM Copyright (c) 2024-2026 Jasper Ford
REM SPDX-License-Identifier: AGPL-3.0-or-later
REM
REM Migration Drift Check (Windows)
REM ================================
REM Checks for uncommitted model changes in the local database.
REM For full local vs production comparison, use Git Bash or WSL with the .sh version.
REM
REM Usage:
REM   scripts\migration-drift-check.bat

echo.
echo ============================================
echo   Migration Drift Check (Local)
echo ============================================
echo.

echo [1/2] Checking for uncommitted model changes...
docker compose exec -T api dotnet ef migrations has-pending-model-changes --project /app/src/Nexus.Api
if %ERRORLEVEL% EQU 0 (
    echo   WARNING: DbContext has changes not captured in a migration!
    echo   Run: make migrate NAME=DescriptiveName
    set DRIFT_FOUND=1
) else (
    echo   OK: Model matches last migration.
    set DRIFT_FOUND=0
)

echo.
echo [2/2] Listing local migrations...
docker compose exec -T api dotnet ef migrations list --project /app/src/Nexus.Api

echo.
if "%DRIFT_FOUND%"=="1" (
    echo DRIFT DETECTED - Action required
    exit /b 1
) else (
    echo NO DRIFT - All clear
    exit /b 0
)
