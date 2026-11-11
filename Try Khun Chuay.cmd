@echo off
chcp 65001 >nul
title Khun Chuay - try the bot
cd /d "%~dp0"
call npm run try
pause
