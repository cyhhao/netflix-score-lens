# Netflix Score Lens

[![CI](https://github.com/cyhhao/netflix-score-lens/actions/workflows/ci.yml/badge.svg)](https://github.com/cyhhao/netflix-score-lens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/code-MIT-blue.svg)](LICENSE)

在 Netflix 卡片上显示评分，用可调遮罩弱化低分作品，并在独立评分库中浏览本机已经匹配的作品。

**Independent Chrome MV3 extension: rating badges, low-score dimming, conservative title matching, and a local score library.** The current UI is Simplified Chinese; matching supports localized titles. No affiliation with Netflix or any rating provider.

> **当前状态：开源、本地加载可用；尚未在 Chrome Web Store 上架。**
> 商店材料及专用 ZIP 已准备，但凭据/历史缓存的静态加密、数据披露及第三方数据使用范围仍需完成发布审查，不能把 ZIP 生成成功当成审核通过。见 [上架清单](docs/chrome-web-store.md)。

## 安装

1. 从 [Releases](https://github.com/cyhhao/netflix-score-lens/releases) 下载 `netflix-score-lens-<版本>-unpacked.zip` 并解压。
2. 打开 `chrome://extensions`，开启开发者模式，点击「加载已解压的扩展程序」。
3. 选择包含 `manifest.json` 的 `netflix-score-lens` 目录。保留此目录，Chrome 持续从中读取扩展。
4. 登录 Netflix，刷新浏览页。默认免费源即可工作，不必先配置 Key。

也可克隆本仓库后直接加载仓库根目录；运行扩展本身无需 Node 或 npm。

更新时保留原目录/扩展，在扩展管理页「重新加载」，再刷新 Netflix。不要为了更新先移除扩展，以免丢失本机设置。

## 功能

- **评分角标**：IMDb 镜像、TVmaze 独立评分，以及可选 OMDb 的 IMDb / 烂番茄 / Metacritic。每个来源保留原始尺度。
- **低分弱化**：选择评分口径和阈值、遮罩强度；支持悬停恢复。缺失或待确认评分不会当成 0 分。
- **保守匹配**：Netflix ID 标识作品，使用本地化标题、年份与类型匹配 IMDb ID。中日韩名称优先走 IMDb 别名检索，歧义保留给用户确认。
- **纠错**：在弹窗「作品」中搜索原名、年份、类型或 IMDb ID/链接，明确绑定或恢复自动匹配。
- **独立评分库**：弹窗顶部进入；无需保持 Netflix 标签页打开。搜索、电影/剧集和状态筛选、评分/标题/年份/时间排序、类别/状态/评分段分组、来源资料与 Netflix 链接。
- **状态可见**：请求失败、额度/Key 问题、匹配歧义分别提示；支持重试、暂停、来源验证。

### 有 Key / 无 Key 的规则

| 配置 | 自动取分 |
|---|---|
| 无 Key | Cinemeta 的 IMDb 镜像；剧集另尝试 TVmaze 的独立评分 |
| 自带 OMDb Key + 开启补充 | 免费源 + 同一 IMDb ID 的 OMDb 结果；重复 IMDb 分数以 OMDb 为准 |
| 有 Key但选择「仅免费源」 | 自动取分不使用 OMDb；手动「实时验证」仍会测试已配置 Key |

优先读有效缓存；正常评分缓存最多 7 天。OMDb 失败保留免费源评分。自动评分口径按 IMDb → TVmaze → 烂番茄 → Metacritic 选第一个可用值，不取最高分、不求平均。明确选择某一来源后，不因缺失而偷偷替换另一来源。

### 边界

- 不是官方 Netflix↔IMDb 映射；同名/翻拍/译名可能需要手动确认。Netflix 未必提供英文原名或完整年份。
- Cinemeta 是镜像，不是 IMDb 官方评分 API；IMDb 标题建议接口未公开承诺稳定性。第三方可限流、停用或改变条款。
- 不保证每部作品都有 IMDb、RT 或 Metacritic，也不保证镜像实时更新。
- 评分库是**最多 600 个查询版本的本机缓存视图**，不是全量 Netflix 目录或永久收藏夹。清缓存、更换 Key、切换取分模式和容量淘汰会移除条目。
- 类别目前为电影/剧集，不含动作/悬疑等题材标签。Netflix 地区可用性需要打开 Netflix 核对。
- 本地开发者模式版本不会自动下载更新；Netflix DOM/API 变动可能需要适配。

## 隐私与数据来源

[隐私政策](https://cyhhao.github.io/netflix-score-lens/privacy.html) · [第三方声明](THIRD_PARTY_NOTICES.md) · [安全说明](SECURITY.md)

扩展仅在 Netflix 读取匹配所需标题、作品 ID、年份和类型；片名/IMDb ID 会发送给相应评分服务，服务可看到请求来源 IP。可选 OMDb Key 仅发送给 OMDb。无项目自有后端、广告、分析 SDK、账户注册或浏览器全历史权限，不读取 Netflix 密码或 Cookie。

**本地存储不等于加密。** 目前设置、已遇到作品缓存、手动匹配和可选 Key 保存在 Chrome 扩展本地存储；内容脚本无权读取凭据，但这不是操作系统密码库，也未实现应用层静态加密。有本机/浏览器配置访问权的人仍可能读取它们。不应填写其他服务密码或高价值凭据。

MIT 许可只涵盖本项目代码，不替第三方评分数据、商标、海报或 API 使用授权。TVmaze 数据保留其 CC BY-SA 许可及来源归属；其他服务的访问/再分发权需遵循各自条款。

## 开发与测试

Node.js 22+、Python 3；Chrome 浏览器测试使用临时配置，绝不使用日常浏览器资料或真实 Key。

```bash
npm ci
npm test
npx playwright install chromium
npm run test:browser
npm run package
```

Linux 如缺浏览器系统依赖：`npx playwright install --with-deps chromium`。
可通过 `CHROME_PATH` 或 `CFT_PATH` 指定可加载扩展的浏览器可执行文件，不要传个人 profile。

```bash
# 可选：会访问真实评分服务，可能受网络、限流与覆盖率影响
npm run test:live
PROVIDERS_LIVE=1 node --test tests/providers.test.mjs
```

CI 默认跑单元测试和隔离真实扩展测试，不把第三方 API 的可用性当作每次 PR 的确定性要求。
测试数据只存在于测试脚本，绝不会打入安装包。[验证范围](docs/testing.md)明确区分 fixture、真实 API 和实际 Netflix 页面验收。

## 打包与上架

`npm run package` 只使用显式文件白名单，生成 `dist/`：

- `*-unpacked.zip`：用户解压安装，含顶层目录。
- `*-chrome-web-store.zip`：`manifest.json` 位于 ZIP 根部，供商店上传；**不是已签名/已审核版本**。
- `SHA256SUMS.txt`：完整性校验。

商店清单、权限用途、数据披露、审核测试说明及材料草案见 [docs/chrome-web-store.md](docs/chrome-web-store.md)。不得将 Key、Netflix 登录资料或个人浏览截图作为公开材料。

## 贡献

欢迎 [Issue](https://github.com/cyhhao/netflix-score-lens/issues) 与 PR。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请使用私密漏洞报告，不要公开贴凭据。

## License

[MIT](LICENSE) — cyhhao and contributors. Netflix、IMDb、Rotten Tomatoes、Metacritic、TVmaze、Stremio 等名称属于各自权利人；本项目没有关联或背书。
