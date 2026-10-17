@echo off
start "My Budget server" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
