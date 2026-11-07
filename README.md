# 中文 README 优先显示

打开 GitHub、Gitee、GitLab 或 GitCode 仓库时，优先显示仓库已有的中文 README。点击「译文」和原有 README 标签，即可在两个版本之间切换。

## 安装

安装 [Tampermonkey](https://www.tampermonkey.net/)，然后在 Greasy Fork 搜索「中文 README 优先显示」并安装。

## 使用

- 打开仓库首页，脚本会在根目录和 `docs` 中查找中文 README，例如 `README.zh-CN.md`、`README_zh.md` 或 `README_CN.md`。
- 浏览分支、标签或子目录时，脚本会在当前目录查找译文。
- 在 Tampermonkey 菜单中点击「中文 README 覆盖」可启用或停用脚本。
- 使用自建 GitLab、Gitea 或 Forgejo 时，在脚本管理器的用户匹配规则中添加站点地址，例如 `https://git.example.com/*`。

脚本通过仓库平台的 API 读取文件，在浏览器中渲染 Markdown。README 中的图片由浏览器从对应图片地址加载。

## 开发

修改 `src/readme-override.js`，然后构建并检查安装文件：

```sh
node scripts/build.mjs
node --check github-chinese-readme-override.user.js
node scripts/build.mjs --check
```

欢迎在 [GitHub Issues](https://github.com/shenbourne/Github-Chinese-README-Override/issues) 反馈问题。

[MIT 许可证](./LICENSE)
