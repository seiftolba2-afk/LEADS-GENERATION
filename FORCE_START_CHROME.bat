@echo off
echo ==========================================
echo LAUNCHING ISOLATED CHROME FOR AUTOMATION
echo ==========================================
echo This will open a dedicated Chrome window that is guaranteed to work.
echo You DO NOT need to close your other Chrome windows!
echo.
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%~dp0whop_profile" https://whop.com/hub/
echo.
echo SUCCESS! Please sign into Whop in the new window if prompted, then tell me "ready".
pause
