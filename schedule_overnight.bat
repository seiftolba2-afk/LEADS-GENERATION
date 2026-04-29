@echo off
:: Register a Windows Task Scheduler job to run all industries at 2:00 AM daily.
:: Run this once as Administrator to set it up.

schtasks /create /tn "LeadAggregator_Overnight" ^
  /tr "\"D:\LEADS GENERATION\run_all.bat\"" ^
  /sc daily /st 02:00 ^
  /ru SYSTEM ^
  /f

echo.
echo Task scheduled: LeadAggregator_Overnight runs every day at 2:00 AM.
echo To view:   schtasks /query /tn LeadAggregator_Overnight
echo To remove: schtasks /delete /tn LeadAggregator_Overnight /f
pause
