@echo off
setlocal enabledelayedexpansion
:: wow~ updater (Windows)
:: Download latest from Gitee (GitHub old repo as fallback) and overwrite.
:: 版本解析：优先 releases/latest；若无 Release 则回退 tags API（过滤 backup/ 等非版本标签，取最大 semver），
:: 直接下载源站 zip，无需私人令牌，也不保留多镜像。

set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

set GITEE_REPO=nuoge233/wow
set GITHUB_REPO=nuoge2333/Wow-
set TEMP_DIR=%TEMP%\wow_update_%RANDOM%
set TEMP_ZIP=%TEMP_DIR%\update.zip

echo ========================================
echo   wow~ Updater
echo ========================================
echo.

:: Create temp dir
mkdir "%TEMP_DIR%" 2>nul

:: Resolve latest tag: releases/latest -> tags API (max semver, filter non-version tags)
powershell -Command ^
  "$ErrorActionPreference='SilentlyContinue';" ^
  "function Get-LatestTag($base,$repo){" ^
  "  try { $r=Invoke-RestMethod -Uri \"$base/repos/$repo/releases/latest\"; if($r.tag_name){return $r.tag_name} } catch {}" ^
  "  try { $tags=Invoke-RestMethod -Uri \"$base/repos/$repo/tags\";" ^
  "    $vs=$tags | Where-Object { $_.name -match '^v?\d+\.\d+\.\d+(-[0-9]+\.[0-9a-fA-F]+)?$' } | ForEach-Object {" ^
  "      $n=$_.name.TrimStart('v');" ^
  "      if($n -match '^(\d+)\.(\d+)\.(\d+)'){ [PSCustomObject]@{name=$_.name; k=([int]$Matches[1]*1000000+[int]$Matches[2]*1000+[int]$Matches[3])} } };" ^
  "    return (($vs | Sort-Object k | Select-Object -Last 1).name) } catch {}" ^
  "  return $null" ^
  "}" ^
  "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;" ^
  "$hosts = @(@('gitee','https://gitee.com/api/v5','nuoge233/wow'), @('github','https://api.github.com','nuoge2333/Wow-'));" ^
  "foreach($h in $hosts){ $t=Get-LatestTag -base $h[1] -repo $h[2]; if($t){ Write-Output ($h[0] + '|' + $t); break } }" ^
  > "%TEMP_DIR%\resolve.txt" 2>nul

set RELEASE_HOST=
set LATEST_TAG=
:: 单行 "host|tag" 解析：避免多行读取与嵌套数组索引歧义
:: 先规范化 resolve.txt（去 BOM/CR），避免 %%b 尾随 \r 导致 host 判断失败
powershell -Command "& { if(Test-Path '%TEMP_DIR%\resolve.txt'){ $c=(Get-Content -Raw '%TEMP_DIR%\resolve.txt').Replace([char]13,'').Trim(); if($c){ Set-Content -NoNewline -Encoding ascii '%TEMP_DIR%\resolve.txt' $c } } }" 2>nul
for /f "usebackq tokens=1,2 delims=|" %%a in ("%TEMP_DIR%\resolve.txt") do (
    if "%%b"=="" (
        set LATEST_TAG=%%a
    ) else (
        set RELEASE_HOST=%%a
        set LATEST_TAG=%%b
    )
)

if "%LATEST_TAG%"=="" (
    echo Cannot access Gitee/GitHub API. Check your network.
    goto :cleanup
)

echo Latest: %LATEST_TAG% (source: %RELEASE_HOST%)
echo.

:: 版本比对：本地已是最新则直接跳过，避免每次启动都重复下载并覆盖自身
:: 版本来源：core/package.json 的 "version": "x.y.z-..."
set CURRENT_TAG=
if exist "%SCRIPT_DIR%core\package.json" (
    for /f "usebackq tokens=2 delims=:" %%v in (`findstr /r /c:"\"version\"" "%SCRIPT_DIR%core\package.json"`) do (
        set RAW=%%v
        set RAW=!RAW: =!
        set RAW=!RAW:,=!
        set RAW=!RAW:"=!
        if not defined CURRENT_TAG set CURRENT_TAG=!RAW!
    )
)
if defined CURRENT_TAG (
    set LT=!LATEST_TAG:v=!
    if /i "!LT!"=="!CURRENT_TAG!" (
        echo Already up to date ^(!CURRENT_TAG!^). Nothing to do.
        goto :cleanup
    )
    echo Local: !CURRENT_TAG!  -^>  %LATEST_TAG%
    echo.
)

