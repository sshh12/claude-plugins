@echo off
setlocal EnableExtensions
rem windows-computer-use-mcp launcher.
rem stdout is the MCP JSON-RPC channel, so ALL bootstrap output is redirected to stderr (1>&2).
rem On first run this creates a venv and installs the server (slow once); subsequent runs are instant.

set "WCU_HOME=%LOCALAPPDATA%\windows-computer-use-mcp"
set "VENV=%WCU_HOME%\venv"
set "PYEXE=%VENV%\Scripts\python.exe"
if "%WCU_SOURCE%"=="" set "WCU_SOURCE=git+https://github.com/sshh12/windows-computer-use-mcp"

if not exist "%PYEXE%" (
  echo [windows-computer-use] creating venv at "%VENV%" 1>&2
  py -3 -m venv "%VENV%" 1>&2 || python -m venv "%VENV%" 1>&2
  "%PYEXE%" -m pip install --quiet --upgrade pip 1>&2
)

"%PYEXE%" -c "import windows_computer_use" 1>nul 2>nul
if errorlevel 1 (
  echo [windows-computer-use] installing %WCU_SOURCE% 1>&2
  "%PYEXE%" -m pip install --quiet "%WCU_SOURCE%" 1>&2
)

"%PYEXE%" -m windows_computer_use
