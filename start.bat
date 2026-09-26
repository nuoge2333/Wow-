@echo off
rem 简幻欢等自定义镜像兼容入口：平台固定执行根目录 start.bat 来启动服务器
rem 实际启动逻辑已统一到 wow.bat，此处先（最佳努力）自检更新，再转发 wow.bat。
setlocal
set "SCRIPT_DIR=%~dp0"

rem 启动前检查更新（运行 update.bat）：
rem   - 优先 Gitee、失败回退 GitHub，全程失败仅警告不阻断启动；
rem   - 可设置环境变量 WOW_SKIP_UPDATE=1 跳过（如本地开发调试）。
if not "%WOW_SKIP_UPDATE%"=="1" (
    if exist "%SCRIPT_DIR%update.bat" (
        echo ▶ 启动前检查更新 (update.bat)...
        call "%SCRIPT_DIR%update.bat"
        if errorlevel 1 (
            echo ⚠️ 更新检查失败，继续启动（不影响服务）
        ) else (
            echo ▶ 更新检查完成
        )
    )
)

"%~dp0wow.bat" %*