:: Build download URL from source archive (works without a published Release)
:: 注意：批处理在解析整个 if()else() 块时即展开 %VAR%，故此处用 goto 分支而非括号块
if "%RELEASE_HOST%"=="gitee" goto :url_gitee
set DOWNLOAD_URL=https://github.com/%GITHUB_REPO%/archive/refs/tags/%LATEST_TAG%.zip
goto :url_done
:url_gitee
set DOWNLOAD_URL=https://gitee.com/%GITEE_REPO%/repository/archive/%LATEST_TAG%.zip
:url_done

if "%DOWNLOAD_URL%"=="" (
    echo Cannot build download URL (tag/host unresolved).
    goto :cleanup
)
echo URL: %DOWNLOAD_URL%
echo.

:: Download
echo Downloading update package...
powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile '%TEMP_ZIP%' }"
if errorlevel 1 (
    echo Download failed.
    goto :cleanup
)
echo Download complete.
echo.

:: Extract
echo Installing update...
mkdir "%TEMP_DIR%\extract" 2>nul
:: V3.5.3 同步：先做 zip 完整性测试，损坏/截断则拒绝覆盖
powershell -Command "& { Add-Type -AssemblyName System.IO.Compression.FileSystem; try { $z=[System.IO.Compression.ZipFile]::OpenRead('%TEMP_ZIP%'); $n=$z.Entries.Count; $z.Dispose(); if($n -lt 1){ exit 1 } else { exit 0 } } catch { exit 1 } }" >nul 2>&1
if errorlevel 1 (
    echo Update package is corrupt or empty. Aborting.
    goto :cleanup
)
powershell -Command "& { Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('%TEMP_ZIP%', '%TEMP_DIR%\extract'); }"
if errorlevel 1 (
    echo Extraction failed.
    goto :cleanup
)

:: Find project root: locate wow.bat, skip core/ subdir
set PROJECT_DIR=
for /r "%TEMP_DIR%\extract" %%f in (wow.bat) do (
    set FULL=%%~dpf
    echo !FULL! | findstr /i "\\core\\" >nul
    if errorlevel 1 (
        set PROJECT_DIR=%%~dpf
        goto :found_project
    )
)
:found_project

if "%PROJECT_DIR%"=="" (
    echo Update package format error: wow.bat not found.
    goto :cleanup
)

:: Overwrite (skip runtime / user-data dirs)
:: V3.5.2 起运行目录为根 scheme/（不再是 server/），必须排除以免覆盖用户方案与存档；
:: update.bat 为正在执行的自更新脚本本体，覆盖会导致运行中的批处理被改写而中断
echo Overwriting files...
for %%i in ("%PROJECT_DIR%*") do (
    set NAME=%%~nxi
    if /i not "!NAME!"=="scheme" if /i not "!NAME!"=="node_modules" if /i not "!NAME!"==".git" if /i not "!NAME!"=="logs" if /i not "!NAME!"=="update.bat" (
        if exist "%%i\" (
            xcopy /E /Y /Q "%%i\*" "%SCRIPT_DIR%\!NAME!\" >nul 2>&1
        ) else (
            copy /Y "%%i" "%SCRIPT_DIR%" >nul 2>&1
        )
    )
)

echo.
echo ========================================
echo   Update complete! %LATEST_TAG% (source: %RELEASE_HOST%)
echo ========================================
echo.
echo Run wow.bat to launch wow~

:cleanup
rmdir /s /q "%TEMP_DIR%" 2>nul
:: 仅在交互式终端（双击运行）才暂停；自动化平台（简幻欢等）/ 由 start.bat 调用时不阻塞
if "%WOW_NO_PAUSE%"=="1" goto :eof
echo %CMDCMDLINE% | find /i "/c" >nul
if errorlevel 1 pause
goto :eof
