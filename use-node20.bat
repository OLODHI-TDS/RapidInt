@echo off
echo Switching to Node.js v20 for Azure Functions...
set PATH=C:\Users\Omar.Lodhi\OneDrive - The Dispute Service\Projects\Alto Jupix Integration\Production Ready Concept\node-v20.18.0-win-x64;%PATH%
echo.
echo Node.js version:
node --version
echo.
echo NPM version:
npm --version
echo.
echo ✅ Ready to run Azure Functions!
echo Run: cd azure-functions && func start --port 7071 --cors '*'
echo.
cmd /k