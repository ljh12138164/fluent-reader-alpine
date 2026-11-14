<p align="center">
  <img width="120" height="120" src="build/icon-alpine.png" alt="Fluent Reader Alpine icon">
</p>
<h1 align="center">Fluent Reader Alpine</h1>
<p align="center">A lightweight edition of Fluent Reader, powered by Tauri</p>
<p align="center">
  <a href="https://github.com/ljh12138164/fluent-reader-alpine/releases">Download</a> ·
  <a href="https://github.com/ljh12138164/fluent-reader-alpine/issues">Feedback</a> ·
  <a href="https://github.com/yang991178/fluent-reader">Upstream</a>
</p>

**Fluent Reader Alpine is a lightweight edition of [Fluent Reader](https://github.com/yang991178/fluent-reader).** This independently maintained fork preserves the upstream Fluent Design interface, feed fetching and service synchronization logic while moving the desktop runtime to Tauri and improving article list virtualization and frontend builds.

The original project was developed by **Haoyuan Liu (yang991178) and its contributors**. Alpine is an independent derivative, separate from the upstream desktop releases and the Fluent Reader Lite mobile app.

## Lightweight foundation

| Area | Alpine implementation |
| --- | --- |
| Desktop runtime | Tauri and Rust use the system WebView, without bundling a complete Chromium and Node.js runtime |
| Storage | Rust / rusqlite manage SQLite, queried by the frontend through Drizzle sqlite-proxy |
| Article lists | Card, list, magazine and compact layouts mount articles near the visible area |
| Frontend tooling | pnpm and Rspack for builds; Oxlint, Oxfmt and TypeScript for checks |

The lightweight edition focuses on a smaller runtime footprint while retaining the main reading features. Actual memory use, startup time and scrolling performance depend on the system WebView, feed collection and article content.

## Features

- Local subscriptions and scheduled fetching, with light, dark and system themes.
- Card, list, magazine and compact layouts, built-in article reading, full-text extraction and webpage loading.
- Unread, starred and hidden filters, plus regular-expression search.
- Subscription groups, OPML import/export, and application backup/restore.
- Rules to automatically mark articles as read, starred or hidden.
- Single-key shortcuts and native desktop notifications for new articles.
- Upstream service integrations for Fever, Google Reader API, Inoreader, Feedbin, Miniflux and Nextcloud.

<p align="center">
  <img src="docs/imgs/screenshot.jpg" alt="The Fluent Reader interface inherited from upstream">
</p>

This upstream screenshot illustrates the inherited layout. The current Alpine release may differ in details.

## Download and installation

The current version is **0.1.0**. CI builds Windows, macOS and Linux installers and uploads them to a draft Release for review. Once published, packages are available from **[this project's Releases](https://github.com/ljh12138164/fluent-reader-alpine/releases)**.

- **Windows x64:** run the Setup EXE, or extract the Unpacked ZIP and run `fluent-reader-alpine.exe`.
- **macOS:** use the Universal DMG, supporting Apple Silicon and Intel Macs.
- **Linux x64:** make the AppImage executable, then run it.

Windows requires Microsoft Edge WebView2 Runtime. Windows is the primary platform for runtime acceptance testing; a successful CI build does not replace testing on a physical Mac. Apple Developer signing and notarization are not configured for the macOS package. Alpine packages are distributed through this repository's Releases.

## Development

Install Node.js 24, the pnpm version pinned in `package.json`, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

Launch the desktop app:

```sh
pnpm dev
```

Build native packages:

```sh
pnpm package
```

`pnpm check` runs Oxlint, Oxfmt and TypeScript. Use `pnpm format` to apply formatting. `pnpm build` compiles the frontend with Rspack into `dist/`. Development and packaging commands build the frontend automatically. Native bundles are written to `src-tauri/target/release/bundle/`.

`dist/` also contains tracked static assets, so do not delete the whole directory as a build cache. The optional private E2E suite is described in [tests/README.md](tests/README.md); normal builds do not require it.

### CI releases

Push a `v*` tag matching the application version, starting with `v0.1.0`, to trigger the [three-platform workflow](.github/workflows/release-main.yml). You can also run it manually from Actions using an existing version tag.

1. Validate that the tag matches `package.json`, Tauri, Cargo and the Cargo lockfile.
2. Install dependencies and run `pnpm check` on Windows, macOS and Linux runners, then build each installer with Tauri.
3. After all three builds succeed, create one **draft Release** containing the same four package formats as the [upstream release](https://github.com/yang991178/fluent-reader/releases/tag/v1.3.2): Windows Setup EXE, Windows Unpacked ZIP, macOS DMG and Linux AppImage.

| Platform | Version 0.1.0 asset |
| --- | --- |
| Windows x64 installer | `Fluent.Reader.Alpine.Setup.0.1.0.x64.exe` |
| Windows x64 unpacked | `Fluent.Reader.Alpine.Unpacked.0.1.0.x64.zip` |
| macOS Universal | `Fluent.Reader.Alpine.0.1.0.dmg` |
| Linux x64 | `Fluent.Reader.Alpine.0.1.0.AppImage` |

The Unpacked ZIP includes the executable, license and a short README. It uses the system WebView2 Runtime and stores data in the user application-data directory.

Failed builds do not create a Release. Successful intermediate packages remain available as workflow artifacts. Reruns can update an existing draft but cannot overwrite a published Release. Maintainers can publish the draft after reviewing its packages. [View workflow runs](https://github.com/ljh12138164/fluent-reader-alpine/actions).

## Credits and license

- Upstream: [Fluent Reader](https://github.com/yang991178/fluent-reader), by Haoyuan Liu and its contributors.
- Built with Tauri, Rust, React, Redux, Fluent UI, SQLite, Drizzle and Rspack.
- Mercury Parser provides full-text extraction; Lovefield is retained for legacy data migration.
- The Alpine icon preserves the upstream blue sheets and white F, adding a green Lite badge to identify the lightweight edition.

This project retains the upstream copyright notice and [BSD 3-Clause license](LICENSE). Please report Alpine-specific issues in [this repository](https://github.com/ljh12138164/fluent-reader-alpine/issues).
