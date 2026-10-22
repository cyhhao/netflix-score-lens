# Chrome 商店上架材料 — 先读这里

核对日期：2026-10-22。**状态：材料准备完成，尚未上传、送审或上架；当前候选包仍有明确的提交门槛。**

## 这份材料对应哪个版本

候选版本 **0.6.3**，基于已合并的作品/单集身份修复，并补充商店需要的中英文本地化 manifest 元数据。它不是之前发给用户的 v0.6.2 解压包，也不是商店已批准的版本。本轮不覆盖现有安装、不修改用户设置/Key/缓存、不创建 Google 商店项目。

## 解压材料包后怎么用

- `upload/netflix-score-lens-0.6.3-chrome-web-store.zip`：**将来满足门槛后**上传的候选 ZIP；manifest 位于根目录。不要上传整个材料 ZIP。
- `listing.en.txt` / `listing.zh-CN.txt`：完整商店介绍。
- `listing-fields.json`：从候选 `_locales` 提取的名称/简短描述，以及主页、支持和隐私 URL。商店标题和摘要来自 manifest，不是后台随意另填一个名字。
- `assets/en/`、`assets/zh-CN/`：每种语言 4 张 1280×800 功能图；`assets/icon-128.png` 是共用图标（96px 图形 + 16px 透明边距），`assets/promo-440x280.png` 是共用的小宣传图。官方当前仅支持截图本地化，不支持按语言单独上传宣传图。
- `privacy-answers.md`：单一用途、权限、远程代码和数据类型填写底稿，含仍待核对的项。
- `reviewer-instructions.md`：审核操作步骤与登录前提。测试凭据由发布者另行通过后台私有字段提供，不包含在这份材料里。
- `readiness.json`：机器可读的待办门槛，`submissionAllowed:false`。
- `verification.json`、`SHA256SUMS.txt`：包/素材/本地化结构检查与文件校验；它们不是合规或实际页面验收证书。
- `reference/`：隐私政策当前副本、上架规则索引和第三方声明。以最终公开政策和实际代码为准。

## 已完成的准备

- 中英文介绍、原生 manifest 本地化、权限及数据流草案、审核说明。
- 基于实际插件渲染器的新中英素材：卡片评分、独立放大预览、评分库和来源详情。
- 所有演示数据均明确标注；卡片/预览外壳是示意页面，评分库来自真实扩展页面。不包含用户账号、Key、观看记录或第三方电影海报。
- 图标/宣传图为项目原创；不是 Netflix 官方品牌素材。英文图片配英文文案，中文图片配中文文案。
- 上传候选包使用运行文件白名单；演示图、测试、依赖和材料本身不进入扩展运行包。

## 提交前仍需完成（不能用“勾选同意”代替）

### 1. 账户：由账号所有者处理

确认长期使用的 Google 发布者账号、是否已注册开发者；如未注册，注册费、可用支付方式和地区资格以后台当前显示为准。账号所有者阅读/接受协议，验证联系邮箱，开启两步验证，并按后台要求完成身份或商家信息。不需要把密码或验证码发给代理。

### 2. 安全与最小权限：需要工程收尾

当前 OMDb Key、作品缓存和绑定使用明文 `chrome.storage.local`。官方政策正文要求安全处理；User Data FAQ 第 9 问更具体地提到静态强加密，第 8 问只阐述传输最低要求。我们据此保留安全门槛，但**不声称已知道审核员一定会拒审或一定会批准**。

不能把同一配置目录里的可自动解密包装宣传为“保护被盗浏览器目录”。建议单独落实威胁模型、密钥管理、旧缓存迁移及测试，再关闭该项。会话内保存 Key 更少持久风险，但重启/扩展更新后需要重新填入；保留免解锁本机缓存则需要明确保护边界。

另需验证 `activeTab` 是否可移除：已有 Netflix host 权限、基础 `tabs.query` 和 `tabs.sendMessage` 通常不需要它。候选保留原权限不等于已经完成最小权限审查。保守方案还应在首次发起查询前提供一次数据去向提示及隐私链接；本轮仅完成了商店介绍的显著披露。

### 3. 数据源权限：需要确定发行方案

IMDb 未文档化检索、Cinemeta 镜像评分及 Netflix 匿名公开标题页并非已为本项目取得的授权 API。免费、个人 Key、公开可调用或 GitHub MIT 代码均不能自动解决第三方条款。

建议先确认许可/适用范围；不能确认时，应与所有者确认是否接受功能变化，换为明确允许的来源。不要静默删掉免费电影评分/跨语言匹配，也不要靠改名字或“学习用途”规避。OMDb 当前声明 CC BY-NC 4.0；TVmaze 明确提供 CC BY-SA，仍需各自署名及条件。

### 4. 最终验收、后台披露和提交

最终候选需要真实 Netflix 页面验收；合成截图和自动测试不能替代。审核账号/环境由所有者合法安排，若要求则只填后台私有测试字段。对照后台实时字段核对网站内容、可选认证 Key、浏览相关记录；不能全选“不收集”。Limited Use 肯定声明须在核对属实后再发布。

满足以上条件后才进入：**New item → 上传 upload/ 下的内层 ZIP → 商店资料/隐私/分发/测试说明 → 所有者确认 → 提交审核**。建议选择审核通过后再人工发布，而不是自动公开；未列出分发也不免除审核和政策要求。不要保证审核时间或一定过审。

## 官方参考

- 注册：https://developer.chrome.com/docs/webstore/register
- 首次发布：https://developer.chrome.com/docs/webstore/publish
- 商店资料与本地化：https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- 图片规格：https://developer.chrome.com/docs/webstore/images
- 隐私字段：https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- User Data FAQ：https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- 审核排错/最小权限：https://developer.chrome.com/docs/webstore/troubleshooting
- Limited Use：https://developer.chrome.com/docs/webstore/program-policies/limited-use

这些是准备材料与工程判断，不是法律意见、官方审核结论或发布者已经作出的认证。
