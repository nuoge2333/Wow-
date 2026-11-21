@echo off
setlocal enabledelayedexpansion
:: wow~ updater (Windows)
:: Download latest from Gitee (GitHub old repo as fallback) and overwrite.
:: 版本解析：优先 releases/latest；若无 Release 则回退 tags API（过滤 backup/ 等非版本标签，取最大 semver），
:: 直接下载源站 zip，无需私人令牌，也不保留多镜像。

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

set GITEE_REPO=nuoge233/wow
set GITHUB_REPO=nuoge2333/Wow-
set TEMP_DIR=%TEMP%\wow_update_%RANDOM%
set TEMP_ZIP=%TEMP_DIR%\update.zip

:: 覆盖前备份代码（与 update.sh 同一套策略：只备代码，不碰 scheme/ 与配置）
set BACKUP_ROOT=%SCRIPT_DIR%backup
set BACKUP_KEEP=3

echo ========================================
echo   wow~ Updater
echo ========================================
echo.

:: ==================== 参数（联网之前处理，断网也能救火）====================
if /i "%~1"=="--rollback"    goto :act_rollback
if /i "%~1"=="--list"        goto :act_list
if /i "%~1"=="--backup-only" goto :act_backup_only
if /i "%~1"=="-h"            goto :act_help
if /i "%~1"=="--help"        goto :act_help
if not "%~1"=="" (
    echo Unknown option: %~1
    call :show_usage
    goto :cleanup
)

:: Create temp dir
mkdir "%TEMP_DIR%" 2>nul

:: Resolve latest tag from BOTH Gitee and GitHub, then pick the newer one.
:: Gitee is primary; if Gitee is stale (GitHub strictly newer), GitHub is used instead
:: (Gitee mirror sync may lag behind GitHub). Fallback to whichever is reachable.
powershell -Command ^
  "$ErrorActionPreference='SilentlyContinue';" ^
  "function Get-LatestTag($base,$repo){" ^
  "  try { $r=Invoke-RestMethod -Uri \"$base/repos/$repo/releases/latest\"; if($r.tag_name){return $r.tag_name} } catch {}" ^
  "  try { $tags=Invoke-RestMethod -Uri \"$base/repos/$repo/tags\";" ^
  "    $vs=$tags | Where-Object { $_.name -match '^v?\d+\.\d+\.\d+(-[0-9]+\.[0-9a-fA-F]+)?$' } | ForEach-Object {" ^
  "      $n=$_.name.TrimStart('v');" ^
  "      if($n -match '^(\d+)\.(\d+)\.(\d+)'){ [PSCustomObject]@{name=$_.name; k=([int]$Matches[1]*1000000+[int]$Matches[2]*1000+[int]$Matches[3])} } };" ^
  "    return (($vs | Sort-Object k | Select-Object -Last 1).name) } catch {}" ^
  "  return $null }" ^
  "function VerCmp($a,$b){" ^
  "  $a=$a.TrimStart('v'); $b=$b.TrimStart('v');" ^
  "  $ba=($a -split '-')[0].Split('.'); $bb=($b -split '-')[0].Split('.');" ^
  "  for($i=0;$i -lt 3;$i++){ $x=[int]$ba[$i]; $y=[int]$bb[$i]; if($x -ne $y){return $x-$y} }" ^
  "  $ya=if(($a -split '-').Length -gt 1){($a -split '-')[1].Split('.')}else{@('0','0')};" ^
  "  $yb=if(($b -split '-').Length -gt 1){($b -split '-')[1].Split('.')}else{@('0','0')};" ^
  "  $xy=[int]$ya[0]; $yy=[int]$yb[0]; if($xy -ne $yy){return $xy-$yy};" ^
  "  $nx=if($ya.Length -gt 1){[convert]::ToInt32($ya[1],16)}else{0};" ^
  "  $ny=if($yb.Length -gt 1){[convert]::ToInt32($yb[1],16)}else{0};" ^
  "  return $nx-$ny }" ^
  "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;" ^
  "$g=Get-LatestTag -base 'https://gitee.com/api/v5' -repo 'nuoge233/wow';" ^
  "$h=Get-LatestTag -base 'https://api.github.com' -repo 'nuoge2333/Wow-';" ^
  "$chosen=''; $hostName='';" ^
  "if($g -and $h){ if((VerCmp $h $g) -gt 0){ $chosen=$h; $hostName='github' } else { $chosen=$g; $hostName='gitee' } }" ^
  "elseif($g){ $chosen=$g; $hostName='gitee' }" ^
  "elseif($h){ $chosen=$h; $hostName='github' }" ^
  "if($chosen){ Write-Output ($hostName + '|' + $chosen) }" ^
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

