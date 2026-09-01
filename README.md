# 全平台招聘数据抓取扩展 (Job Scraper Extension)

这是一个基于 Chrome Extension 架构的招聘职位数据抓取工具，专门用于在主流招聘平台的前端页面上自动化提取职位列表和深层详情数据。它采用了**网络请求拦截 (Network Interception)** 与 **隐形 Iframe 深层 DOM 渲染**相结合的双层架构，既能确保抓取的高效性，也能绕过绝大部分基础的防爬虫机制。

## 🌟 支持的平台

目前已全面支持国内四大主流招聘平台：
1. **Boss 直聘** (www.zhipin.com)
2. **前程无忧 51job** (jobs.51job.com / we.51job.com)
3. **猎聘网** (c.liepin.com / www.liepin.com) - *支持瀑布流及传统翻页*
4. **智联招聘** (sou.zhaopin.com)

## 🚀 核心特性

- **双引擎并行抓取**
  - **JSON 拦截层 (Main World)**：通过拦截网页的 `XMLHttpRequest` 和 `fetch`，在第一时间无损捕获网站原生的原始职位列表数据。
  - **DOM 提取层 (Isolated World)**：通过在当前页面动态创建隐形的 `iframe` 加载职位详情页，弥补 JSON 列表中缺失的深度信息（如详细职位描述、精确地址、福利标签等）。
- **智能分页与瀑布流兼容**
  - 支持传统点击“下一页”的翻页模式。
  - 完美适配猎聘等网站的“瀑布流”（无限下拉）加载模式，通过内置的全局任务队列和持续自动滚动探测机制，实现无缝衔接。
- **完善的防封控 (Anti-Bot) 机制**
  - **拟人化休眠**：在抓取详情间隙加入随机时间的延迟，以及周期性的长休眠，模拟人类真实浏览节奏。
  - **安全拦截熔断**：实时监控页面的重定向。如果遇到平台弹出的验证码（Captcha）或安全中心拦截，扩展会自动熔断停止，防止账号被封禁，并提醒用户手动接管。
  - **内存回收优化**：针对长时间运行导致的内存泄漏问题，扩展会在销毁 iframe 前强行切断源引用（`about:blank`），显著降低浏览器崩溃率。
- **统一的数据管理后台 (Apple macOS 风格)**
  - 采用现代化的玻璃态 (Glassmorphism) 与 macOS 设计语言，提供精致的视觉体验和微交互。
  - **多源数据列表**：支持分平台独立查看，或进入“全网合并去重”版块统一处理。支持关键字搜索、薪资/经验过滤。
  - **投递看板 (Kanban)**：内置拖拽式看板（待投递、已投递、一面、二面、Offer 等状态），方便管理整个求职生命周期。
  - **数据大盘 (Dashboard)**：自动生成基于全网抓取数据的统计图表（薪资分布、地区分布、学历要求等）以及高频技能词云 (Word Cloud)。
  - **面试日程管理**：可针对单条职位添加面试安排，记录面试笔记、复盘，并支持一键导出为 `.ics` 日历文件。
- **AI 智能辅助引擎**
  - **AI 简历匹配诊断**：配置 OpenAI 兼容接口（如 DeepSeek 等）及个人简历后，一键对目标岗位进行深度的匹配度打分与优劣势分析。
  - **智能招呼语生成**：根据岗位 JD 和你的简历，AI 自动撰写高转化率的个性化打招呼/自荐文案。

## 🧩 各平台抓取与数据提取机制

各招聘平台的前端架构差异巨大：有的平台数据完全通过 Ajax/Fetch 请求异步渲染，可直接截获原始 JSON；有的采用服务端直出 (SSR) 将结构化数据挂载在内嵌 `<script>` 状态中；还有的只能通过解析 DOM 节点文本获取。

本扩展采用**“职位列表页主抓保广度，职位详情页与企业主页按需精准补充保深度”**的混合架构。以下为各平台在 3 类页面上的实际数据获取方式对比：

### 📊 全平台数据获取方式对照表

