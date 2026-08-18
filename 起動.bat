@echo off
chcp 65001 > nul
cd /d "%~dp0"
title Kikaku Kanri Tool
echo Starting... (browser will open in a few seconds)
start "" http://127.0.0.1:5057
python app.py
pause
