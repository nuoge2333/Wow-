# 🛠️ Debian / Ubuntu 故障排除

> 适用于 Debian、Ubuntu 及其衍生发行版（如 Linux Mint、Pop!_OS）

---

## 常见问题分类

- [启动问题](#启动问题)
- [服务器启动问题](#服务器启动问题)
- [网络问题](#网络问题)
- [权限问题](#权限问题)
- [Java 相关问题](#java-相关问题)
- [其他问题](#其他问题)

---

## 启动问题

### Q: 运行 `./start.sh` 报错 "Permission denied"

**原因：** 脚本没有执行权限。

**解决：**
```bash
chmod +x start.sh
./start.sh