| 招聘平台 | 1. 职位列表页 (主抓广度) | 2. 职位详情页 (独立点开补充) | 3. 公司主页 (企业全景) |
| :--- | :--- | :--- | :--- |
| **Boss 直聘** | ⚡ **纯网络 JSON 拦截**<br>`wapi/zpgeek/search/joblist.json` | 🔍 **纯 DOM 提取** (单页直开时)<br>*(注：自动化列表批跑时拦截侧边详情 API)* | 🔍 **依赖详情页 DOM 工商卡片**<br>*(未设独立公司主页脚本)* |
| **前程无忧 51job** | ⚡ **纯网络 JSON 拦截**<br>`api/job/search-pc` | 🔀 **双轨混合 (优先 JSON，DOM 兜底)**<br>异步拦截 `job-pcdetail` 与 `company-info` | ⚡ **详情页异步 JSON 顺带提取**<br>拦截 `company-info/pc-info` |
| **猎聘网 (Liepin)** | ⚡ **纯网络 JSON 拦截**<br>`com.liepin.searchfront4c.pc-search-job` | 🔀 **双轨混合 (内嵌 JSON-LD + DOM 补充)**<br>解析 Schema.org JSON 与工商 DOM | 🔀 **内嵌 $CONFIG + DOM 补充**<br>`liepin_company_isolated.js` |
| **智联招聘 (Zhilian)** | ⚡ **内嵌 State + 网络 JSON 拦截**<br>首屏 `__INITIAL_STATE__` + 翻页 API | ⚡ **纯结构化 State JSON 提取**<br>直取 `__INITIAL_STATE__.companyExtDetail` | ⚡ **在职位详情页中直接随附提取**<br>无需单独访问公司主页 |

---

### 🔬 各平台具体实现与技术细节

#### 1. Boss 直聘 (`www.zhipin.com`)
- **职位列表页**：**【纯网络 JSON 拦截】**
  - **实现脚本**：`content_scripts/boss_interceptor.js`
  - **机制**：在 `MAIN` 世界劫持 `window.fetch` 与 `XMLHttpRequest`，监听匹配 `wapi/zpgeek/search/joblist.json`，直接截取平台原生的 `zpData.jobList` 纯净 JSON 数据包，无损捕获职位基础信息、薪资范围、城市、经验、学历及企业简况。
- **职位详情页**：**【DOM 提取（单页打开）+ JSON 拦截（列表批量跑）】**
  - **实现脚本**：`content_scripts/boss_isolated.js` 中的 `scrapeSinglePage()`
  - **机制**：
    - **单页独立打开（用户主场景）**：Boss 详情页采用服务端直出渲染（SSR），新开标签页通常不触发详情 Ajax。扩展通过 `document.querySelector` 提取 `.job-sec-text`（完整岗位职责）以及 `.business-info-box` 下的工商元素（企业全称、法定代表人、成立日期、企业类型、经营状态、注册资金、办公地址等）。
    - **列表批量执行（自动化模式）**：通过模拟点击列表项拦截异步请求 `wapi/zpgeek/job/detail.json` 获取 `zpData.jobInfo`。

#### 2. 前程无忧 51job (`we.51job.com` / `jobs.51job.com`)
- **职位列表页**：**【纯网络 JSON 拦截】**
  - **实现脚本**：`content_scripts/51job_interceptor.js`
  - **机制**：拦截搜索页接口 `api/job/search-pc`，截获 `resultbody.job.items` 规范的职位对象数组。
- **职位详情页**：**【双轨混合：优先 JSON 拦截，DOM 兜底】**
  - **实现脚本**：`content_scripts/51job_interceptor.js` 与 `content_scripts/51job_isolated.js`
  - **机制**：
    - **优先 JSON 拦截**：页面打开时，51job 会异步请求 `api/pc/open/noauth/jobs/job-pcdetail/`（职位详情 `detailJobInfo`）与 `api/pc/open/noauth/company-info/pc-info`（包含营业执照 `license`、法定代表人、注册资本等）。拦截器截获后直接组装结构化数据；
    - **DOM 容灾降级**：若网络卡顿未截获到接口，则退化调用 `document.querySelector('.job_msg')` 等解析 DOM，确保抓取成功率达 100%。

#### 3. 猎聘网 (`www.liepin.com` / `c.liepin.com`)
- **职位列表页**：**【纯网络 JSON 拦截】**
  - **实现脚本**：`content_scripts/liepin_search_interceptor.js` 与 `content_scripts/liepin_home_interceptor.js`
  - **机制**：搜索页拦截 `com.liepin.searchfront4c.pc-search-job` 获取 `jobCardList`；首页瀑布流拦截 `api-batch/parallel` 与 `home-recommend-job-new`。
- **职位详情页**：**【内嵌 JSON-LD + DOM 混合提取】**
  - **实现脚本**：`content_scripts/liepin_search_isolated.js`
  - **机制**：
    - **内嵌结构化 JSON**：直接从 HTML 中的 `<script type="application/ld+json">` 提取搜索引擎专用的 Schema.org 数据（规范的标题、薪资、发布时间、公司链接）以及从 `<script>window.$CONFIG</script>` 提取 `compId`；
    - **DOM 补充**：结合 `.job-intro-container`（岗位描述）和 `.business-license-container`（提取法人、注册资金、成立日期等）。
