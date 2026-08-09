@echo off
REM =============================================================================
REM Project NEXUS .NET Edition - Cloudflare Cache Purge (All Domains) — Windows
REM =============================================================================
REM Purges the Cloudflare cache for all project domains after deployment.
REM Can be run standalone or is called automatically by deploy.sh / deploy-production.bat.
REM
REM Usage:
REM   scripts\purge-cloudflare-cache.bat
REM
REM API Token:
REM   Reads from C:\Users\%USERNAME%\cloudflare-api-token.txt
REM   or CLOUDFLARE_API_TOKEN environment variable
REM =============================================================================

setlocal EnableDelayedExpansion

REM --- Resolve API token ---
if defined CLOUDFLARE_API_TOKEN (
    set "CF_TOKEN=%CLOUDFLARE_API_TOKEN%"
) else (
    set "TOKEN_FILE=C:\Users\%USERNAME%\cloudflare-api-token.txt"
    if exist "!TOKEN_FILE!" (
        set /p CF_TOKEN=<"!TOKEN_FILE!"
    ) else (
        echo [ERROR] Cloudflare API token not found
        echo         Set CLOUDFLARE_API_TOKEN env var or create !TOKEN_FILE!
        exit /b 1
    )
)

echo [INFO] Purging Cloudflare cache for all 8 domains...
echo.

set PURGE_OK=0
set PURGE_FAIL=0

REM --- Purge each zone ---
call :purge_zone "project-nexus.ie"    "d6d9903416081a10ac2d496d9b8456fb"
call :purge_zone "hour-timebank.ie"    "54502ac7dc583e8acdb9b5ed87b0ba60"
call :purge_zone "timebankireland.ie"  "9b5f481234f8f1ab134bf943d6193816"
call :purge_zone "timebank.global"     "7ac1e69f5a1fdc7894236548adf7be1e"
call :purge_zone "nexuscivic.ie"       "65eb5427905a35e7c6186977f8c5a370"
call :purge_zone "project-nexus.net"   "ab50a7ee4c5f427b7bc436db26496c7d"
call :purge_zone "exchangemembers.com" "2a86de7c12258fb6343dc090b6581367"
call :purge_zone "festivalflags.ie"    "e9009e5ca261271de5ea7de4aa3ede62"

echo.
if !PURGE_FAIL! EQU 0 (
    echo [OK] All 8 domains purged successfully
) else (
    echo [WARN] !PURGE_OK! succeeded, !PURGE_FAIL! failed
)

endlocal
exit /b 0

:purge_zone
set "DOMAIN=%~1"
set "ZONE_ID=%~2"

REM Use curl to purge — capture output to temp file
curl -s -o "%TEMP%\cf-purge-result.json" -X POST "https://api.cloudflare.com/client/v4/zones/%ZONE_ID%/purge_cache" -H "Authorization: Bearer %CF_TOKEN%" -H "Content-Type: application/json" --data "{\"purge_everything\":true}" 2>nul

REM Check result (Cloudflare returns "success": true with a space)
findstr /C:"\"success\": true" "%TEMP%\cf-purge-result.json" >nul 2>&1
if !errorlevel! EQU 0 (
    echo   [OK]   %DOMAIN%
    set /a PURGE_OK+=1
) else (
    echo   [FAIL] %DOMAIN%
    set /a PURGE_FAIL+=1
)
goto :eof