:: ==================== 覆盖前备份 ====================
:: 备份放在覆盖之前：备份失败就中止更新，宁可这次不升，
:: 也不能让用户落到「升完发现坏了、又退不回去」。
echo Backing up current code...
call :backup_current "pre-update" ""
if errorlevel 1 (
    echo.
    echo Backup failed ^(disk full or permission denied^). Update aborted, nothing changed.
    goto :cleanup
)
echo   Backed up to: !BK_DEST!
set "OLD_PKG=!BK_DEST!\core\package.json"

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

:: ==================== 依赖变化检测 ====================
call :check_deps

echo.
echo ========================================
echo   Update complete! %LATEST_TAG% (source: %RELEASE_HOST%)
echo ========================================
echo.
echo Run wow.bat to launch wow~
echo.
echo If the new version misbehaves, roll back with:
echo     update.bat --rollback
echo   Backups live in backup\ (latest %BACKUP_KEEP% kept)

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

:: ==================== 备份 / 回滚 ====================

:act_help
call :show_usage
goto :cleanup

:act_list
if not exist "%BACKUP_ROOT%" (
    echo No backups yet. A backup is created automatically before each update.
    goto :cleanup
)
echo Available backups ^(newest first^):
for /f "delims=" %%d in ('dir /b /ad /o-d "%BACKUP_ROOT%" 2^>nul') do (
    if exist "%BACKUP_ROOT%\%%d\COMPLETE" (
        set "BV="
        set /p BV=<"%BACKUP_ROOT%\%%d\VERSION"
        echo   %%d  [version !BV!]
    ) else (
        echo   %%d  -- incomplete, skipped
    )
)
goto :cleanup

:act_backup_only
echo Backing up current code...
call :backup_current "manual" ""
if errorlevel 1 (
    echo Backup failed ^(disk full or permission denied^).
    goto :cleanup
)
echo   Backed up to: !BK_DEST!
echo   Roll back with: update.bat --rollback "!BK_DEST!"
goto :cleanup

:act_rollback
set "RB_TARGET=%~2"
call :get_version
set "CUR_VER=!VER!"
if defined RB_TARGET goto :rb_have_target

:: 自动选目标：最新的「完整且版本与当前不同」的备份。
:: 跳过同版本，避免踩到回滚前自动生成的快照，连按两次原地打转。
for /f "delims=" %%d in ('dir /b /ad /o-d "%BACKUP_ROOT%" 2^>nul') do (
    if not defined RB_TARGET if exist "%BACKUP_ROOT%\%%d\COMPLETE" (
        set "BV="
        set /p BV=<"%BACKUP_ROOT%\%%d\VERSION"
        if /i not "!BV!"=="!CUR_VER!" set "RB_TARGET=%BACKUP_ROOT%\%%d"
    )
)
:: 只有同版本备份时，退回最新一个完整备份
if not defined RB_TARGET (
    for /f "delims=" %%d in ('dir /b /ad /o-d "%BACKUP_ROOT%" 2^>nul') do (
        if not defined RB_TARGET if exist "%BACKUP_ROOT%\%%d\COMPLETE" set "RB_TARGET=%BACKUP_ROOT%\%%d"
    )
)

:rb_have_target
if not defined RB_TARGET (
    echo No backup available to roll back to.
    echo Backups are created automatically before each update, in: %BACKUP_ROOT%
    goto :cleanup
)
if not exist "%RB_TARGET%\COMPLETE" (
    echo Backup is incomplete ^(was it interrupted?^): %RB_TARGET%
    echo Try: update.bat --list
    goto :cleanup
)
if not exist "%RB_TARGET%\core\src\cli.js" (
    echo Backup is incomplete ^(missing core\src\cli.js^): %RB_TARGET%
    goto :cleanup
)

echo ========================================
echo   wow~ Rollback
echo ========================================
echo.
echo Backup:  %RB_TARGET%
set "BV="
set /p BV=<"%RB_TARGET%\VERSION"
echo Version: !BV!
echo Current: !CUR_VER!
if /i "!BV!"=="!CUR_VER!" (
    echo.
    echo WARNING: backup has the same version as current; files are restored but version stays.
)
echo.

