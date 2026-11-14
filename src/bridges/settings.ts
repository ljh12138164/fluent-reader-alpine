import {
    SourceGroup,
    ViewType,
    ThemeSettings,
    SearchEngines,
    ServiceConfigs,
    ViewConfigs,
    StoredRule,
    StoredRules,
    RuleTarget,
    SyncService,
    getRuleTargetKey,
    ARTICLE_OVERLAY_MIN_WIDTH,
    LIST_VIEW_MIN_WIDTH,
} from "../schema-types"
import {
    runtimeState,
    persistSettingsCache,
    tauriInvoke,
    themeListeners,
    computeShouldUseDarkColors,
} from "./tauri-runtime"

function getSetting<T>(key: string, defaultVal: T): T {
    const val = runtimeState.settings[key]
    return val !== undefined ? (val as T) : defaultVal
}

function setSettingAsync(key: string, value: unknown): Promise<void> {
    if (value === null || value === undefined) {
        delete runtimeState.settings[key]
    } else {
        runtimeState.settings[key] = value
    }
    persistSettingsCache()
    return tauriInvoke("set_setting", { key, value: value ?? null })
}

function nextGroupId(): number {
    const groups = getSetting<SourceGroup[]>("sourceGroups", [])
    const ids = groups.map(g => g.gid)
    const rules = getSetting<StoredRules>("sourceRules", {})
    for (const key of Object.keys(rules)) {
        if (key.startsWith("group:")) ids.push(Number(key.slice(6)))
    }
    return Math.max(
        getSetting<number>("nextGroupId", 0),
        ...ids
            .filter(id => Number.isSafeInteger(id) && id >= 0)
            .map(id => id + 1)
    )
}

