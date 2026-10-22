# Privacy Practices 填写底稿（2026-10-22）

**这是待审核的填写底稿，不是已做出的合规认证。** 发布者需按届时 Developer Dashboard 的实际字段定义核对；界面名称可能变化。不得因为没有自建服务器而全部填“No”。本文件依据当前候选实现，若静态存储或数据源方案变化，必须更新。

## 单一用途（可粘贴）

Help users compare Netflix movies and series by displaying clearly labelled third-party ratings, dimming titles below a user-selected threshold, and browsing previously matched results in a local score library.

## 权限理由（可粘贴）

- **storage**: Store rating preferences, locally cached title matches and scores, explicit manual bindings, and an optional user-supplied OMDb key. Access is restricted to trusted extension contexts. This is not application-level encryption; the current at-rest security gate must be resolved before security certification.
- **activeTab**: When the user opens the popup, inspect the active tab to explain whether Netflix, another site, or a browser-restricted page is active and to address the active Netflix content script. No global browser history permission is requested.
- **https://www.netflix.com/**: Read encountered title names/IDs and narrowly requested public year/type metadata; for identified episodes, follow only explicit parent-show relationships. Add reversible score overlays and read-only details. For weak matches with year/type evidence, request the same ID's public English title page with credentials omitted. No account enumeration, authentication-cookie access or catalog crawling.
- **https://v3-cinemeta.strem.io/** and **https://cinemeta-live.strem.io/**: Search title metadata and obtain mirrored IMDb ratings; the second host is the provider's redirect target. The data-source authorization gate remains open.
- **https://v3.sg.media-imdb.com/**: Search localized title candidates and IMDb identifiers. This is an undocumented endpoint, not a claimed licensed API; distribution permission remains unresolved.
- **https://api.tvmaze.com/**: Resolve a series' independently labelled TVmaze rating by IMDb ID; retain attribution and links.
- **https://www.omdbapi.com/**: Send an optional user-provided key and IMDb ID for supplementary ratings, or explicitly requested provider-health verification. No shared key is included.
- **Remote code**: No. All executable JS is included in the extension. Remote JSON/HTML is parsed only as data. No remote JS/module, `eval` of provider content, or remote interpreter is used.

## 数据类型核对

官方要求申报由产品收集/处理的个人或敏感数据，包括临时、客户端、本地存储和第三方直接接收的处理；下面的“需申报”不表示开发者在服务器收到这些数据。

| 后台类型 | 候选实现 / 建议 |
|---|---|
| Website content | **需申报**：遇到的片名、作品 ID、年份/类型、为匹配读取的公开标题页内容。不是读取任意网站全部正文。 |
| Web history | **保守申报并核对定义**：Netflix 作品 ID、标题、来源链接与时间戳能反映用户遇到的内容；打开 Popup 时也处理当前标签页 URL。未请求 Chrome history 权限，不等于没有浏览相关数据。 |
| Authentication information | **需申报可选 Key**：用户自行提供的 OMDb API Key。不得将说明写成读取 Netflix 密码或 Cookie；实际没有读取。 |
| User activity | **需按后台定义核对**：卡片可见性、悬停、点击和筛选操作用于实现展示与用户请求；无点击流/鼠标轨迹/按键日志、无分析遥测。不能把“无分析 SDK”简单等同于不处理交互。 |
| Personally identifiable information | 不主动读取姓名、邮箱或 Netflix 账号资料。第三方收到正常网络连接元数据，需在隐私说明中如实披露，不据此虚构项目收集身份信息。 |
| Location | 无定位权限或 IP 地理定位功能；第三方请求可见来源 IP，已披露。 |
| Financial/payment, health, personal communications | 当前功能不读取或处理。 |

当前页面可确认的事实不等于已经替发布者勾选对应声明。正式提交前按实际实现和官方定义确认各项，避免夸大也避免遗漏。

## 数据流 / 保留 / 删除

- Netflix 卡片 → 扩展本机：已遇到的作品身份与公共元数据；识别后的剧集父身份。
- 扩展 → Cinemeta/IMDb：搜索片名、类型，或 IMDb ID。扩展 → TVmaze：IMDb ID。
- 扩展 → Netflix 公开标题页：仅弱匹配、按作品 ID 请求，英语请求头，省略凭据，不保存 HTML。
- 扩展 → OMDb：用户可选 Key 和 IMDb ID；仅启用补充分数或显式健康测试时。
- 本机：设置、可选 Key、手动绑定、最多 600 评分查询版本、最多 600 英文标题缓存、评分库筛选偏好和固定词汇诊断。
- 缓存 TTL 是再次查询时的复用期限，**不是定时删除承诺**。清缓存、淘汰、模式/Key 变更和卸载有不同效果，见公开隐私政策。
- Key 和缓存当前没有应用层静态加密。`TRUSTED_CONTEXTS`、HTTPS、操作系统磁盘保护不能被写成扩展已实现的加密方案。

## 认证与隐私政策

仅在真实实现满足要求后，由发布者确认 Limited Use / 不出售 / 非无关用途 / 非信贷用途等声明。**目前安全门槛未关闭，不能现在认证全部要求已满足。** 隐私政策 URL 已具备，提交时需保持实际可匿名访问并与最终包一致。

官方参考：
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- https://developer.chrome.com/docs/webstore/program-policies/user-data
