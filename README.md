# 全平台招聘数据抓取与求职管理套件 (Job Scraper & Career Suite)

<p align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="Job Scraper Logo" />
</p>

<p align="center">
  <strong>一款基于 Chrome Extension Manifest V3 架构的新一代全平台招聘职位数据采集、清洗、去重与求职全生命周期管理中台</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-brightgreen.svg" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/Platform-Boss%20|%2051job%20|%20Liepin%20|%20Zhilian-blue.svg" alt="Platforms" />
  <img src="https://img.shields.io/badge/AI%20Engine-SSE%20Stream-orange.svg" alt="AI Engine" />
  <img src="https://img.shields.io/badge/Storage-IndexedDB%20%2B%20LevelDB-blueviolet.svg" alt="Storage" />
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License" />
</p>

---

## 📖 目录

- [🌟 核心定位与设计理念](#-核心定位与设计理念)
- [🧩 支持的招聘平台矩阵](#-支持的招聘平台矩阵)
- [🏗️ 技术架构与数据流](#️-技术架构与数据流)
- [🛡️ 反反爬风控与隐身技术](#️-反反爬风控与隐身技术)
- [🚀 核心功能全景](#-核心功能全景)
  - [1. 多源数据采集与深层穿透](#1-多源数据采集与深层穿透)
  - [2. 沟通记录反向拉黑 (求职防坑神器)](#2-沟通记录反向拉黑-求职防坑神器)
  - [3. 全网数据标准化与去重合并](#3-全网数据标准化与去重合并)
  - [4. AI 流式诊断与个性化打招呼 (SSE)](#4-ai-流式诊断与个性化打招呼-sse)
  - [5. 投递全流程看板 (Kanban)](#5-投递全流程看板-kanban)
  - [6. 面试日程管理与 .ics 日历导出](#6-面试日程管理与-ics-日历导出)
  - [7. 数据统计大盘与技能词云](#7-数据统计大盘与技能词云)
  - [8. 面试题库与 AI 结合简历定制回答](#8-面试题库与-ai-结合简历定制回答)
- [📂 规范化项目结构](#-规范化项目结构)
- [🛠️ 安装与部署指南](#️-安装与部署指南)
- [⚙️ AI 大模型配置指南](#️-ai-大模型配置指南)
- [❓ 常见问题排查 (FAQ)](#-常见问题排查-faq)
- [⚠️ 免责声明](#️-免责声明)

---

## 🌟 核心定位与设计理念

传统求职过程中，求职者面临以下痛点：
1. **平台割裂**：Boss直聘、51job、猎聘、智联招聘各平台数据分散，重复查看、反复筛选耗费大量精力；
2. **信息浅层化**：列表页只展示笼统薪资和简要要求，公司真实工商全称、成立年份、参保人数、详细工作地址等隐藏在深层详情中；
3. **风控拦截严苛**：自动化抓取极易触发滑块验证、账号封禁或反调试死循环；
4. **投递追踪缺失**：投递后进度杂乱，面试邀请散落在不同软件中，难以形成结构化求职管道；
5. **AI 赋能脱节**：市面上的 AI 简历工具通常无法直接关联具体的岗位 JD 详情。

**Job Scraper** 采用 **“网络拦截截流 + 隐形沙箱渲染 + 本地化 IndexedDB 加速 + 纯前端 AI 流式代理”** 的一体化架构，打通从**数据获取、企业穿透、简历诊断、个性化触达到面试复盘**的完整闭环。

---

## 🧩 支持的招聘平台矩阵

| 招聘平台 | 列表页主抓方式 | 详情页深层穿透方式 | 工商与企业背景提取 | 特色适配能力 |
| :--- | :--- | :--- | :--- | :--- |
| **Boss 直聘** (`zhipin.com`) | ⚡ **纯网络 JSON 拦截**<br>`joblist.json` 原生数据包 | 🔀 **DOM 提取 + 详情异步接口**<br>职责、要求、地址、HR状态 | 🏢 支持在招岗位数、在线BOSS、工商营业全称穿透 | 🛡️ 零点击防风控列表模式<br>💬 **聊天会话反向识别拉黑** |
| **前程无忧 51job** (`51job.com`) | ⚡ **纯网络 JSON 拦截**<br>`api/job/search-pc` | 🔀 **双轨混合 (优先 JSON，DOM 兜底)**<br>拦截 `job-pcdetail` | 🏢 拦截 `company-info/pc-info` 提取法人、执照与规模 | 🛡️ **代理拦截破解无限 debugger**<br>🛡️ 详情页自动降级容灾 |
| **猎聘网** (`liepin.com`) | ⚡ **纯网络 JSON 拦截**<br>`pc-search-job` / 推荐批次流 | 🔀 **内嵌 JSON-LD + DOM 补充**<br>Schema.org 结构化数据解析 | 🏢 解析 `$CONFIG` 与工商卡片数据 | 🌊 **完美适配首页无限瀑布流**<br>🏷️ 猎头/代招智能标签分离 |
| **智联招聘** (`zhaopin.com`) | ⚡ **内嵌 State + 翻页拦截**<br>`__INITIAL_STATE__` 首屏反序列化 | ⚡ **纯结构化 State 提取**<br>解析 `state.jobDetail` 纯净包 | 🏢 直接解析 `companyExtDetail` 统一社会信用代码与经营范围 | 💎 **纯净数据零 DOM 污染**<br>影子库多维度城市信息丰富 |

---

## 🏗️ 技术架构与数据流

扩展遵循严格的 **Chrome MV3 安全沙箱规范**，解耦为三大核心运行世界：

```mermaid
flowchart TD
    subgraph S1["宿主网页上下文 (MAIN World)"]
        A1["原生页面发起 XHR / Fetch"] --> A2["Interceptor 网络劫持层"]
        A2 --> A3["URL 特征参数瞬时净化 (抹除 auto_close/delay)"]
        A2 --> A4["Function.prototype 原生指纹伪装"]
        A2 --> A5["51job 反反调试 (Proxy 阻断 debugger)"]
        A2 --> A6["捕获原生纯净 JSON 数据包"]
    end

    subgraph S2["扩展隔离沙箱 (ISOLATED World)"]
        B1["CustomEvent Bridge 通信"] <-- A6
        B2["任务调度队列 (自动分页/滚动探测)"] --> B1
        B3["隐形 Iframe / 独立 Tab 详情加载"]
        B4["DOM 结构兜底解析 (岗位职责/地址/工商)"]
        B5["风控状态码与验证码熔断监控"]
    end

    subgraph S3["后台守护进程 (background.js)"]
        C1["跨标签页调度中枢"] <-- B5
        C2["AI SSE 统一网关 (OpenAI / Claude / Gemini)"]
    end

    subgraph S4["统一管理中台 (Options Dashboard)"]
        D1["本地 IndexedDB 索引加速库 (JobScraperDB)"] <-- C1
        D2["全网合并去重与多维筛选引擎"]
        D3["投递全生命周期看板 (Kanban)"]
        D4["数据可视化大盘 & 技能词云 (Chart.js / WordCloud2)"]
        D5["AI 流式打字机诊断与招呼语生成"]
        D6["日历日程导出 (.ics) & 报表导出 (Excel/CSV)"]
    end
```

---

## 🛡️ 反反爬风控与隐身技术

为保证采集的高稳定性与账号安全性，项目在底层融入了全方位的防御对抗机制：

1. **URL 特征参数瞬时抹除 (`document_start`)**
   - 自动化流程传入的 `auto_close=1` 或 `close_delay` 等调试参数，会在页面 HTML 加载第一时刻被 `history.replaceState` 剥离，防止前端埋点（如 Sensors Analytics / ka.js）将自动化特征上报给风控服务端。
2. **函数指纹伪装 (`Function.prototype.toString`)**
   - 招聘平台常用 `Function.prototype.toString.call(fetch)` 检测函数是否被 Hook。项目通过 `WeakMap` 与原生 `toString` 映射，确保所有劫持函数输出均为 `function () { [native code] }`。
3. **反调试死循环破解**
   - 51job 等平台通过 `Function("debugger")` 构造无限中断冻结开发者工具。拦截层对 `window.Function` 实施代理，正则过滤阻断含有 `debugger` 的代码段，保证调试无阻。
4. **隐蔽单向跨世界通信**
   - 放弃容易被网页自身监听的 `window.postMessage`，改用内部随机命名的 `CustomEvent('__zp_ext_bridge__')`，实现从 MAIN 到 ISOLATED 环境的安全投递。
5. **拟人化行为节奏与安全熔断**
   - **动态随机抖动**：单条详情请求随机停顿（2.5s ~ 5s）；
   - **阶梯休眠**：每抓取 8~14 条执行小批量短休眠；每连续点击 50~65 条自动进入长冷却期；
   - **风控主动熔断**：实时检测状态码（Boss `code: 37`、`403`、`429`）与页面滑块/验证码容器。一旦触发立即断开抓取并弹窗告警，严防封号。
6. **Iframe 内存安全回收**
   - 针对批量抓取导致的 DOM 内存泄漏，销毁前强行切断源引用（重定向至 `about:blank` 后清除节点），长时间运行内存稳定。

---

## 🚀 核心功能全景

### 1. 多源数据采集与深层穿透
- **单页/批量自动化**：支持在列表页点击一键批跑，也支持在详情页单条抓取；
- **零点击纯列表模式**（Boss直聘独家）：仅保存列表原生接口返回的薪资、要求、福利与 HR 简况，**完全不点击卡片触发详情请求，做到接近 0 风控**；
- **外包与代招智能识别**：自动结合接口商业标签与岗位描述关键词（“外包”、“代招”、“劳务派遣”），并在前端列表提供醒目警示徽标。

### 2. 沟通记录反向拉黑 (求职防坑神器)
在 Boss 直聘沟通列表页（`/web/geek/chat`），一键唤起智能逆向扫描：
- 自动提取全部聊天对话中的 HR 消息；
- 搭载拒信语义过滤算法（自动排除“经验不限”、“学历不限”等反向干扰词）；
- 自动识别“暂不匹配”、“已找到合适人选”等婉拒信息，弹出抽屉界面，**一键将婉拒企业批量加入黑名单**，后续列表抓取时自动标红并支持一键过滤。

### 3. 全网数据标准化与去重合并
- **标准化数据字典**（`libs/job_normalizer.js`）：将四家平台的差异字段统一为标准的：
  `职位名称`、`公司全称`、`薪资待遇`、`工作经验`、`学历要求`、`职位描述`、`技能标签`、`HR姓名/职位/活跃度`、`公司规模/行业/福利`、`详细工作地址` 等；
- **全网智能合并**：跨平台基于“公司全称 + 职位名”或规范化 ID 进行去重聚合，避免重复投递。

### 4. AI 流式诊断与个性化打招呼 (SSE)
- **多模型原生直连**：支持 OpenAI 兼容格式（DeepSeek / Moonshot / 通义千问等）、Anthropic Claude、Google Gemini；
- **打字机流式渲染**：基于 `chrome.runtime.onConnect` 长连接通道，实现逐字渲染；
- **五维量化打分**：对比求职者个人简历与目标 JD，从**核心技能（25分）**、**经验相关（25分）**、**教育背景（20分）**、**成就项目（20分）**、**软实力文化（10分）**给出量化评分，并附带针对性扣分说明与改进建议；
- **高转化率打招呼语生成**：自动提炼简历中与该岗位最契合的优势，生成 100 字内开门见山、直接可发送的打招呼消息。

### 5. 投递全流程看板 (Kanban)
- 仿 Linear / Trello 的流畅拖拽式求职看板；
- 预设求职全生命周期管道：
  `待投递 (To-Apply)` ➔ `已投递 (Applied)` ➔ `一面 (Interview 1)` ➔ `二面 (Interview 2)` ➔ `录用/Offer (Offer)`；
- 卡片直观展示 AI 匹配分、薪资待遇，点击直接唤起详情弹窗或面试日程。

### 6. 面试日程管理与 .ics 日历导出
- 记录面试轮次（技术面/HR面/终面）、面试形式（视频/现场/电话）、时间与地点；
- 记录面试考题、复盘与备忘；
- **一键导出标准 `.ics` 日历文件**：符合 RFC 5545 规范（修复了换行格式），可直接双击导入 **Apple Calendar (iOS/macOS)、Google Calendar、Outlook** 等，自动设置面试前提醒。

### 7. 数据统计大盘与技能词云
- **薪资分布直方图**（10k以下、10-20k、20-30k、30k以上）；
- **工作经验要求饼图**；
- **高频技能关键词云**：基于 WordCloud2 动态生成当前筛选岗位中最抢手的硬技能与技术栈（如 Java、Spring Boot、Python、Kubernetes 等），指导求职者针对性备战。

### 8. 面试题库与 AI 结合简历定制回答
- 自建结构化高频题库，支持按技术栈、分类标签进行快速筛选；
- 支持自拟问题，点击 **“🤖 AI 结合简历生成参考回答”**，大模型将以第一人称口语化风格，结合你上传的简历经历给出定制化应答话术。

---

## 📂 规范化项目结构

```text
job-scraper/
├── manifest.json              # 扩展程序核心配置文件 (Chrome MV3)
├── background.js              # 后台守护进程 (集成 AI SSE 流式传输与后台标签页生命周期)
├── popup/                     # 工具栏控制面板
│   ├── popup.html             # 快捷抓取与模式设置 UI
│   ├── popup.js               # 页面平台识别与抓取交互控制
│   └── popup.css              # 控制面板样式
├── options/                   # 统一管理后台 (Apple macOS 玻璃态设计)
│   ├── options.html           # 看板、列表、大盘、大模型配置、简历管理模板
│   ├── options.js             # 页面路由、图表渲染、AI 调用及数据处理逻辑
│   ├── options.css            # 现代化玻璃拟态样式表
│   ├── chart.js               # 图表渲染库
│   └── wordcloud2.js          # 高频技能词云引擎
├── content_scripts/           # 各平台注入脚本库 (MAIN 拦截器与 ISOLATED 提取器)
│   ├── boss_interceptor.js    # Boss 接口拦截与指纹伪装 (MAIN)
│   ├── boss_isolated.js       # Boss 页面调度与 DOM 提取 (ISOLATED)
│   ├── boss_company_isolated.js # Boss 企业主页工商信息提取
│   ├── 51job_interceptor.js   # 51job 接口拦截与反调试绕过 (MAIN)
│   ├── 51job_isolated.js      # 51job 任务调度与详情兜底 (ISOLATED)
│   ├── liepin_search_interceptor.js # 猎聘搜索页拦截器
│   ├── liepin_search_isolated.js    # 猎聘搜索页调度器
│   ├── liepin_home_interceptor.js   # 猎聘首页瀑布流拦截器
│   ├── liepin_home_isolated.js      # 猎聘首页瀑布流调度器
│   ├── liepin_company_isolated.js   # 猎聘企业主页提取器
│   ├── zhilian_interceptor.js       # 智联招聘翻页拦截器
│   ├── zhilian_new_isolated.js      # 智联招聘 State 反序列化调度器
│   └── dashboard_isolated.js        # 本地服务协同与后台 Tab 代理
├── libs/                      # 第三方通用库
│   ├── job_normalizer.js      # 全平台数据结构标准化字典映射引擎
│   └── xlsx.full.min.js       # Excel / CSV 序列化引擎
├── utils/                     # 🌟 生产级独立工具层
│   ├── storage.js             # 高性能 IndexedDB 本地数据库 (JobScraperDB)
│   ├── ai_stream.js           # AI SSE 打字机流式客户端 (支持自动降级)
│   └── export_helper.js       # 规范化 Excel/CSV 与 .ics 日历导出工具
├── tests/                     # 🌟 测试与静态资源归档
│   ├── archive/               # 历史版本与废弃脚本归档
│   └── fixtures/              # 各平台测试静态 HTML / 样例数据
├── icons/                     # 扩展图标 (16/32/48/64/128)
├── README.md                  # 项目官方使用文档
└── .gitignore                 # Git 忽略配置
```

---

## 🛠️ 安装与部署指南

### 环境要求
- **Chrome / Edge / Brave** 或任何基于 Chromium 内核的现代浏览器（推荐版本 >= 114）；
- 支持开发者模式安装。

### 安装步骤
1. 克隆或下载本仓库代码到本地文件夹：
   ```bash
   git clone https://github.com/your-username/job-scraper.git
   ```
2. 打开 Chrome 浏览器，在地址栏输入：
   ```text
   chrome://extensions/
   ```
3. 在页面右上角打开 **“开发者模式” (Developer mode)** 开关；
4. 点击左上角的 **“加载已解压的扩展程序” (Load unpacked)** 按钮；
5. 在文件选择框中，选择本项目的根目录 `job-scraper` 文件夹；
6. 扩展安装成功！建议点击浏览器右上角的拼图图标，将 **统一招聘数据提取助手** 固定在工具栏。

---

## ⚙️ AI 大模型配置指南

点击控制面板的【🖥️ 打开数据管理面板】或右键扩展图标选择【选项】，进入后台侧边栏的 **“大模型配置”**：

### 常用服务商配置示例

#### 1. DeepSeek (推荐，性价比与理解能力极佳)
- **API URL**：`https://api.deepseek.com/chat/completions`
- **API Key**：`sk-xxxxxxxxxxxxxxxxxxxxxxxx`
- **Model**：`deepseek-chat`

#### 2. 月之暗面 Moonshot (Kimi)
- **API URL**：`https://api.moonshot.cn/v1/chat/completions`
- **API Key**：`sk-xxxxxxxxxxxxxxxxxxxxxxxx`
- **Model**：`moonshot-v1-8k`

#### 3. 阿里云百炼 (通义千问 Qwen)
- **API URL**：`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
- **API Key**：`sk-xxxxxxxxxxxxxxxxxxxxxxxx`
- **Model**：`qwen-plus` 或 `qwen-max`

#### 4. Google Gemini (官方原生)
- **API URL**：`https://generativelanguage.googleapis.com`
- **API Key**：`AIzaxxxxxxxxxxxxxxxxxxxxxxxx`
- **Model**：`gemini-1.5-flash` 或 `gemini-1.5-pro`

#### 5. Anthropic Claude (官方原生)
- **API URL**：`https://api.anthropic.com/v1/messages`
- **API Key**：`sk-ant-xxxxxxxxxxxxxxxxxxxx`
- **Model**：`claude-3-5-sonnet-20241022`

> **提示**：配置完成后，点击 **“测试连接”**。首次测试或调用时浏览器会弹出跨域请求权限确认框，请点击 **“允许” (Allow)**。随后在 **“简历管理”** 中粘贴你的 Markdown 或纯文本简历即可启用完整 AI 功能。

---

## ❓ 常见问题排查 (FAQ)

### Q1：点击开始抓取提示“无法连接到网页插件，请先刷新网页”？
- **原因**：扩展注入脚本（Content Script）在扩展安装或重新加载后，无法自动作用于已经打开的旧标签页。
- **解决**：在招聘网站页面按下 `F5`（或 `Cmd + R`）刷新当前网页，然后再次点击扩展面板即可正常连接。

### Q2：抓取时弹出滑块验证码或安全中心拦截怎么办？
- **机制**：扩展具备**安全拦截熔断机制**，一旦发现安全滑块会自动立即停止任务，以保护求职账号不被封禁。
- **解决**：请不要慌张，在当前页面上手动拖动滑块完成验证，并在网页上随意正常点击浏览 1~2 分钟，随后再重新启动抓取即可。推荐在选项面板勾选 **“🛡️ 仅抓列表基础数据 (零点击防风控)”** 模式。

### Q3：内嵌 Iframe 模式和后台新标签页模式有什么区别？
- **内嵌 Iframe 模式（默认）**：直接在当前页面右下角静默创建隐藏 frame 加载详情，速度快、对前台操作干扰小；
- **后台新标签页模式**：通过 Chrome 标签页 API 在后台新开 Tab 获取数据并自动关闭。当个别平台对 Iframe 进行严格的 `X-Frame-Options` 限制时，可切换为后台标签页模式。

### Q4：导出的 `.ics` 文件手机无法识别或时间错乱？
- 项目已更新为标准 RFC 5545 格式输出，使用标准 CRLF 换行及 UTC 时间戳。导入时请确保手机或电脑的时区设置正确即可。

---

## ⚠️ 免责声明

1. 本扩展程序仅供个人学习、技术研究与非商业数据分析使用；
2. 请严格遵守各招聘平台的《用户服务协议》与 `robots.txt` 规范，自觉控制抓取频次与时长，严禁用于任何高并发商业爬虫、商业化数据倒卖或侵害平台合法权益的行为；
3. 本项目完全运行在用户的本地浏览器环境中，**不会收集、上传或泄露用户的任何个人简历、账号密码或求职敏感信息**；
4. 因违反平台规定或不当使用本工具造成的任何账号异常、限制访问或法律纠纷，使用者需自行承担责任，开发者概不负责。