const settingsBridge = {
    allocateGroupId: (): number => {
        const gid = nextGroupId()
        runtimeState.settings.nextGroupId = gid + 1
        persistSettingsCache()
        tauriInvoke("allocate_group_id")
        return gid
    },
    saveGroups: (groups: SourceGroup[]) => {
        return setSettingAsync("sourceGroups", groups)
    },
    loadGroups: (): SourceGroup[] => {
        const nextId = nextGroupId()
        if (getSetting<number>("nextGroupId", 0) < nextId) {
            runtimeState.settings.nextGroupId = nextId
        }
        const groups = getSetting<SourceGroup[]>("sourceGroups", []).map(g => ({
            ...g,
        }))
        const ids = new Set<number>()
        let changed = false
        for (const group of groups) {
            if (
                !Number.isSafeInteger(group.gid) ||
                group.gid < 0 ||
                ids.has(group.gid)
            ) {
                group.gid = settingsBridge.allocateGroupId()
                changed = true
            }
            if ("index" in group) {
                delete group.index
                changed = true
            }
            ids.add(group.gid)
        }
        if (changed) {
            setSettingAsync("sourceGroups", groups)
        }
        return groups
    },

    getDefaultMenu: (): boolean => {
        return getSetting<boolean>("menuOn", false)
    },
    setDefaultMenu: (state: boolean) => {
        setSettingAsync("menuOn", state)
    },

    getProxyStatus: (): boolean => {
        return getSetting<boolean>("pacOn", false)
    },
    toggleProxyStatus: () => {
        const next = !settingsBridge.getProxyStatus()
        setSettingAsync("pacOn", next)
    },
    getProxy: (): string => {
        return getSetting<string>("pac", "")
    },
    setProxy: (address: string = null) => {
        if (address) {
            setSettingAsync("pac", address)
        }
    },

    getDefaultView: (): ViewType => {
        return getSetting<ViewType>("view", ViewType.Cards)
    },
    setDefaultView: (viewType: ViewType) => {
        setSettingAsync("view", viewType)
    },

    getThemeSettings: (): ThemeSettings => {
        return getSetting<ThemeSettings>("theme", ThemeSettings.Default)
    },
    setThemeSettings: (theme: ThemeSettings) => {
        runtimeState.settings.theme = theme
        persistSettingsCache()
        tauriInvoke<boolean>("set_theme", { theme }).then(isDark => {
            runtimeState.shouldUseDarkColors = isDark
            themeListeners.forEach(cb => cb(isDark))
        })
    },
    shouldUseDarkColors: (): boolean => {
        return computeShouldUseDarkColors()
    },
    addThemeUpdateListener: (callback: (shouldDark: boolean) => any) => {
        themeListeners.add(callback)
    },

    setLocaleSettings: (option: string) => {
        setSettingAsync("locale", option)
    },
    getLocaleSettings: (): string => {
        return getSetting<string>("locale", "default")
    },
    getCurrentLocale: (): string => {
        const setting = settingsBridge.getLocaleSettings()
        return setting === "default" ? runtimeState.systemLocale : setting
    },

    getFontSize: (): number => {
        return getSetting<number>("fontSize", 16)
    },
    setFontSize: (size: number) => {
        setSettingAsync("fontSize", size)
    },

    getFont: (): string => {
        return getSetting<string>("fontFamily", "")
    },
    setFont: (font: string) => {
        setSettingAsync("fontFamily", font)
    },

    getArticleOverlayWidth: (): number => {
        const width = getSetting<number>(
            "articleOverlayWidth",
            ARTICLE_OVERLAY_MIN_WIDTH
        )
        return Number.isFinite(width)
            ? Math.max(ARTICLE_OVERLAY_MIN_WIDTH, Math.round(width))
            : ARTICLE_OVERLAY_MIN_WIDTH
    },
    setArticleOverlayWidth: (width: number): Promise<void> => {
        if (Number.isFinite(width) && width >= ARTICLE_OVERLAY_MIN_WIDTH) {
            return setSettingAsync("articleOverlayWidth", Math.round(width))
        }
        return Promise.resolve()
    },

    getListViewWidth: (): number => {
        const width = getSetting<number>("listViewWidth", LIST_VIEW_MIN_WIDTH)
        return Number.isFinite(width)
            ? Math.max(LIST_VIEW_MIN_WIDTH, Math.round(width))
            : LIST_VIEW_MIN_WIDTH
    },
    setListViewWidth: (width: number): Promise<void> => {
        if (Number.isFinite(width) && width >= LIST_VIEW_MIN_WIDTH) {
            return setSettingAsync("listViewWidth", Math.round(width))
        }
        return Promise.resolve()
    },

    getFetchInterval: (): number => {
        return getSetting<number>("fetchInterval", 0)
    },
    setFetchInterval: (interval: number) => {
        setSettingAsync("fetchInterval", interval)
    },

    getSearchEngine: (): SearchEngines => {
        return getSetting<SearchEngines>("searchEngine", SearchEngines.Google)
    },
    setSearchEngine: (engine: SearchEngines) => {
        setSettingAsync("searchEngine", engine)
    },

    getServiceConfigs: (): ServiceConfigs => {
        return getSetting<ServiceConfigs>("serviceConfigs", {
            type: SyncService.None,
        })
    },
    setServiceConfigs: (configs: ServiceConfigs) => {
        setSettingAsync("serviceConfigs", configs)
    },

    getFilterType: (): number => {
        return getSetting<number>("filterType", null)
    },
    setFilterType: (filterType: number) => {
        setSettingAsync("filterType", filterType)
    },

    getViewConfigs: (view: ViewType): ViewConfigs => {
        switch (view) {
            case ViewType.List:
                return getSetting<ViewConfigs>(
                    "listViewConfigs",
                    ViewConfigs.ShowCover
                )
            default:
                return undefined
        }
    },
    setViewConfigs: (view: ViewType, configs: ViewConfigs) => {
        switch (view) {
            case ViewType.List:
                setSettingAsync("listViewConfigs", configs)
                break
        }
    },

    getAllRules: (): StoredRules => {
        return getSetting<StoredRules>("sourceRules", {})
    },
    setRulesForTarget: async (
        target: RuleTarget,
        rules: StoredRule[]
    ): Promise<void> => {
        const targetKey = getRuleTargetKey(target)
        const updated = await tauriInvoke<StoredRules>("set_rules_for_target", {
            targetKey,
            rules,
        })
        runtimeState.settings.sourceRules = updated
        persistSettingsCache()
    },
    migrateLovefieldRules: async (
        sources: Record<string, unknown>[]
    ): Promise<void> => {
        const updated = await tauriInvoke<StoredRules>(
            "migrate_lovefield_rules",
            { sources }
        )
        runtimeState.settings.sourceRules = updated
        persistSettingsCache()
    },

    getDBVersion: (): string | null => {
        return getSetting<string | null>("dbVersion", "sqlite")
    },
    setDBVersion: (version: string): Promise<void> => {
        return setSettingAsync("dbVersion", version)
    },

    getUnreadSourcesOnly: (): boolean => {
        return getSetting<boolean>("menuUnreadSourcesOnly", false)
    },
    setUnreadSourcesOnly: (flag: boolean) => {
        setSettingAsync("menuUnreadSourcesOnly", flag)
    },
}

declare global {
    interface Window {
        settings: typeof settingsBridge
    }
    var settings: typeof settingsBridge
}

export default settingsBridge
