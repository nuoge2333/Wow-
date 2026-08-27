@echo off
rem 简幻欢等自定义镜像兼容入口：平台固定执行根目录 start.bat 来启动服务器
rem 实际启动逻辑已统一到 wow.bat，此处仅做转发，避免维护两份脚本
"%~dp0wow.bat" %*
