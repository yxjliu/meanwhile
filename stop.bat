@echo off
rem Stops the Meanwhile bridge. It starts again by itself the next time Claude Code does something.
cd /d "%~dp0"
node bridge\server.js --stop
pause
