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

:: V3.5.3 同步：先做 zip 完整性测试，损坏/截断则拒绝覆盖
powershell -Command "& { Add-Type -AssemblyName System.IO.Compression.FileSystem; try { $z=[System.IO.Compression.ZipFile]::OpenRead('%TEMP_ZIP%'); $n=$z.Entries.Count; $z.Dispose(); if($n -lt 1){ exit 1 } else { exit 0 } } catch { exit 1 } }" >nul 2>&1
if errorlevel 1 (
    echo Update package is corrupt or empty. Aborting.
    goto :cleanup
)

:: ==================== V3.5.22：哈希校验（可协商） ====================
:: 背景：SHA256SUMS 此前从未随 Release 上传，这段校验在真实环境里一次都没跑过。
:: 现在三种结局分开处理（与 update.sh 保持一致）：
::   ① 哈希一致          -^> 直接升级
::   ② 哈希不一致        -^> 交互询问，默认【否】；非交互一律拒绝
::   ③ 取不到 SHA256SUMS -^> 交互询问，默认【是】；非交互继续但警告
:: 区别的理由：②有官方基准却对不上（强信号，宁可不装）；③只是缺基准（信息缺失，
:: 不该因此卡住更新，否则首次引入校验时所有人都无法自动更新）。

:: 注意：批处理在解析整个 if()else() 块时即展开 %VAR%，块内 set 的变量读不到新值，
:: 因此这里与上面的 DOWNLOAD_URL 一样用 goto 分支，而不是括号块。
set CHECKSUMS_URL=
if "%RELEASE_HOST%"=="gitee" goto :ck_gitee
set CHECKSUMS_URL=https://github.com/%GITHUB_REPO%/releases/download/%LATEST_TAG%/SHA256SUMS
goto :ck_done
:ck_gitee
set CHECKSUMS_URL=https://gitee.com/%GITEE_REPO%/releases/download/%LATEST_TAG%/SHA256SUMS
:ck_done

:: 是否可交互：/c 表示双击运行（有窗口可读输入）；WOW_NO_PROMPT=1 强制非交互
set IS_INTERACTIVE=0
if "%WOW_NO_PROMPT%"=="1" goto :no_prompt
echo %CMDCMDLINE% | find /i "/c" >nul
if not errorlevel 1 set IS_INTERACTIVE=1
:no_prompt

echo.
echo Checking SHA256SUMS...
powershell -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri '%CHECKSUMS_URL%' -OutFile '%TEMP_DIR%\SHA256SUMS' -UseBasicParsing -TimeoutSec 30 } catch { exit 1 } }" >nul 2>&1

if not exist "%TEMP_DIR%\SHA256SUMS" goto :hash_missing
for %%s in ("%TEMP_DIR%\SHA256SUMS") do if %%~zs==0 goto :hash_missing

:: 计算实际 sha256 并与清单比对
powershell -Command "& { $a=(Get-FileHash -Algorithm SHA256 -Path '%TEMP_ZIP%').Hash.ToLower(); $lines=Get-Content '%TEMP_DIR%\SHA256SUMS'; $ok=$false; foreach($l in $lines){ if((($l -split '\s+')[0]).ToLower() -eq $a){ $ok=$true; break } }; if($ok){ exit 0 } else { Write-Output ('EXPECTED=' + ($lines[0] -split '\s+')[0]); Write-Output ('ACTUAL=' + $a); exit 1 } }" > "%TEMP_DIR%\hash_result.txt" 2>&1
if errorlevel 1 goto :hash_mismatch
echo   Hash verified OK.
goto :hash_done

:hash_mismatch
echo.
echo   !! WARNING: update package hash does NOT match official SHA256SUMS !!
powershell -Command "& { Get-Content '%TEMP_DIR%\hash_result.txt' | Select-Object -First 2 | ForEach-Object { Write-Output ('    ' + $_) } }" 2>nul
echo     Possible causes: tampered download, mirror served wrong content, or stale checksums.
echo     Continuing is risky. Cancel and retry, or download manually and verify.
echo.
call :ask_continue "  Hash mismatch. Continue anyway?" n
if errorlevel 1 (
    del /q "%TEMP_ZIP%" 2>nul
    echo   Update cancelled. Nothing was changed.
    goto :cleanup
)
echo   You chose to continue. Installing unverified content.
goto :hash_done

:hash_missing
echo.
echo   !! No official SHA256SUMS found. Cannot verify package integrity. !!
echo      Zip structure test passed, but content is unverified.
echo.
call :ask_continue "  Continue without hash verification?" y
if errorlevel 1 (
    del /q "%TEMP_ZIP%" 2>nul
    echo   Update cancelled. Nothing was changed.
    goto :cleanup
)
echo   Continuing without hash verification.
goto :hash_done

:hash_done
echo.

:: ==================== 解压 ====================
echo Installing update...
mkdir "%TEMP_DIR%\extract" 2>nul
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
:: 仅在交互式终端（双击运行）才暂停；自动化平台（简幻欢等）调用时不阻塞
if "%WOW_NO_PAUSE%"=="1" goto :eof
echo %CMDCMDLINE% | find /i "/c" >nul
if errorlevel 1 pause
goto :eof

:: ==================== 子过程：确认是否继续 ====================
:: 参数：%1 = 提示语   %2 = 默认值（y 或 n）
:: 返回：errorlevel 0 = 继续；1 = 不继续
:ask_continue
if "%IS_INTERACTIVE%"=="1" goto :ask_interactive
:: 非交互：直接返回默认值，绝不停下来等输入（否则 CI/平台脚本会挂住）
if /i "%~2"=="y" exit /b 0
exit /b 1
:ask_interactive
:: 提示语先存进变量再用 !VAR! 展开，避免路径里的 & , ) 被 cmd 当成命令分隔符
set "ASK_PROMPT=%~1"
if /i "%~2"=="y" (
    set "ASK_HINT=[Y/n]"
) else (
    set "ASK_HINT=[y/N]"
)
set "ASK_ANS="
set /p "ASK_ANS=!ASK_PROMPT! !ASK_HINT! "
if not defined ASK_ANS (
    :: 空回车 / EOF 走默认值
    if /i "%~2"=="y" exit /b 0
    exit /b 1
)
if /i "!ASK_ANS!"=="y" exit /b 0
if /i "!ASK_ANS!"=="yes" exit /b 0
if "!ASK_ANS!"=="是" exit /b 0
exit /b 1
