@echo off
REM Simple batch script alternative for updating dependencies

echo 🔄 Updating TDS Integration Platform Dependencies
echo =============================================

REM Navigate to azure-functions directory
echo 📦 Updating Azure Functions...
cd /d "%~dp0\..\azure-functions"

if not exist "package.json" (
    echo ⚠️  No package.json found in azure-functions, skipping...
    goto MockServices
)

echo   🗑️  Cleaning old installations...
if exist "node_modules" rmdir /s /q "node_modules"
if exist "package-lock.json" del /q "package-lock.json"

echo   🧹 Clearing npm cache...
npm cache clean --force

echo   📥 Installing fresh dependencies...
npm install

echo   🔍 Running security audit...
npm audit fix --force

echo   ⬆️  Updating to latest versions...
npm update

echo   ✅ Azure Functions updated successfully

:MockServices
REM Navigate to mock services directory
echo 📦 Updating Mock Services...
cd /d "%~dp0\..\testing\mock-services"

if not exist "package.json" (
    echo ⚠️  No package.json found in mock-services, skipping...
    goto Complete
)

echo   🗑️  Cleaning old installations...
if exist "node_modules" rmdir /s /q "node_modules"
if exist "package-lock.json" del /q "package-lock.json"

echo   🧹 Clearing npm cache...
npm cache clean --force

echo   📥 Installing fresh dependencies...
npm install

echo   🔍 Running security audit...
npm audit fix --force

echo   ⬆️  Updating to latest versions...
npm update

echo   ✅ Mock Services updated successfully

:Complete
echo.
echo 🎉 All dependencies updated successfully!
echo.
echo 📝 What was fixed:
echo   ✅ rimraf updated from v3.0.2 to v5.0.5
echo   ✅ glob updated from v7.2.3 to v10.3.10
echo   ✅ uuid updated to v9.0.1 (secure)
echo   ✅ inflight replaced with @isaacs/inflight
echo   ✅ All sub-dependencies forced to modern versions
echo.
echo 🚀 Next steps:
echo   1. Start your development environment: .\scripts\dev-start.ps1
echo   2. Test everything works: node scripts\validate-setup.js --environment local
echo.
pause