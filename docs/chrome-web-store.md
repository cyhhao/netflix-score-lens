# Chrome Web Store 上架准备

核对日期：2026-10-19。**本项目尚未提交审核、未上架。** `chrome-web-store.zip` 只是满足目录结构的上传候选包；以下未完成事项是发布门槛，不是勾选后可忽略的风险。

## 1. 开发者账户（需要账户所有者操作）

1. 用计划长期维护项目的 Google 账户进入 [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole/)。
2. 注册开发者，阅读并接受开发者协议，支付一次性注册费；**金额、可用付款方式及地区资格以后台当时显示为准**。本项目不代付、不替人声明居住地区。
3. 设置发布者名称、验证联系邮箱，并按 Google 要求启用两步验证及完成身份/商家身份信息。不要把 Google 密码、2FA 或付款信息放进仓库。
4. 当前公开版插件可免费分发；如果后续增加收费/订阅，需重新检查地址、分发和披露要求。

官方：[注册](https://developer.chrome.com/docs/webstore/register) · [账户设置](https://developer.chrome.com/docs/webstore/set-up-account) · [2-Step Verification](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification)

## 2. 已准备的工程材料

- [x] MV3；原始可审查 JS/CSS，无远程下载执行代码。
- [x] 独立商店 ZIP：`npm run package` → `dist/*-chrome-web-store.zip`，**manifest.json 位于 ZIP 根部**；用户安装包另外生成。
- [x] 运行时白名单，排除测试、依赖、浏览器资料、私人验收报告和 Key。
- [x] 图标 16/32/48/128，项目原创镜片图形，无 Netflix 标志。
- [x] 公开隐私政策源文件 `docs/privacy.html`；目标 URL：`https://cyhhao.github.io/netflix-score-lens/privacy.html`，提交前确认实际可匿名打开。
- [x] 权限用途、单一用途、描述、测试说明草案，见下方。
- [x] MIT 源码许可证与独立第三方声明。MIT **不授予第三方评分数据权利**。
- [ ] 正式商店素材终审：`npm run store:assets` 可生成 1280×800 评分库实际 UI 截图草案及 440×280 小宣传图；截图使用明显标注的演示数据，不冒充真实用户或实时评分。正式提交前应审查准确性，并补充不暴露账号的真实 Netflix 功能截图。

官方：[准备与 ZIP](https://developer.chrome.com/docs/webstore/prepare) · [图片规格](https://developer.chrome.com/docs/webstore/images)

图片当前要求：128×128 扩展图标；至少一张 1280×800 或 640×400 截图；440×280 小宣传图。1400×560 marquee 图为可选。不要使用个人观看记录、版权电影海报或未经授权的官方 Logo 作为宣传素材。

## 3. 正式提交前的发布门槛

### A. 凭据和标题缓存的静态存储安全（未完成）

目前 `chrome.storage.local` 保存可选 OMDb Key、匹配缓存、手动绑定等，`TRUSTED_CONTEXTS` 只限制调用上下文，**不等于静态加密**。Chrome 的 User Data FAQ 当前明确要求用户数据安全传输并采用强加密静态存储。

发布前应制定并实施可验证的密钥管理/留存方案，而不是仅把加密密钥与密文一起放在同一个可读配置文件就声称安全。可评估不持久化 API Key、会话级存储、减少保留的浏览相关数据，或有明确威胁模型的静态加密；任何体验变化需同步迁移、文档和测试。**当前包不能据此直接认证全部安全要求已满足。**

官方：[User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)（尤其第 8、9、14 问）

### B. 数据源使用权与稳定性（未解决）

- IMDb suggestion 为未文档化网页检索端点；不是官方授权给此项目的 API。
- Cinemeta 的 IMDb 评分是镜像，公开可调用不等于有权大规模分发、商用或转许可。
- OMDb 的用户自带 Key 不替代对其服务/数据条款的核对。
- TVmaze 的数据按其 CC BY-SA 条件使用，保留来源、链接和适用的衍生数据许可。

要先确认当前用途允许的访问与分发范围；若不能确认，商店版应改为有明确授权的提供方/可选适配器，并重新验证中文匹配与无 Key 体验。不能通过换名字、隐藏端点或“只用于教育”的声明绕过条款。

### C. 数据披露/许可与品牌（需要最终确认）

自动匹配会把用户遇到的 Netflix 片名或 IMDb ID 发给对应服务，服务还能看到来源 IP；可选 Key 会发给 OMDb。不能把商店隐私栏全部填成“无数据收集”，也不能以“没有项目服务器”为理由省略第三方传输。

发布前逐项核对 website content、user activity/browsing-related data、authentication information（可选 Key）的当前后台定义，确保与实际代码和隐私政策一致。若处理超出用户对功能的合理预期，需要满足显著披露及明确同意要求。Limited Use/security 认证由发布者核对真实实现后完成，不能由文案代替合规。

项目名称应突出独立工具，建议商店标题使用 **Score Lens for Netflix**，保留“不隶属 Netflix/评分服务”的声明；当前源码/仓库名称不是商标授权。品牌/素材最终由发布者确认。

官方：[隐私字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) · [政策](https://developer.chrome.com/docs/webstore/program-policies)

### D. 生产环境与审核可复现性（待完成）

对最终候选包重新执行：Netflix 首页/电影/剧集/搜索、懒加载、悬停、阈值、开关、跨语言歧义、手动绑定、无 Key/有 Key/失效 Key、评分库及升级迁移。自动化 fixture 与真实 API 测试不能代替最终日常 Chrome 验收。

Netflix 主页面功能需要登录。若审核方要求测试凭据，需由发布者提供合法、可供审核使用的测试环境，**仅放私有 Test instructions 字段**；不要发布个人 Netflix/Google 凭据，也不要承诺不需要登录。

## 4. 可粘贴的单一用途与权限说明（待最终复核）

**Single purpose**

> Help users compare Netflix movies and series by displaying clearly labelled third-party ratings, dimming titles below a user-selected threshold, and browsing previously matched results in a local score library.

**storage** — Store rating preferences, cached matches/scores, explicit manual bindings and the user's optional OMDb credential. Storage is restricted to trusted extension contexts; see the open at-rest security item above.

**activeTab** — On the user's explicit popup action, identify the current tab to explain whether Netflix is available, another site is active, or the page is browser-restricted. No global browsing-history permission is requested. Re-evaluate whether this can be removed while preserving diagnostics before store submission.

**www.netflix.com** — Read displayed title names/IDs and requested public year/type metadata; place rating badges and reversible dimming only on Netflix cards.

**v3-cinemeta.strem.io / cinemeta-live.strem.io** — Search metadata and resolve mirrored IMDb scores, including the service's documented-in-code redirect target.

**v3.sg.media-imdb.com** — Resolve localized title candidates and IMDb IDs. This remains subject to the unresolved provider authorization item.

**api.tvmaze.com** — Resolve a series' independent TVmaze rating using its IMDb ID.

**www.omdbapi.com** — Optional user-key-based supplementary ratings and explicit source-health verification.

**Remote code** — No. Network responses are parsed as data; all executable logic is included in the package. No downloaded script, remote module, `eval` or interpreter is used for provider responses.

## 5. Store listing 草案

**名称建议**：Score Lens for Netflix

**简短描述**：Netflix 评分角标、可调低分遮罩与本机评分库。支持免费评分来源及可选 OMDb，跨语言结果可手动纠错。

**完整描述**：

在 Netflix 浏览电影和剧集时，让评分直接出现在卡片上。按自己的评分口径与阈值弱化低分内容，悬停即可恢复亮度。

- 来源独立标注，保留 IMDb/TVmaze 的 10 分制以及烂番茄/Metacritic 的原始尺度。
- 提供不强制填 Key 的模式，可选用户自己的 OMDb Key 补充来源；部分作品或来源可能缺分。
- 同名、翻拍、跨语言歧义不会被强制当成可靠匹配，可在弹窗手动核对绑定。
- 独立评分库可查看本机已缓存作品，支持搜索、类别/状态筛选、排序、分组及来源资料。
- 不含广告、分析 SDK 或项目收集服务器；匹配仍会向评分服务发送片名/ID，详见隐私政策。

需要 Netflix 网站登录才能在作品卡片上工作。本机评分库不是 Netflix 全量目录，缓存清理/模式变更会影响记录。该扩展为独立项目，与 Netflix 或评分提供方无关联。具体免费数据源以最终通过发布审查的实现为准。

**支持 URL**：https://github.com/cyhhao/netflix-score-lens/issues

**主页**：https://cyhhao.github.io/netflix-score-lens/

**隐私政策**：https://cyhhao.github.io/netflix-score-lens/privacy.html

## 6. 审核测试说明草案

1. 登录合法的 Netflix 测试账户，打开带作品卡片的浏览/搜索页。
2. 无需 OMDb Key，等待视口附近卡片的免费评分；遇到无评分或歧义是预期状态，不应变暗。
3. 打开扩展弹窗，改变阈值/开关，验证卡片即时响应；点击角标查看来源；悬停低分卡片恢复亮度。
4. 对歧义作品在「作品」中搜索 IMDb 标题/编号，明确绑定，再恢复自动匹配。
5. 点击「评分库」，关闭 Netflix 标签页，验证已缓存列表仍可搜索/筛选/排序/分组。
6. OMDb 为可选。核心免费功能不需要审核者购买 Key；若要测试补充来源，使用经授权的测试 Key，仅在私有审核字段传递。不得上传真实个人 Key。
7. 浏览器 fixture 测试只能用于工程回归，不能作为提供 Netflix 登录的替代品。

## 7. 实际发布流程

只有上面门槛完成后：开发者后台 **Add new item → 上传 ZIP → Store listing / Privacy / Distribution / Test instructions → Submit for Review**。建议首次选择审核后暂不自动发布（deferred publishing），审核通过后再人工检查。官方说明通过后 staged 状态最多保留 30 天，超过需重新送审。

审核通常数天，也可能数周，不能保证通过或承诺某个具体上线日期。GitHub 开源、GitHub Release、商店上传草稿、提交审核与正式发布是不同状态，发布记录必须分别报告。

官方：[首次发布流程](https://developer.chrome.com/docs/webstore/publish) · [审核流程](https://developer.chrome.com/docs/webstore/review-process)
