@echo off
node -e "require('http').get('http://localhost:3131',function(r){process.exit(0)}).on('error',function(){process.exit(1)})" >nul 2>&1
if %errorlevel% neq 0 (
  start /B "" "C:\Program Files\nodejs\node.exe" "D:\LEADS GENERATION\app.js"
  timeout /t 3 /nobreak > nul
)
start http://localhost:3131