:: 回滚前也留一份当前版本；把回滚目标作为受保护目录传下去
call :backup_current "pre-rollback" "%RB_TARGET%"
if errorlevel 1 (
    echo WARNING: failed to back up current code ^(disk full?^), continuing.
) else (
    echo Current code backed up to: !BK_DEST!
)
echo.
echo Restoring code ^(scheme\, node_modules and core\wow.yaml are left untouched^)...
call :restore_from "%RB_TARGET%"
if errorlevel 1 (
    echo.
    echo Some files failed to copy. The install may be in a mixed state.
    echo Retry, or copy manually from: %RB_TARGET%
    goto :cleanup
)
call :get_version
echo.
echo ========================================
echo   Rolled back to !VER!
echo ========================================
echo.
echo Run wow.bat to launch wow~
goto :cleanup

:: ==================== 子过程 ====================

:show_usage
echo.
echo Usage: update.bat [option]
echo.
echo   (no option)        Check for updates and install ^(backs up code first^)
echo   --rollback         Roll back to the most recent different-version backup
echo   --rollback ^<dir^>  Roll back to a specific backup directory
echo   --list             List available backups
echo   --backup-only      Back up current code only ^(no network^)
echo   -h, --help         Show this help
echo.
echo Backups live in: %BACKUP_ROOT%  ^(latest %BACKUP_KEEP% kept^)
echo Backups never include scheme\, node_modules or core\wow.yaml.
exit /b 0

:get_version
set "VER=unknown"
set "TMPVER="
if not exist "%SCRIPT_DIR%core\package.json" exit /b 0
for /f "usebackq tokens=2 delims=:" %%v in (`findstr /r /c:"\"version\"" "%SCRIPT_DIR%core\package.json"`) do (
    set "RAW=%%v"
    set "RAW=!RAW: =!"
    set "RAW=!RAW:,=!"
    set "RAW=!RAW:"=!"
    if not defined TMPVER set "TMPVER=!RAW!"
)
if defined TMPVER set "VER=!TMPVER!"
exit /b 0

:backup_current
set "BK_LABEL=%~1"
set "BK_PROTECT=%~2"
set "BK_DEST="
call :get_version
set "BK_STAMP="
for /f "usebackq delims=" %%t in (`powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd-HHmmss'"`) do set "BK_STAMP=%%t"
if not defined BK_STAMP set "BK_STAMP=manual-%RANDOM%%RANDOM%"
set "BK_TMP=%BACKUP_ROOT%\.tmp-!BK_STAMP!"
set "BK_FINAL=%BACKUP_ROOT%\!BK_STAMP!-!VER!-!BK_LABEL!"
if not exist "%BACKUP_ROOT%" mkdir "%BACKUP_ROOT%" 2>nul
:: 清掉上次被打断留下的半成品
for /d %%t in ("%BACKUP_ROOT%\.tmp-*") do rd /s /q "%%t" 2>nul
mkdir "%BK_TMP%" 2>nul
for %%i in (core\src core\scripts core\data core\package.json web themes docs wow.bat wow.sh README.MD LICENSE) do (
    if exist "%SCRIPT_DIR%%%i\" (
        xcopy /E /I /Y /Q "%SCRIPT_DIR%%%i" "%BK_TMP%\%%i\" >nul 2>&1
    ) else if exist "%SCRIPT_DIR%%%i" (
        for %%p in ("%%i") do if not exist "%BK_TMP%\%%~pi" mkdir "%BK_TMP%\%%~pi" 2>nul
        copy /Y "%SCRIPT_DIR%%%i" "%BK_TMP%\%%i" >nul 2>&1
    )
)
if not exist "%BK_TMP%\core\src\cli.js" (
    rd /s /q "%BK_TMP%" 2>nul
    exit /b 1
)
> "%BK_TMP%\VERSION" echo !VER!
> "%BK_TMP%\COMPLETE" echo ok
move "%BK_TMP%" "%BK_FINAL%" >nul 2>&1
if errorlevel 1 (
    rd /s /q "%BK_TMP%" 2>nul
    exit /b 1
)
set "BK_DEST=!BK_FINAL!"
call :prune_backups "%BK_PROTECT%"
exit /b 0

