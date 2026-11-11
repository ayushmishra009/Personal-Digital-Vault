@echo off
setlocal EnableDelayedExpansion
title Personal Digital Vault - Development Environment

echo ===================================================================
echo               Personal Digital Vault - PDV
echo            One-Click Local Development Setup
echo ===================================================================
echo.

:: 1. Ensure working directory is repository root
cd /d "%~dp0"

:: 2. Check Prerequisites
echo [1/6] Checking developer tools...
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in PATH.
    echo Please install Node.js v22 or later from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

where pnpm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] pnpm is not found in PATH.
    echo Please install pnpm v10 or later by running: corepack enable
    echo.
    pause
    exit /b 1
)

where go >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Go is not found in PATH.
    echo Please install Go v1.22 or later from https://go.dev/
    echo.
    pause
    exit /b 1
)

where docker >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker is not found in PATH.
    echo Please install Docker Desktop from https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)

:: 3. Verify Docker Daemon is Active
echo [2/6] Verifying Docker daemon is running...
docker info >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Docker daemon is NOT running!
    echo Please launch Docker Desktop, wait until it starts, and then run this script again.
    echo.
    pause
    exit /b 1
)

:: 4. Check Node dependencies
if not exist "node_modules" (
    echo [3/6] Installing Node dependencies via pnpm...
    call pnpm install
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] pnpm install failed.
        pause
        exit /b 1
    )
) else (
    echo [3/6] Node dependencies verified.
)

:: 5. Start Backend Backing Services (PostgreSQL & RustFS/S3)
echo [4/6] Starting Docker backing services: PostgreSQL and RustFS...
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-services.ps1 up
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to start Docker services via scripts\dev-services.ps1.
    pause
    exit /b 1
)

:: Wait for PostgreSQL to accept connections
echo Waiting for PostgreSQL database to be ready...
set /a retries=0
:wait_postgres
ping 127.0.0.1 -n 3 >nul
docker compose --env-file .env -f infrastructure\docker\compose.yaml exec -T postgres pg_isready -U pdv_dev >nul 2>&1
if %ERRORLEVEL% neq 0 (
    set /a retries+=1
    if !retries! geq 15 (
        echo [WARNING] PostgreSQL health check timed out. Attempting migration...
        goto migrate_db
    )
    goto wait_postgres
)

:migrate_db
:: 6. Run Database Migrations
echo [5/6] Applying database schema migrations...
call pnpm db:migrate
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Database migration failed. Check the error output above.
    pause
    exit /b 1
)

:: 7. Free any stale processes on dev ports 8080, 5173, 5174
powershell -NoProfile -Command "Get-Process -Id (Get-NetTCPConnection -LocalPort 8080,5173,5174 -State Listen -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force" >nul 2>&1

:: 8. Launch Applications
echo [6/6] Launching development servers...
echo.
echo ===================================================================
echo   PDV Services Running:
echo     - Vault Web App:   http://localhost:5173
echo     - Admin CMS App:   http://localhost:5174
echo     - Go Backend API:  http://localhost:8080
echo     - RustFS S3 API:   http://localhost:9000
echo.
echo   Opening Vault Web in your browser...
echo   Press Ctrl+C in this terminal window to stop the servers.
echo   To stop Docker services, run: stop-dev.bat
echo ===================================================================
echo.

:: Automatically open browser after 3 seconds
start "" cmd /c "ping 127.0.0.1 -n 4 >nul & start http://localhost:5173"

:: Run turbo dev in parallel (keeps running in this terminal)
call pnpm dev
