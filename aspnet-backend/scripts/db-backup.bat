@echo off
REM =============================================================================
REM Nexus Backend - Database Backup Script (Windows)
REM =============================================================================
REM Creates a timestamped PostgreSQL dump of the nexus_dev database
REM Requires: Docker Compose running (docker compose up -d)
REM Output: backups/db/nexus_dev_YYYYMMDD_HHMMSS.sql
REM =============================================================================

setlocal enabledelayedexpansion

REM Configuration
set COMPOSE_FILE=%~dp0..\compose.yml
set CONTAINER_NAME=nexus-backend-db
set DB_NAME=nexus_dev
set DB_USER=postgres
set BACKUP_DIR=%~dp0..\backups\db

REM Create backup directory if it doesn't exist
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

REM Generate timestamp
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /format:list') do set datetime=%%I
set TIMESTAMP=%datetime:~0,4%%datetime:~4,2%%datetime:~6,2%_%datetime:~8,2%%datetime:~10,2%%datetime:~12,2%
set BACKUP_FILE=nexus_dev_%TIMESTAMP%.sql

echo.
echo ================================================================
echo   Nexus Backend - Database Backup
echo ================================================================
echo.
echo Container: %CONTAINER_NAME%
echo Database:  %DB_NAME%
echo Output:    backups\db\%BACKUP_FILE%
echo.

REM Check if container is running
docker ps --filter "name=%CONTAINER_NAME%" --format "{{.Names}}" | findstr /i "%CONTAINER_NAME%" >nul
if errorlevel 1 (
    echo ERROR: Container %CONTAINER_NAME% is not running.
    echo Run: docker compose -f compose.yml up -d
    exit /b 1
)

REM Execute pg_dump inside the container
echo Creating backup...
docker compose -f "%COMPOSE_FILE%" exec -T db pg_dump -U %DB_USER% -d %DB_NAME% --clean --if-exists > "%BACKUP_DIR%\%BACKUP_FILE%"

if errorlevel 1 (
    echo.
    echo ERROR: Backup failed!
    exit /b 1
)

REM Get file size
for %%A in ("%BACKUP_DIR%\%BACKUP_FILE%") do set SIZE=%%~zA

echo.
echo SUCCESS: Backup created
echo File: backups\db\%BACKUP_FILE%
echo Size: %SIZE% bytes
echo.

endlocal
