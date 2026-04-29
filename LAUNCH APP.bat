@echo off
title Lead Generator
echo Starting Lead Generator...
start /B node "D:\LEADS GENERATION\app.js"
timeout /t 2 /nobreak > nul
start http://localhost:3131
