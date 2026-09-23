@echo off
title Track Manual
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [Track Manual] O Node.js nao esta instalado.
  echo Baixe a versao LTS em https://nodejs.org , instale e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)
node scripts\iniciar.mjs
if errorlevel 1 pause
