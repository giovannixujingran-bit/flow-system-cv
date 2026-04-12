# Flow System 安装说明

这是一份给普通使用者的简明安装说明。

如果你不会用 Git、Node.js 或命令行，也没关系，按下面步骤操作就可以。

## 最简单的安装方式

如果你拿到的是一个安装包：

1. 解压压缩包
2. 双击 `install-flow-system-from-github.cmd`
3. 等它安装完成
4. 双击 `start-installed-flow-system.cmd`

第一次启动时，如果系统没有检测到共享账号文件，会自动进入初始化页面，让你创建第一个管理员账号。

## 从 GitHub 直接安装

仓库地址：

- [https://github.com/giovannixujingran-bit/flow-system](https://github.com/giovannixujingran-bit/flow-system)

如果你是直接从 GitHub 下载：

1. 打开仓库页面
2. 点击绿色 `Code`
3. 点击 `Download ZIP`
4. 解压下载的 ZIP
5. 双击 `install-flow-system-from-github.cmd`
6. 安装完成后，双击 `start-installed-flow-system.cmd`

## 安装后会发生什么

安装脚本会自动做这些事情：

- 从 GitHub 下载最新的 Flow System
- 安装到 `%USERPROFILE%\\OpenClawProjects\\flow-system`
- 同步仓库里附带的 Flow System 相关 skills

启动脚本会自动做这些事情：

- 下载便携版 Node.js 运行时
- 安装项目依赖
- 启动 Platform Web、Platform API 和本地 Agent

## 首次启动

首次启动后，浏览器通常会自动打开 Flow System 页面。

如果仓库里没有预置账号文件，系统会自动进入“创建第一个管理员”流程。你只需要：

1. 输入管理员用户名
2. 输入显示名称
3. 设置密码
4. 提交创建

创建完成后，就可以直接登录使用。

## 后续更新

以后更新很简单：

1. 双击 `update-flow-system-from-github.cmd`
2. 等更新完成
3. 重新启动 Flow System

更新时默认会尽量保留这些本地数据：

- `runtime/`
- `storage/`
- `.env`
- 本地账号配置文件

## OpenClaw 连接说明

Flow System 可以先安装和启动，哪怕你还没有接好 OpenClaw。

如果还没连接 OpenClaw：

- 系统依然可以启动
- 你之后可以在本地 Agent 的“代理”页面里再补 OpenClaw 连接

## 推荐给 OpenClaw 的说法

如果你已经把这些脚本放到别人电脑上，对方也可以直接对 OpenClaw 说：

```text
请帮我运行 install-flow-system-from-github.cmd，然后启动 Flow System。
```

以后更新时可以说：

```text
请帮我运行 update-flow-system-from-github.cmd，然后重启 Flow System。
```

## 常见问题

### 1. 双击安装后没有反应

请确认：

- Windows 没有拦截脚本执行
- 网络可以访问 GitHub
- 安装目录有写入权限

### 2. 启动后打不开页面

可以稍等 1 到 3 分钟。第一次启动会下载运行时并安装依赖，通常会比后续启动慢一些。

### 3. 我不会用命令行

正常情况下你不需要命令行，直接双击这些文件就行：

- `install-flow-system-from-github.cmd`
- `start-installed-flow-system.cmd`
- `update-flow-system-from-github.cmd`
