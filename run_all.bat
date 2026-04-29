@echo off
:: Run all 8 industries sequentially — one completes before the next starts.
:: Each writes its own progress file so a crash only loses one industry.
:: Logs to tasks\run_log.txt

set LOG=D:\LEADS GENERATION\tasks\run_log.txt
echo. >> "%LOG%"
echo ============================================ >> "%LOG%"
echo Run started: %date% %time% >> "%LOG%"
echo ============================================ >> "%LOG%"

echo.
echo [1/8] Roofing...
node "D:\LEADS GENERATION\local_aggregator.js" >> "%LOG%" 2>&1
echo [1/8] Roofing done.

echo [2/8] Solar...
node "D:\LEADS GENERATION\solar_aggregator.js" >> "%LOG%" 2>&1
echo [2/8] Solar done.

echo [3/8] HVAC...
node "D:\LEADS GENERATION\hvac_aggregator.js" >> "%LOG%" 2>&1
echo [3/8] HVAC done.

echo [4/8] Plumbing...
node "D:\LEADS GENERATION\plumbing_aggregator.js" >> "%LOG%" 2>&1
echo [4/8] Plumbing done.

echo [5/8] Electrical...
node "D:\LEADS GENERATION\electrical_aggregator.js" >> "%LOG%" 2>&1
echo [5/8] Electrical done.

echo [6/8] Landscaping...
node "D:\LEADS GENERATION\landscaping_aggregator.js" >> "%LOG%" 2>&1
echo [6/8] Landscaping done.

echo [7/8] Painting...
node "D:\LEADS GENERATION\painting_aggregator.js" >> "%LOG%" 2>&1
echo [7/8] Painting done.

echo [8/8] General Contracting...
node "D:\LEADS GENERATION\general_contracting_aggregator.js" >> "%LOG%" 2>&1
echo [8/8] General Contracting done.

echo.
echo ============================================ >> "%LOG%"
echo Run finished: %date% %time% >> "%LOG%"
echo ============================================ >> "%LOG%"

echo [9/9] Best 20...
node "D:\LEADS GENERATION\best.js" --top 20 >> "%LOG%" 2>&1
echo [9/9] Best 20 done.

echo.
echo ============================================ >> "%LOG%"
echo Run finished: %date% %time% >> "%LOG%"
echo ============================================ >> "%LOG%"

echo All industries complete. Log: %LOG%
pause
