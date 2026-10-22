# Chrome Web Store 上架准备

核对日期：2026-10-22。**尚未上传、送审或上架。** 当前工作已从通用草案整理为可复查的材料包，但未完成的安全、权限、数据源和生产验收事项仍是提交门槛。

## 材料入口

- [先读这里](../store/START-HERE.zh-CN.md)：版本、文件用途、所有者操作和未完成门槛。
- [中文介绍](../store/listing.zh-CN.txt) / [English description](../store/listing.en.txt)：显著说明数据去向、功能、限制与权限。
- [隐私字段底稿](../store/privacy-answers.md)：single purpose、permissions、remote code、数据类型、保留/删除。
- [审核操作说明](../store/reviewer-instructions.md)：实际测试流程、Netflix 登录前提、私有凭据边界。
- [机器可读门槛](../store/readiness.json)：`submissionAllowed:false`；材料齐全不等于可提交。
- [素材说明](../store/README.md)：合成数据、真实渲染器与实际 Netflix 验收的区别。
- [公开隐私政策源文件](privacy.html) / [第三方声明](../THIRD_PARTY_NOTICES.md)。

```sh
npm ci
npm test
npm run test:browser
npm run store:assets
npm run package
node tests/package-smoke.mjs
npm run store:kit
```

`store:assets` 是显式重拍动作；重拍后需目检并将图片与 `store/assets/provenance.json` 一起提交。`store:kit` 和 CI 只校验、打包已审图片，不会重新渲染覆盖它们。输入/图片哈希不一致会拒绝生成；来源状态包含白名单输入中的未跟踪文件。

`dist/*-store-preparation.zip` 是**给发布者的材料包**，不得整个上传。里面 `upload/*-chrome-web-store.zip` 才是满足门槛后拟上传的运行候选包；根目录含 manifest。发布准备不会读取/更改日常浏览器资料或凭据，也不会自动登录、付款、上传或勾选声明。

## 已完成

- MV3、原始 JS/CSS、包内执行逻辑，没有远程代码。
- 运行时白名单，排除依赖、测试、演示数据、商店材料及个人资料。
- 原生 `_locales/en` / `_locales/zh_CN` + `default_locale:en`，商店可识别两种语言；这是 manifest 元数据本地化，不改变已有界面语言选择逻辑。
- 当前名称统一为 **Netflix Score Lens**。商店名称/摘要来自 manifest 的本地化消息，不能在后台另填不同标题。未将更名建议默认为所有者批准，也不声称名称等于商标授权。
- 每种语言四张 1280×800 截图、共用 440×280 小宣传图、共用 128×128 图标（96px 图形 + 16px 透明边距）。截图为不带 alpha 的 PNG；图标保留透明边距。1400×560 marquee 为可选，本轮未制作。
- 图片使用实际扩展渲染器、虚构片名/评分和原创占位图；明确说明卡片页和放大层外壳不是 Netflix 账户截图。无海报、头像、浏览记录或真实 Key。
- 隐私政策、主页和支持地址具备公开地址；提交前重查可用性与最终文本。

## 必须关闭的门槛

### 账户与最终认证

由所有者确认长期维护的 Google 账号，完成必要的注册费、协议、邮箱验证、两步验证及后台要求的身份/商家信息。金额及资格以后台为准，不代付、不推定国家地区。Limited Use 肯定性声明须在发布者核对属实后加入公开政策；当前保留未认证状态。

### 安全处理、最小权限与知情

`chrome.storage.local` 目前明文保存可选 OMDb Key、作品缓存和手动绑定；`TRUSTED_CONTEXTS` 是访问限制，不是静态加密。官方政策正文要求安全处理；User Data FAQ Q9 明确提及静态强加密，Q8仅说明传输最低要求。保留工程门槛，但不将这解释为已证实会自动拒审。

须审查密钥管理、迁移与威胁模型。不能把可从同一浏览器配置恢复的密钥包装，宣传为可以保护整个配置被盗或设备受控。会话级 Key 不持久到磁盘，代价是浏览器重启或扩展更新后重新填写；保留无解锁的持久缓存则要如实界定防护边界。该选择影响产品体验，另立工程变更验证，不在材料生成脚本中偷偷改变。

`activeTab` 当前仍在候选中；官方最小权限说明指出特定 host 权限、基础 `tabs.query` 和 `tabs.sendMessage` 通常不需要它。提交前验证移除影响或给出实际必要性证据。商店介绍已提前披露数据去向，保守方案还应加入首次查询前的产品内提示和隐私链接。

### 数据源与品牌

IMDb suggestion、Cinemeta 镜像以及 Netflix 公开标题页并非已为本项目取得的授权接口。公开可读、免费分发、MIT 代码许可证或用户自带 Key 都不能单独证明允许这种发行方式。确认许可/适用范围；不能确认时先与所有者确定功能取舍，再换为明确授权的来源，不能悄悄删除核心功能或靠免责声明绕过条款。

OMDb 页面声明 CC BY-NC 4.0，须核对其个人/非商业条件与底层来源权利；TVmaze 声明 CC BY-SA，保留署名和链接。具体依据在第三方声明和材料说明中。无“必过审”或法律结论。

### 实际可复现验收

最终候选需要真实 Netflix 首页/电影/剧集/搜索、滚动、独立放大预览、阈值、纠错、评分库、不同 Key 状态及升级验收。尤其 0.6.3 的单集父剧集身份需要真实页面确认。自动 fixture/模拟评分不替代实际验收，也不替代审核账号。

卡片功能需要 Netflix 登录。若要求审核访问，由所有者合法安排并仅通过私有 Test instructions 传递；不使用个人主账号资料，不写进开源仓库或材料 ZIP。

## 真正的提交流程（当前未执行）

门槛关闭 → 确认发布账号/名称/分发范围 → New item 上传内层 ZIP → Store listing / Privacy / Distribution / Test instructions → 所有者批准最终资料和声明 → Submit for review。

建议审核通过后再手动发布。官方的 staged 状态有保留期限（当前文档为 30 天），届时重查。未列出分发也需要审核；不能承诺几天必过。代码合并、GitHub Release、商店草稿、送审和上架是五个不同状态。

## 官方来源

- https://developer.chrome.com/docs/webstore/register
- https://developer.chrome.com/docs/webstore/set-up-account
- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- https://developer.chrome.com/docs/webstore/images
- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- https://developer.chrome.com/docs/webstore/program-policies/limited-use
- https://developer.chrome.com/docs/webstore/troubleshooting
- https://developer.chrome.com/docs/webstore/review-process
