# Fluent Reader Alpine

## Overview

Fluent Reader Alpine is an independently maintained lightweight fork of [Fluent Reader](https://github.com/yang991178/fluent-reader) by Haoyuan Liu and its contributors. It retains the upstream reading interface and feed/service logic while migrating the desktop runtime to Tauri and optimizing list virtualization. The app uses React, Redux, TypeScript, and Fluent UI. Rust manages the native window, settings, and SQLite via rusqlite. The renderer queries SQLite using the Drizzle sqlite-proxy adapter over Tauri commands. Preserve upstream attribution and the BSD 3-Clause license when updating documentation or branding.

## Build & Validate

Run from the repository root with Node.js 24, the pnpm version in `package.json`, and the platform's Tauri prerequisites.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

`pnpm check` runs Oxlint, Oxfmt, and TypeScript. Use `pnpm format` to apply formatting. `pnpm build` compiles the renderer with Rspack into `dist/`.

Run `pnpm dev` to launch the desktop app or `pnpm package` to build native bundles. Both commands build the renderer through Tauri's build hooks. Bundles are written to `src-tauri/target/release/bundle/`.

The private E2E suite is optional. See [tests/README.md](tests/README.md) for setup and commands.

## CI/CD

`release-main.yml` runs when a `v*` version tag is pushed or when manually dispatched for an existing tag. It validates the package/Tauri/Cargo versions, then builds Windows x64 NSIS, universal macOS DMG, and Linux x64 AppImage in parallel. All platforms install with pnpm's frozen lockfile and run `pnpm check` before packaging. Only after all three builds succeed does the release job upload exactly three installers into one draft Release. There is no Windows portable ZIP or separate Linux release workflow. Published releases are never overwritten by a rerun.

## Project Layout

### Root files
| File | Purpose |
|---|---|
| `package.json` | Dependencies, pnpm version, and scripts |
| `rspack.config.js` | Renderer bundler configuration |
| `tsconfig.json` | TypeScript configuration |
| `.oxfmtrc.json` | Oxfmt formatting rules and exclusions |
| `src-tauri/tauri.conf.json` | Tauri build, window, and installer configuration |
| `src-tauri/src/main.rs` | Native window, Tauri commands, SQLite, and settings |

### `src/` — All source code

| Path | Description |
|---|---|
| `preload.ts` | **Preload script**. Installs the settings, utilities, and database bridges before the renderer mounts. |
| `index.tsx` | **Renderer entry**. Mounts React `<Root>` with Redux `<Provider>`. |
| `schema-types.ts` | Shared TypeScript enums and types (ViewType, ThemeSettings, StoredRule, etc.) |
| `db/schema.ts` | **Drizzle schema** — defines `sourcesTable` and `itemsTable` for better-sqlite3. |
| `bridges/` | Bridges from the renderer to Tauri commands (`settings.ts`, `utils.ts`, `db.ts`). |
| `scripts/` | Renderer-side logic (runs in browser context). |
| `scripts/reducer.ts` | Root Redux store — combines: sources, items, feeds, groups, page, service, app. |
| `scripts/settings.ts` | Theme management, locale setup, Fluent UI theming. |
| `scripts/db.ts` | Drizzle sqlite-proxy database instance (`database`). Also contains the one-time Lovefield→SQLite migration (`init()`), which reads Lovefield IndexedDB, inserts into SQLite via drizzle proxy, then deletes the IndexedDB databases. |
| `scripts/utils.ts` | Shared utilities and type helpers. |
| `scripts/models/` | Redux slices: `app.ts`, `feed.ts`, `group.ts`, `item.ts`, `page.ts`, `rule.ts`, `service.ts`, `source.ts`, plus `services/` for RSS service integrations. |
| `scripts/i18n/` | Internationalization. `_locales.ts` maps locale codes to JSON files. 19 languages. Translations are JSON files (e.g., `en-US.json`). Uses `react-intl-universal`. |
| `components/` | React UI components. `root.tsx` is the top-level layout. Sub-dirs: `cards/` (article card variants), `feeds/` (feed list views), `settings/` (settings panels), `utils/` (shared UI helpers). |
| `containers/` | Redux-connected container components that map state/dispatch to component props. |

### `dist/` — Build output + static assets

The `dist/` directory contains **both Rspack output and checked-in static assets**. Files like `dist/icons/`, `dist/article/`, `dist/styles/`, `dist/index.css`, `dist/fonts.vbs`, `dist/fontlist`, and `dist/drizzle/` are static and tracked in git. The Rspack-generated files (`*.js`, `*.js.map`, `*.html`, `*.LICENSE.txt`) are gitignored.

### `build/` — Packaging resources

Contains app icons (`build/icons/`), macOS entitlements plists, provisioning profiles, and `resignAndPackage.sh` for Mac App Store builds. Also has `build/appx/` for Windows Store assets.

## Architecture Notes

- **IPC pattern**: The renderer calls native operations through the wrappers in `src/bridges/`.
- **Database**: The renderer's Drizzle sqlite-proxy calls Tauri's `db_execute` command. The native app initializes and opens SQLite in its application config directory. The renderer schema is in `src/db/schema.ts`.
- **Rules storage**: The native app stores the `sourceRules` map in `config.json`. `setRulesForTarget()` replaces one target's ordered rules. An empty array removes the entry.

- **State management**: Redux with `redux-thunk` for async actions. The store shape is defined by `RootState` in `scripts/reducer.ts`. Each model file in `scripts/models/` exports its own reducer, action types, and thunk action creators.
- **i18n**: To add or modify translations, edit JSON files in `src/scripts/i18n/`. Register new locales in `_locales.ts`.
- **RSS service integrations**: Located in `src/scripts/models/services/` (logic) and `src/components/settings/services/` (UI). Supported: Fever, Google Reader API (GReader), Inoreader, Feedbin, Miniflux, Nextcloud.

## Key Conventions

- All source is TypeScript (`.ts`/`.tsx`). No plain JavaScript in `src/`.
- No semicolons. 4-space indentation. See `.oxfmtrc.json`.
- Enums use `const enum` pattern in `schema-types.ts`.
- Components use both class components and function components (no strict rule).
- Redux containers in `containers/` use `connect()` from react-redux.
- **Griffel styling**: Use `makeStyles` from `@griffel/react` for component-scoped styles. Import `mergeClasses` for combining classes. Prefer Griffel over adding new CSS rules to `dist/styles/`.
- **`styleClass` prop convention**: Reusable components expose a `styleClass?: string` prop applied to the component's main element, allowing parents to pass Griffel-generated class overrides. If a component has multiple customizable elements, use element-specific prop names (e.g., `buttonStyleClass?: string`). Combine base and override classes with `mergeClasses`.
- **Flat button components**: `FlatButton`, `FlatButtonGroup`, and `FlatButtonSeparator` in `src/components/utils/` implement the Griffel + `styleClass` pattern. Use these instead of raw `<button>`/`<div>` with CSS class names for toolbar-style buttons.
