# Chinese README Override

优先阅读仓库已有的中文 README，并随时切换回原文的用户脚本。

脚本在支持的 Git 仓库页面查找中文 README，在浏览器中渲染后替换当前 README 正文，并提供「译文」标签。它不会自动翻译英文文档；仓库没有对应中文文件时，页面保持原样。

## 安装

### 1. 安装油猴

前往 [Tampermonkey 官方网站](https://www.tampermonkey.net/)，选择自己的浏览器，按提示从对应扩展商店安装。

安装后确认扩展已启用，并允许它访问需要使用脚本的网站。如果浏览器或扩展提示需要开启「允许用户脚本」或开发者模式，请按其提示操作。

### 2. 安装脚本

点击 **[安装 Chinese README Override](https://raw.githubusercontent.com/shenbourne/Github-Chinese-README-Override/main/github-chinese-readme-override.user.js)**，在油猴显示的安装页面中确认安装。

如果链接只显示代码或下载文件，可以手动安装：

1. 打开本仓库的 [`github-chinese-readme-override.user.js`](./github-chinese-readme-override.user.js)，复制完整内容。
2. 点击油猴图标，选择「添加新脚本」。
3. 清空编辑器默认内容，粘贴完整脚本并保存。
4. 刷新目标仓库页面。

## 使用方法

- 打开存在中文 README 的仓库首页，脚本会优先显示中文内容。
- 点击原有 README 标签可切回原文，点击「译文」可重新显示中文。
- 在没有合适标签栏的页面，脚本会尝试在 README 标题附近添加切换入口。
- 点击油猴菜单中的「中文 README 覆盖：已启用／已停用」可切换脚本状态；页面会随之刷新。
- 默认分支首页会依次查找根目录和 `docs` 目录；分支、标签或子目录页面会在识别到的当前目录内查找。

## 支持的网站

| 网站 | 默认运行 | 说明 |
| --- | --- | --- |
| GitHub（`github.com`） | 是 | 仓库首页及 `/tree/…` 页面 |
| Gitee（`gitee.com`） | 是 | 仓库首页及 `/tree/…` 页面 |
| GitLab（`gitlab.com`） | 是 | 仓库首页及 `/-/tree/…` 页面，支持多级项目路径 |
| GitCode（`gitcode.com`） | 是 | 仓库首页及 `/tree/…` 页面 |
| 自建 GitLab | 需添加匹配规则 | 根据页面信息识别，使用本站 API |
| Gitea / Forgejo | 需添加匹配规则 | 根据页面信息或本站版本 API 识别 |

这里列出的是代码中的适配范围，并不代表每个站点、每种页面布局或私有仓库场景都已完成实测。网站改版、API 策略及登录权限可能影响效果。

### 添加自己的站点（`@match`）

如果使用自建 GitLab、Gitea 或 Forgejo：

1. 打开油猴管理面板，找到此脚本并进入编辑器。
2. 在顶部 `// ==UserScript==` 与 `// ==/UserScript==` 之间添加站点规则，例如：

   ```javascript
   // @match        https://git.example.com/*
   // @match        https://code.example.org/*
   ```

3. 将域名替换为自己的真实域名，协议也应与实际访问地址一致，然后保存。
4. 允许扩展访问该站点，再刷新仓库页面。

也可在脚本管理器的设置中添加「用户匹配规则」，避免直接修改脚本头部；具体入口取决于管理器版本。

添加 `@match` 只决定脚本在哪些页面运行，不会自动适配新的代码托管平台。目标站点仍需兼容当前 GitLab、Gitea 或 Forgejo 的识别逻辑、API 和页面结构。不要为了方便添加全站通配规则。

## 其他说明

### 中文文件识别

脚本按 `CANDIDATE_NAMES` 中的顺序精确匹配文件名，同时尝试以小写 `readme` 开头的对应名称。常见候选包括：

- `README.zh-CN.md`、`README.zh_CN.md`、`README.zh-cn.md`、`README.zh.md`
- `README_zh.md`、`README_zh_CN.md`、`README-cn.md`、`README_CN.md`
- `README.zh-hans.md`、`README中文.md`、`README.中文.md`、`中文README.md`

完整列表以脚本为准。需要其他命名时，可以编辑 `CANDIDATE_NAMES`；这不是任意大小写匹配，也不会递归遍历整个仓库。

### 数据与隐私

- README 正文通过对应平台 API 获取，使用 marked 和 DOMPurify 在浏览器内渲染与清理。
- 不调用机器翻译服务，也不把 README 正文提交给第三方渲染服务。
- 依赖库通过脚本头部的 `@require` 从 jsDelivr 加载。
- README 中的外部图片仍可能向图片服务器发送请求；相对图片和链接会尝试转换为当前仓库对应地址。
- 启用状态保存在脚本管理器中。脚本未提供 API Token 配置入口。

### 已知限制与排查

- 私有仓库是否可读取取决于平台 API 和请求所具备的权限；浏览器已登录不保证 API 请求一定成功。
- API 限流、网络错误、扩展权限不足或依赖库加载失败都可能导致未替换。
- 当前使用本地 Markdown 渲染，平台专属语法、交互组件、锚点和样式可能与官方渲染结果不同。
- GitLab 目录接口目前只请求前 100 个条目；条目很多的目录可能漏掉中文文件。
- 切换分支、目录或站内导航后，脚本会重新检测；平台更新页面结构可能使正文定位或切换按钮失效。
- 修改脚本后请刷新页面；手动安装版本更新时，可重新安装最新脚本，或将最新代码完整替换并保存。

没有显示中文内容时，先确认仓库确实存在受支持命名的文件、脚本已启用、扩展拥有站点权限，再查看浏览器控制台中以 `[Chinese README Override]` 开头的错误。

## 问题反馈

请到 [Issues](https://github.com/shenbourne/Github-Chinese-README-Override/issues) 提交问题。提交前请搜索是否已有相同反馈，并尽量提供：

- 浏览器、油猴及脚本版本。
- 站点类型、公开可访问的仓库链接、分支与目录。
- 中文 README 的文件名、复现步骤、预期行为与实际结果。
- 必要的截图，以及控制台中相关错误。

私有仓库问题请使用脱敏示例；不要上传访问令牌、Cookie、私有 README 正文或其他敏感信息。

## 贡献指南

欢迎通过 Issue 讨论问题，或提交 Pull Request 改进文件名识别、站点适配和使用文档。

1. Fork 本仓库并创建用于修改的分支。
2. 修改脚本或文档，保持改动聚焦，并说明对应问题。
3. 如果修改脚本，使用 Node.js 执行基础语法检查：

   ```shell
   node --check github-chinese-readme-override.user.js
   ```

4. 在油猴中安装修改后的脚本，按改动范围验证：中文与原文切换、无中文文件、分支和子目录、相对链接及站内导航。
5. 提交 Pull Request，说明修改目的、验证过的平台与页面、实际结果和未验证的场景。

新增平台时，请同时考虑 API 读取、分支和目录识别、README 正文定位、链接转换与切换入口，并更新支持网站表。保持正文在本地渲染的行为。

## 许可证

[MIT](./LICENSE)
