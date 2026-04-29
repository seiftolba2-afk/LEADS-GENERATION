@echo off
if "%1"=="" (
  echo.
  echo  Usage: leads [number] [industry]
  echo  Industries: roofing ^| solar ^| hvac
  echo  Examples:
  echo    leads 300
  echo    leads 300 roofing
  echo    leads 200 solar
  echo    leads 150 hvac
  echo.
) else (
  node "D:\LEADS GENERATION\leads.js" %1 %2
)
