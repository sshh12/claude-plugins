@echo off
setlocal EnableExtensions EnableDelayedExpansion
rem windows-computer-use-mcp launcher.
rem stdout is the MCP JSON-RPC channel, so ALL bootstrap output is redirected to stderr (1>&2).
rem First run creates a venv and installs the server (slow once). Later runs auto-update when the
rem GitHub main branch has new commits (a cheap `git ls-remote` HEAD check, ~1s), so pushing to the
rem repo rolls out to clients on their next restart. WCU_SOURCE overrides the source (e.g. a local
rem checkout for testing); for a local/non-git source the auto-update check is skipped.

set "WCU_HOME=%LOCALAPPDATA%\windows-computer-use-mcp"
set "VENV=%WCU_HOME%\venv"
set "PYEXE=%VENV%\Scripts\python.exe"
set "SHAFILE=%WCU_HOME%\installed-sha.txt"
if "%WCU_SOURCE%"=="" set "WCU_SOURCE=git+https://github.com/sshh12/windows-computer-use-mcp"

rem Resolve the current remote main commit (git sources only; best-effort, never fatal).
set "ISGIT="
echo %WCU_SOURCE%| findstr /b /c:"git+" >nul && set "ISGIT=1"
set "GITURL=%WCU_SOURCE:git+=%"
set "REMOTE="
if defined ISGIT (
  where git >nul 2>nul && (
    for /f "tokens=1" %%H in ('git ls-remote "%GITURL%" HEAD 2^>nul') do set "REMOTE=%%H"
  )
)

if not exist "%PYEXE%" (
  echo [windows-computer-use] creating venv at "%VENV%" 1>&2
  py -3 -m venv "%VENV%" 1>&2 || python -m venv "%VENV%" 1>&2
  "%PYEXE%" -m pip install --quiet --upgrade pip 1>&2
)

set "INSTALLED="
if exist "%SHAFILE%" set /p INSTALLED=<"%SHAFILE%"

rem Decide whether to (re)install: missing package, or remote HEAD moved since last install.
"%PYEXE%" -c "import windows_computer_use" 1>nul 2>nul
set "NEED="
if errorlevel 1 set "NEED=install"
if not defined NEED if defined REMOTE if /i not "%REMOTE%"=="%INSTALLED%" set "NEED=update"

if defined NEED (
  if defined REMOTE (
    echo [windows-computer-use] %NEED% @ %REMOTE:~0,8% 1>&2
    "%PYEXE%" -m pip install --quiet --upgrade "%GITURL%@%REMOTE%" 1>&2
    >"%SHAFILE%" echo %REMOTE%
  ) else (
    echo [windows-computer-use] %NEED% %WCU_SOURCE% 1>&2
    "%PYEXE%" -m pip install --quiet --upgrade "%WCU_SOURCE%" 1>&2
  )
)

"%PYEXE%" -m windows_computer_use
