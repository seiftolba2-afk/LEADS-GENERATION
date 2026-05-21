@echo off
echo Launching Chrome with remote debugging on port 9222...
echo.
echo IMPORTANT: Close ALL other Chrome windows first, then press any key.
echo (If Chrome is still open this will not work)
pause
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data" https://whop.com/hub/
echo.
echo Chrome launched! Now run: node whop_list.js
