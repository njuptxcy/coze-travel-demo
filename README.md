# Coze Demo App

当前项目现在有两种接法：

- `Chat SDK` 页面：直接在前端嵌入 Coze 官方聊天组件
- `API` 代理：本地后端代理调用 Coze API

当前默认演示页已经改为 `Chat SDK` 版本，更接近 Coze 官方聊天页的卡片和交互表现。

## GitHub Pages 发布

当前最适合公开发布的是 `docs/index.html`。

操作顺序：

1. 在 GitHub 新建一个仓库。
2. 把当前目录上传到仓库。
3. 进入仓库的 `Settings -> Pages`。
4. 在 `Build and deployment` 中选择：
   - `Source`: `Deploy from a branch`
   - `Branch`: `main`
   - `Folder`: `/docs`
5. 保存后等待 GitHub 完成发布。
6. 发布成功后，访问：
   - `https://你的用户名.github.io/你的仓库名/`

## 1. 当前默认启动方式

直接双击：

```text
start.bat
```

然后打开：

```text
http://localhost:3000
```

## 2. 环境变量方式

PowerShell:

```powershell
$env:COZE_PAT="你的新PAT"
$env:COZE_BOT_ID="7622561335737532470"
```

如果不设置 `COZE_BOT_ID`，默认也会使用 `7622561335737532470`。

## 3. 启动 API 代理模式

```powershell
npm start
```

## 4. 说明

- 后端入口文件：`server.js`
- 当前前端页面：`public/index.html`
- Coze 采用三段式调用：
  - `POST /v3/chat`
  - `GET /v3/chat/retrieve`
  - `GET /v3/chat/message/list`