:prune_backups
set "PR_PROTECT=%~1"
set /a PR_N=0
for /f "delims=" %%d in ('dir /b /ad /o-d "%BACKUP_ROOT%" 2^>nul') do (
    if exist "%BACKUP_ROOT%\%%d\COMPLETE" (
        if /i not "%BACKUP_ROOT%\%%d"=="!PR_PROTECT!" (
            set /a PR_N+=1
            if !PR_N! GTR !BACKUP_KEEP! rd /s /q "%BACKUP_ROOT%\%%d" 2>nul
        )
    )
)
exit /b 0

:restore_from
set "RS_SRC=%~1"
set "RS_FAIL=0"
for %%i in (core\src core\scripts core\data core\package.json web themes docs wow.bat wow.sh README.MD LICENSE) do (
    if exist "%RS_SRC%\%%i\" (
        xcopy /E /I /Y /Q "%RS_SRC%\%%i" "%SCRIPT_DIR%%%i\" >nul 2>&1
        if errorlevel 1 set "RS_FAIL=1"
    ) else if exist "%RS_SRC%\%%i" (
        copy /Y "%RS_SRC%\%%i" "%SCRIPT_DIR%%%i" >nul 2>&1
        if errorlevel 1 set "RS_FAIL=1"
    )
)
exit /b !RS_FAIL!

:: ==================== 依赖 ====================

:check_deps
call :deps_hash "%SCRIPT_DIR%core\package.json"
set "NEW_HASH=!DEP_HASH!"
call :deps_hash "%OLD_PKG%"
set "OLD_HASH=!DEP_HASH!"
if not defined NEW_HASH goto :deps_done
if not defined OLD_HASH goto :deps_changed
if /i "!NEW_HASH!"=="!OLD_HASH!" goto :deps_done

:deps_changed
echo.
echo WARNING: dependencies in core\package.json changed in this update.
echo The old node_modules is not replaced; startup may fail with Cannot find module.
call :ask_continue "  Install dependencies now?" y
if errorlevel 1 (
    echo   Skipped. Run: cd core ^&^& npm install
    goto :deps_done
)
call :install_deps_update
if errorlevel 1 (
    echo   Dependency install failed. Run: cd core ^&^& npm install
) else (
    echo   Dependencies installed.
)

:deps_done
if defined NEW_HASH (
    > "%SCRIPT_DIR%core\.deps-hash" echo !NEW_HASH!
)
exit /b 0

:deps_hash
set "DEP_HASH="
if not exist "%~1" exit /b 0
if not exist "%SCRIPT_DIR%core\scripts\deps-hash.ps1" exit /b 0
for /f "usebackq delims=" %%h in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%core\scripts\deps-hash.ps1" "%~1"`) do set "DEP_HASH=%%h"
exit /b 0

:install_deps_update
set "INSTALL_OK="
if exist "%SCRIPT_DIR%core\node_modules" rmdir /s /q "%SCRIPT_DIR%core\node_modules" 2>nul
pushd "%SCRIPT_DIR%core"
for %%r in (
    "https://registry.npmmirror.com"
    "https://mirrors.cloud.tencent.com/npm/"
    "https://mirrors.tuna.tsinghua.edu.cn/npm/"
    "https://registry.npmjs.org"
) do (
    if not defined INSTALL_OK (
        echo   Trying registry: %%~r
        call :run_npm_install_update "%%~r"
        if not errorlevel 1 set "INSTALL_OK=1"
    )
)
popd
if defined INSTALL_OK exit /b 0
if exist "%SCRIPT_DIR%core\node_modules" rmdir /s /q "%SCRIPT_DIR%core\node_modules" 2>nul
exit /b 1

:run_npm_install_update
set "REG=%~1"
where npm >nul 2>&1
if not errorlevel 1 (
    call npm install --no-audit --no-fund --registry "%REG%"
    exit /b !errorlevel!
)
for /d %%a in ("%SCRIPT_DIR%core\node\win\*") do (
    if exist "%%a\node.exe" if exist "%%a\extracted\node_modules\npm\bin\npm-cli.js" (
        call "%%a\node.exe" "%%a\extracted\node_modules\npm\bin\npm-cli.js" install --no-audit --no-fund --registry "%REG%"
        exit /b !errorlevel!
    )
)
exit /b 1
