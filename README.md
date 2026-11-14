<p align="center">
  <img width="120" height="120" src="build/icon-alpine.png" alt="Fluent Reader Alpine 图标">
</p>
<h1 align="center">Fluent Reader Alpine</h1>
<p align="center">Fluent Reader 轻量版 · Tauri 桌面 RSS 阅读器</p>
<p align="center">
  <a href="https://github.com/ljh12138164/fluent-reader-alpine/releases">下载</a> ·
  <a href="https://github.com/ljh12138164/fluent-reader-alpine/issues">问题反馈</a> ·
  <a href="https://github.com/yang991178/fluent-reader">上游项目</a>
</p>

**Fluent Reader Alpine 是 [Fluent Reader](https://github.com/yang991178/fluent-reader) 的轻量版。** 项目基于上游代码独立维护，延续其 Fluent Design 界面、RSS 抓取和服务同步逻辑，将桌面运行时迁移到 Tauri，并优化长列表滚动和构建流程。“轻量版”侧重减少桌面运行时的打包负担，保留上游的主要阅读功能。

原项目由 **Haoyuan Liu（yang991178）及其贡献者**开发。Alpine 是独立维护的衍生项目，不是上游官方发行版，也不同于上游的移动端项目 Fluent Reader Lite。

## 轻量化改动

| 方向 | Alpine 的实现 |
| --- | --- |
| 桌面运行时 | 使用 Tauri 和 Rust，通过系统 WebView 显示界面，无需随应用打包完整 Chromium 与 Node.js |
| 数据存储 | 使用 Rust / rusqlite 管理 SQLite，通过 Drizzle sqlite-proxy 供前端查询 |
| 列表滚动 | 卡片、列表、杂志和紧凑视图使用虚拟化，只挂载可视区域附近的文章 |
| 前端构建 | 使用 pnpm 和 Rspack；用 Oxlint、Oxfmt 和 TypeScript 校验项目 |

“轻量”主要指运行时和构建方式。实际内存占用、启动速度和滚动表现取决于系统 WebView、订阅规模及文章内容，此处不提供未经对比测试的性能数字。

## 功能

- 本地订阅和定时抓取，浅色、深色及跟随系统主题。
- 卡片、列表、杂志和紧凑阅读视图，文章正文、全文提取和网页阅读。
- 未读、收藏、隐藏状态筛选及正则表达式搜索。
- 订阅分组、OPML 导入与导出、应用数据备份与恢复。
- 根据规则自动标记已读、收藏或隐藏文章。
- 单键快捷键和桌面新文章通知。
- 延续上游的 Fever、Google Reader API、Inoreader、Feedbin、Miniflux 和 Nextcloud 服务接入。

<p align="center">
  <img src="docs/imgs/screenshot.jpg" alt="继承自上游的 Fluent Reader 阅读界面">
</p>

上图为上游界面示意，Alpine 延续其整体布局；具体界面以当前版本为准。

## 下载与运行

当前版本为 **0.1.0**。CI 会为 Windows、macOS 和 Linux 自动构建安装包，并统一上传到草稿 Release，供维护者验收。草稿正式发布后，可以从 **[本项目 Releases](https://github.com/ljh12138164/fluent-reader-alpine/releases)** 下载。

- **Windows 安装版**：运行 `*-setup.exe`。
- **macOS**：使用 Universal DMG，兼容 Apple Silicon 和 Intel Mac。
- **Linux**：使用 x64 AppImage，下载后添加执行权限再运行。

Windows 包依赖 Microsoft Edge WebView2 Runtime。当前以 Windows 为主要运行验收平台；CI 构建成功不代表已完成 macOS 实机验收。macOS 包暂未配置 Apple 开发者签名与公证。本项目的发行包不通过上游的 Microsoft Store 或 Mac App Store 页面分发。

## 本地开发

准备 Node.js 24、`package.json` 中指定版本的 pnpm，以及对应平台的 [Tauri 构建环境](https://v2.tauri.app/start/prerequisites/)。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

启动桌面应用：

```sh
pnpm dev
```

生成原生发行包：

```sh
pnpm package
```

`pnpm check` 执行 Oxlint、Oxfmt 和 TypeScript 检查；`pnpm format` 应用格式化。`pnpm build` 通过 Rspack 将前端输出到 `dist/`。启动及打包命令会自动构建前端，原生安装包输出到 `src-tauri/target/release/bundle/`。

`dist/` 还包含受版本控制的静态资源，不能作为纯构建缓存整体删除。可选私有 E2E 测试的说明见 [tests/README.md](tests/README.md)，常规开发与构建不依赖它。

### CI 发布流程

推送与应用版本一致的 `v*` 标签（首版为 `v0.1.0`），触发[三平台工作流](.github/workflows/release-main.yml)。也可以在 Actions 页面选择此工作流，用已有标签手动触发。

1. 校验标签与 `package.json`、Tauri、Cargo 及 Cargo 锁文件中的版本一致。
2. 在 Windows、macOS 和 Linux runner 上并行安装依赖，运行 `pnpm check`，通过 Tauri 构建对应安装包。
3. 三个平台全部成功后，自动创建一个**草稿 Release**，上传以下三个文件；不生成 Windows 免安装 ZIP。

| 平台 | 0.1.0 发布文件 |
| --- | --- |
| Windows x64 | `Fluent.Reader.Alpine-0.1.0-windows-x64-setup.exe` |
| macOS Universal | `Fluent.Reader.Alpine-0.1.0-macos-universal.dmg` |
| Linux x64 | `Fluent.Reader.Alpine-0.1.0-linux-x64.AppImage` |

构建失败时不会创建 Release；成功构建的中间产物可从该次 Actions 运行页面下载。重跑同一版本可更新已有草稿中的安装包，但不会覆盖正式发布的 Release。维护者验收草稿后可手动发布，使安装包对普通下载者可见。[查看运行进度](https://github.com/ljh12138164/fluent-reader-alpine/actions)。

## 致谢与许可证

- 上游：[Fluent Reader](https://github.com/yang991178/fluent-reader)，作者 Haoyuan Liu 及其贡献者。
- 核心技术：Tauri、Rust、React、Redux、Fluent UI、SQLite、Drizzle 和 Rspack。
- 全文提取使用 Mercury Parser；Lovefield 用于兼容旧数据迁移。
- Alpine 图标沿用上游的蓝色层叠纸张与白色 F 图形，仅添加绿色 Lite 角标来标识轻量版。

本项目沿用 [BSD 3-Clause 许可证](LICENSE)，保留上游版权声明。与 Alpine 分支相关的问题请提交到[本项目 Issues](https://github.com/ljh12138164/fluent-reader-alpine/issues)。
