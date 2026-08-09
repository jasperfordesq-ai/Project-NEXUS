@echo off
REM =============================================================================
REM Nexus Backend - Database Restore Script (Windows)
REM =============================================================================
REM Restores a PostgreSQL dump to the nexus_dev database
REM Requires: Docker Compose running (docker compose up -d)
REM CAUTION: This will OVERWRITE all existing data!
REM =============================================================================

setlocal enabledelayedexpansion

REM Configuration
set COMPOSE_FILE=%~dp0..\compose.yml
set CONTAINER_NAME=nexus-backend-db
set DB_NAME=nexus_dev
set DB_USER=postgres
set BACKUP_DIR=%~dp0..\backups\db

REM Check if backup file was provided
if "%~1"=="" (
    echo.
    echo ================================================================
    echo   Nexus Backend - Database Restore
    echo ================================================================
    echo.
    echo Usage: db-restore.bat ^<backup-file^>
    echo.
    echo Available backups:
    echo.
    if exist "%BACKUP_DIR%\*.sql" (
        for %%F in ("%BACKUP_DIR%\*.sql") do echo   - %%~nxF
    ) else (
        echo   (no backups found)
    )
    echo.
    echo Example: db-restore.bat nexus_dev_20260203_120000.sql
    echo.
    exit /b 1
)

set BACKUP_FILE=%~1

REM Check if file exists (with or without path)
if exist "%BACKUP_FILE%" (
    set FULL_PATH=%BACKUP_FILE%
) else if exist "%BACKUP_DIR%\%BACKUP_FILE%" (
    set FULL_PATH=%BACKUP_DIR%\%BACKUP_FILE%
) else (
    echo.
    echo ERROR: Backup file not found: %BACKUP_FILE%
    echo.
    exit /b 1
)

echo.
echo ================================================================
echo   Nexus Backend - Database Restore
echo ================================================================
echo.
echo Container: %CONTAINER_NAME%
echo Database:  %DB_NAME%
echo Backup:    %FULL_PATH%
echo.
echo WARNING: This will OVERWRITE all existing data in %DB_NAME%!
echo.
set /p CONFIRM="Type YES to confirm: "

if /i not "%CONFIRM%"=="YES" (
    echo.
    echo Restore cancelled.
    exit /b 0
)

REM Check if container is running
docker ps --filter "name=%CONTAINER_NAME%" --format "{{.Names}}" | findstr /i "%CONTAINER_NAME%" >nul
if errorlevel 1 (
    echo.
    echo ERROR: Container %CONTAINER_NAME% is not running.
    echo Run: docker compose -f compose.yml up -d
    exit /b 1
)

echo.
echo Restoring database...
docker compose -f "%COMPOSE_FILE%" exec -T db psql -U %DB_USER% -d %DB_NAME% < "%FULL_PATH%"

if errorlevel 1 (
    echo.
    echo ERROR: Restore failed!
    exit /b 1
)

echo.
echo SUCCESS: Database restored from %BACKUP_FILE%
echo.
echo NOTE: You may need to restart the API container:
echo   docker compose restart api
echo.

endlocal
