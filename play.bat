@echo off
rem Starts the Meanwhile bridge and opens the games in your browser.
cd /d "%~dp0"
node bridge\server.js --open
if errorlevel 1 pause
