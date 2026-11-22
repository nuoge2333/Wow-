@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set CORE_DIR=%SCRIPT_DIR%core

:: 是否双击运行（有窗口可交互）。平台调用 / CI 时不暂停，避免把自动化脚本挂住。
set "IS_DOUBLE_CLICK=0"
if "%WOW_NO_PAUSE%"=="1" goto :skip_click_check
echo %CMDCMDLINE% | find /i "/c" >nul
if not errorlevel 1 set "IS_DOUBLE_CLICK=1"
:skip_click_check

if not exist "%CORE_DIR%" (
    echo Error: core directory not found at %CORE_DIR%
    call :pause_if_double_click
    exit /b 1
)

pushd "%CORE_DIR%"

:: Detect system architecture
if "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
    set ARCH=x64
) else if "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
    set ARCH=arm64
) else (
    set ARCH=x64
)

set NODE_DIR=node\win\%ARCH%
set NODE_EXE=%NODE_DIR%\node.exe

if not exist "%NODE_EXE%" (
    echo Portable Node.js not found, downloading...
    :: Clean up old installation if exists
    if exist "%NODE_DIR%" rmdir /s /q "%NODE_DIR%" 2>nul
    call :download_node_win %ARCH%
    if errorlevel 1 (
        echo Download failed. Check your network or manually place Node.js into %NODE_DIR%
        popd
        call :pause_if_double_click
        exit /b 1
    )
)

:: ==================== 依赖 ====================
:: 不再只看 node_modules 在不在。git pull / update 之后 package.json 可能变了，
:: 而 node_modules 还是旧的，直接启动就是 Cannot find module。
:: 指纹只取 dependencies / devDependencies（忽略 version），存在 .deps-hash 里。
set "DEP_HASH="
if exist "scripts\deps-hash.ps1" (
    for /f "usebackq delims=" %%h in (`powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\deps-hash.ps1" "package.json"`) do set "DEP_HASH=%%h"
)
set "NEED_INSTALL=0"
if not exist "node_modules" set "NEED_INSTALL=1"
if not "%DEP_HASH%"=="" (
    :: findstr 比 set /p 稳：不会把行尾的 CR 读进变量
    findstr /x /c:"%DEP_HASH%" ".deps-hash" >nul 2>&1
    if errorlevel 1 set "NEED_INSTALL=1"
)

if "!NEED_INSTALL!"=="1" (
    echo Installing dependencies...
    call :install_deps
    if errorlevel 1 (
        echo Failed to install dependencies. Try: cd core ^&^& npm install
        popd
        call :pause_if_double_click
        exit /b 1
    )
    if not "!DEP_HASH!"=="" (
        > ".deps-hash" echo !DEP_HASH!
    )
)

"%NODE_EXE%" src\cli.js %*
set "CLI_RC=%errorlevel%"

if not "%CLI_RC%"=="0" (
    popd
    echo.
    echo An error occurred ^(exit code %CLI_RC%^).
    call :pause_if_double_click
    exit /b %CLI_RC%
)

:: Always keep the window open so the user can read the output (prevents flash-close)
echo.
echo Press any key to exit...
call :pause_if_double_click

popd
exit /b 0

:: ==================== 子过程 ====================

:pause_if_double_click
if not "%IS_DOUBLE_CLICK%"=="1" exit /b 0
pause
exit /b 0

:: 依次尝试 npm 镜像；任一成功即返回 0。失败时删掉半残的 node_modules，
:: 否则下次启动会认为「已安装」而跳过，留下一个永远起不来的环境。
:install_deps
set "INSTALL_OK="
if exist "node_modules" rmdir /s /q "node_modules" 2>nul
for %%r in (
    "https://registry.npmmirror.com"
    "https://mirrors.cloud.tencent.com/npm/"
    "https://mirrors.tuna.tsinghua.edu.cn/npm/"
    "https://registry.npmjs.org"
) do (
    if not defined INSTALL_OK (
        echo   Trying registry: %%~r
        call :run_npm_install "%%~r"
        if not errorlevel 1 set "INSTALL_OK=1"
    )
)
if defined INSTALL_OK exit /b 0
if exist "node_modules" rmdir /s /q "node_modules" 2>nul
exit /b 1

:run_npm_install
set "REG=%~1"
if exist "%NODE_DIR%\extracted\npm.cmd" (
    call "%NODE_DIR%\extracted\npm.cmd" install --no-audit --no-fund --registry "%REG%"
) else if exist "%NODE_DIR%\extracted\node_modules\npm\bin\npm-cli.js" (
    call "%NODE_EXE%" "%NODE_DIR%\extracted\node_modules\npm\bin\npm-cli.js" install --no-audit --no-fund --registry "%REG%"
) else (
    call npm install --no-audit --no-fund --registry "%REG%" 2>nul
)
exit /b %errorlevel%

:download_node_win
set ARCH=%1
set NODE_VERSION=20.17.0
set NODE_ARCHIVE=node-v%NODE_VERSION%-win-%ARCH%.zip
set ZIP_FILE=node-temp.zip
set DL_OK=0

:: 镜像列表（国内优先 -> 官方兜底），逐个尝试
call :try_dl_win "https://registry.npmmirror.com/-/binary/node/v%NODE_VERSION%/%NODE_ARCHIVE%" || ^
call :try_dl_win "https://mirrors.cloud.tencent.com/nodejs-release/v%NODE_VERSION%/%NODE_ARCHIVE%" || ^
call :try_dl_win "https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/v%NODE_VERSION%/%NODE_ARCHIVE%" || ^
call :try_dl_win "https://mirrors.huaweicloud.com/nodejs/v%NODE_VERSION%/%NODE_ARCHIVE%" || ^
call :try_dl_win "https://nodejs.org/dist/v%NODE_VERSION%/%NODE_ARCHIVE%"

if %DL_OK%==0 (
    echo Download failed from all mirrors. Check your network or manually place Node.js into %NODE_DIR%
    pause
    exit /b 1
)

:: Extract
if not exist "%NODE_DIR%" mkdir "%NODE_DIR%"
powershell -Command "& { Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('%ZIP_FILE%', '.'); }"

if errorlevel 1 (
    echo Extraction failed
    del "%ZIP_FILE%" 2>nul
    exit /b 1
)

:: Move files - keep full directory structure for npm
move "node-v%NODE_VERSION%-win-%ARCH%" "%NODE_DIR%\extracted" >nul 2>&1
:: Create node.exe symlink (or copy)
if not exist "%NODE_EXE%" (
    copy "%NODE_DIR%\extracted\node.exe" "%NODE_EXE%" >nul 2>&1
)
del "%ZIP_FILE%"

echo Portable Node.js installed to %NODE_DIR%
exit /b 0

:: 尝试下载单个镜像；成功置 DL_OK=1 并退出，失败删除残留文件
:try_dl_win
set NODE_URL=%~1
echo   Trying mirror: %NODE_URL%
powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%ZIP_FILE%' }"
if %errorlevel%==0 if exist "%ZIP_FILE%" (
    for %%F in ("%ZIP_FILE%") do if %%~zF GTR 0 (
        set DL_OK=1
        echo   OK: downloaded
        exit /b 0
    )
)
echo   Failed, trying next mirror...
del "%ZIP_FILE%" 2>nul
exit /b 1