- **公司主页**：**【内嵌 $CONFIG + DOM 补充】**
  - **实现脚本**：`content_scripts/liepin_company_isolated.js`
  - **机制**：从页面内嵌 `$CONFIG` 提取企业编号与全称，从页面 DOM 提取企业全景信息。

#### 4. 智联招聘 (`sou.zhaopin.com` / `zhaopin.com`)
- **职位列表页**：**【内嵌 State JSON + 网络 JSON 拦截】**
  - **实现脚本**：`content_scripts/zhilian_new_isolated.js` 与 `content_scripts/zhilian_interceptor.js`
  - **机制**：首屏直接从 HTML 内嵌的 `<script>window.__INITIAL_STATE__=...</script>` 中反序列化出首屏全部列表（`positionList`），翻页时拦截 `search/positions` 或 `search/joblist` 接口。
- **职位详情页**：**【纯结构化 State JSON 提取（极少依赖 DOM）】**
  - **实现脚本**：`content_scripts/zhilian_new_isolated.js`
  - **机制**：智联详情页在首屏 HTML 的 `__INITIAL_STATE__` 中直接打包包含了：
    - `state.jobDetail`（岗位职责、任职要求、薪资福利）
    - `state.companyExtDetail`（企业的统一社会信用代码、营业执照注册信息、经营范围）
    - `state.jobDeliverList`（同企业推荐在招职位）
    因此智联的数据最为纯净完备，完全不受页面 DOM 结构变动或防抓混淆的影响。


## 📂 项目结构

```text
job-scraper/
├── manifest.json              # 扩展程序核心配置文件 (Manifest V3)
├── background.js              # 后台服务守护进程，负责消息中转与图标状态管理
├── popup/                     # 点击扩展图标时弹出的控制面板
├── options/                   # 统一的数据管理与可视化后台页面 (Apple macOS 风格)
│   ├── options.html           # 看板、列表、大盘、大模型配置、简历管理 UI
│   ├── options.js             # 页面路由、图表渲染、AI 调用及数据处理逻辑
│   └── options.css            # 现代化的样式系统
├── content_scripts/           # 注入到各个招聘平台的脚本资源库 (双层架构)
├── libs/                      # 第三方依赖库 (ECharts, WordCloud, Lucide Icons, SortableJS 等)
├── icons/                     # 扩展图标资源
└── utils/                     # 辅助工具脚本
```

## 🛠️ 安装说明

1. 下载或 `git clone` 本仓库代码到本地文件夹。
2. 打开 Chrome 浏览器，在地址栏输入 `chrome://extensions/` 进入扩展程序页面。
3. 在页面右上角开启 **“开发者模式” (Developer mode)**。
4. 点击左上角的 **“加载已解压的扩展程序” (Load unpacked)** 按钮。
5. 选择本项目的根目录 `job-scraper` 文件夹。
6. 扩展安装成功！建议将扩展图标固定在浏览器工具栏，方便随时调用。

## 📖 使用指南

1. **进入目标网站**
   在浏览器中打开你需要抓取的平台搜索页（例如 `www.liepin.com/zhaopin` 或 `c.liepin.com`），并输入关键词完成一次正常的职位搜索。
2. **启动抓取**
   点击浏览器工具栏的 **Job Scraper** 扩展图标。在弹出的控制面板中，点击对应的【开始抓取】按钮。
   > **注意**：部分瀑布流页面在刚打开时可能处于数据空置状态，扩展会自动向下滚动尝试激活网络请求。
3. **监控进度**
   扩展程序会自动接管当前标签页。你可以看到职位卡片被依次标红（或标绿）高亮，并在右下角弹出一个带边框的小窗口（那是用于抓取深层详情的 iframe）。请**不要关闭当前标签页**。
4. **查看与导出数据**
   抓取完毕或手动停止后，在控制面板中点击【前往数据后台】按钮，即可进入统一的数据管理页面进行浏览和导出。

## ⚠️ 免责声明

本扩展程序仅供个人学习、技术研究与非商业数据分析使用。请严格遵守相关平台的《用户服务协议》与 `robots.txt` 规范，控制抓取频率，不得用于任何非法或损害平台利益的商业用途。因使用本工具造成的任何账号封禁或法律纠纷，开发者概不负责。
