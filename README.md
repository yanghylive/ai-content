# AI Content

AI Content 是一套面向内容团队与独立创作者的 AI 内容生产系统，覆盖信息采集、素材整理、选题挖掘、文章创作、小红书卡图、模板管理、发布与计划任务等完整工作流。

它可以帮助你把内容生产链路统一到一个自托管系统中，用更少的切换完成从“找内容”到“出内容”的全过程。
<img width="2764" height="1654" alt="image" src="https://github.com/user-attachments/assets/8c7212ec-46ee-432a-a3f7-2d29e883c35b" />
<img width="2672" height="1568" alt="image" src="https://github.com/user-attachments/assets/b43e354e-4d53-4c25-81bb-d43240567163" />
<img width="2772" height="1648" alt="image" src="https://github.com/user-attachments/assets/5ffeaf34-5c30-4274-b61f-e1f0dc8aa560" />
<img width="2766" height="1634" alt="image" src="https://github.com/user-attachments/assets/827d7467-fd25-44b2-9391-a9f878967dbe" />
<img width="2750" height="1606" alt="image" src="https://github.com/user-attachments/assets/85f9d4bf-5045-4523-b112-b56ee5dde865" />
<img width="2726" height="1626" alt="image" src="https://github.com/user-attachments/assets/0ab7d4ea-5627-494b-9018-611654492842" />

## 核心功能

- 信息源管理与自动采集
- 素材管理、筛选与图片过滤
- 选题挖掘与 AI 评分
- 文章创作，支持 Markdown 与 HTML 模板
- 小红书笔记与成品卡图生成
- 风格管理与文章模板管理
- AI 平台、模型与默认模型配置
- 内容策略管理
- 发布管理与计划任务
- 后台账号登录、会话与系统日志

## 技术栈

- 前端：Next.js、React、HeroUI、Tailwind CSS
- 后端：NestJS、Prisma
- 数据层：PostgreSQL、Redis
- AI 能力：OpenAI 兼容模型接入
- 内容采集：RSS、API、网页抓取
- 其他能力：Markdown 渲染、HTML 模板生成、图片处理

## 安装步骤

### 1. 获取项目

```bash
git clone <your-repo-url> ai-content
cd ai-content
```

### 2. 配置环境变量

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

### 3. 启动数据库与 Redis

```bash
docker compose up -d
```

### 4. 初始化数据库

```bash
cd backend
npm install
npm run db:init
```

### 5. 创建管理员账号

```bash
npm run db:bootstrap-admin -- --username admin --password '请替换为你的强密码' --email admin@example.com --name 管理员
```

### 6. 启动后端服务

```bash
npm run start:dev
```

默认接口地址：

- API：`http://localhost:3001/api`
- Swagger：`http://localhost:3001/api/docs`

### 7. 启动前端服务

```bash
cd ../frontend
npm install
npm run dev
```

默认访问地址：

- Dashboard：`http://localhost:3000`

## 首次使用

首次登录后，建议按下面顺序完成配置：

1. 在“配置管理 -> AI 平台”中添加模型服务商
2. 在“配置管理 -> AI 模型”中添加可用模型
3. 在“配置管理 -> 默认模型”中设置文章创作与选题推荐默认模型
4. 在“配置管理 -> 采集源配置”中初始化默认信息源
5. 在“风格管理”和“文章模板”中补齐你的内容风格与模板
6. 在“素材管理”中开始采集内容
7. 在“精选选题库”中生成与筛选选题
8. 在“我的文章”或“小红书笔记”中完成内容创作

## 简单使用说明

### 支持的 AI 协议

当前版本支持 `OpenAI 兼容协议`。

也就是说，只要你的模型服务商兼容以下这类接口形式，就可以直接接入：

- 文本对话：`/chat/completions`
- 图片生成：`/images/generations`

常见可接入类型：

- OpenAI 官方接口
- 各类 OpenAI 兼容中转平台
- 自建兼容网关
- 兼容 OpenAI 协议的本地模型服务

### AI 平台怎么配置

进入“配置管理 -> AI 平台”，新增一个平台时填写：

- 平台名称：例如 `OpenAI`、`OpenRouter`、`My Gateway`
- Base URL：通常填写到 API 版本层级，例如 `https://api.openai.com/v1`
- API Key：对应平台的密钥

填写建议：

- `Base URL` 一般建议以 `/v1` 结尾
- 如果你误填成 `/v1/chat/completions`，系统会自动修正
- 保存后建议先到“AI 模型”里添加模型，再做测试

### AI 模型怎么配置

进入“配置管理 -> AI 模型”，新增模型时填写：

- 模型名称：后台展示用名称，例如 `GPT-4.1 Mini`
- 模型 ID：实际请求时使用的模型标识，例如 `gpt-4.1-mini`
- 所属平台：选择刚刚创建的 AI 平台

建议至少准备两类模型：

- 一个文本模型：用于选题评分、文章生成、内容改写
- 一个图片模型：用于封面图或小红书卡图生成

### 默认模型怎么配置

进入“配置管理 -> 默认模型”，至少要配置这两个必需项：

- 文章创作
- 选题推荐

可选但建议配置：

- 图片创作
- X 采集

如果不配置前两个必需项，文章生成和选题流程无法正常使用。

### 信息源怎么配置

进入“配置管理 -> 采集源配置”后，可以直接初始化默认信息源。

当前支持的信息源类型包括：

- RSS
- API
- 网页抓取

如果只是先把系统跑起来，建议先用默认信息源开始，再按自己的业务场景调整。

### 图片与存储说明

如果你需要更稳定地保存 AI 生成图片，可以在“配置管理 -> 存储配置”里配置七牛云。

说明如下：

- 不配置七牛云时，部分平台返回的临时图片链接仍可直接使用
- 如果图片平台返回的是 `base64` 数据，建议配置七牛云，否则图片无法持久化保存
- 小红书卡图、封面图、素材图片这类场景，建议开启七牛云存储

### 最短可用路径

如果你想最快把系统用起来，按下面做即可：

1. 创建 1 个 AI 平台
2. 创建 1 个文本模型
3. 在“默认模型”里设置“文章创作”和“选题推荐”
4. 初始化默认信息源
5. 进入“素材管理”开始采集
6. 进入“精选选题库”生成选题
7. 进入“我的文章”或“小红书笔记”开始创作

## 常用命令

### backend

```bash
npm install
npm run db:init
npm run db:bootstrap-admin -- --username admin --password 'your-password' --email admin@example.com --name 管理员
npm run setup:check
npm run start:dev
npm run build
npm test
```

### frontend

```bash
npm install
npm run dev
npm run build
npm run lint
```

## 许可协议

本项目采用 [Personal Use Only License v1.0](./LICENSE)。

许可要点：

- 允许个人学习、研究、实验和非商业使用
- 禁止企业、团队、客户项目、付费服务、SaaS 和其他商业用途
- 如需商业使用，请单独获得授权
