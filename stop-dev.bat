@echo off
title Personal Digital Vault - Stopping Development Services
cd /d "%~dp0"

echo ===================================================================
echo               Personal Digital Vault - PDV
echo               Stopping Local Development Services
echo ===================================================================
echo.

echo [1/2] Stopping local dev server processes on ports 8080, 5173, 5174...
powershell -NoProfile -Command "Get-Process -Id (Get-NetTCPConnection -LocalPort 8080,5173,5174 -State Listen -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force" >nul 2>&1

echo [2/2] Shutting down Docker backing containers (PostgreSQL and RustFS)...
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\dev-services.ps1 down

echo.
echo ===================================================================
echo   All Personal Digital Vault services have been stopped cleanly.
echo ===================================================================
echo.
pause
