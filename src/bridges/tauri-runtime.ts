import { ThemeSettings, WindowStateListenerType } from "../schema-types"
import { version } from "../../package.json"

export interface FluentInitPayload {
    platform: string
    version: string
    systemLocale: string
    shouldUseDarkColors: boolean
    isMaximized: boolean
    isFullscreen: boolean
    isFocused: boolean
    settings: Record<string, any>
}

declare global {
    namespace NodeJS {
        type Timeout = ReturnType<typeof setTimeout>
    }
    var Buffer: {
        from(
            data: string,
            encoding?: string
        ): { toString(encoding?: string): string }
    }
    interface Window {
        __FLUENT_INIT__?: FluentInitPayload
        __TAURI__?: {
            core: {
                invoke: <T = any>(
                    cmd: string,
                    args?: Record<string, any>
                ) => Promise<T>
            }
            event: {
                listen: <T = any>(
                    event: string,
                    handler: (event: { payload: T }) => void
                ) => Promise<() => void>
            }
        }
        __TAURI_INTERNALS__?: {
            invoke: <T = any>(
                cmd: string,
                args?: Record<string, any>
            ) => Promise<T>
        }
    }
}

const SESSION_CACHE_KEY = "__fluent_settings_cache__"

function loadInitState(): FluentInitPayload {
    const base: FluentInitPayload = window.__FLUENT_INIT__ || {
        platform: navigator.userAgent.includes("Mac")
            ? "darwin"
            : navigator.userAgent.includes("Linux")
              ? "linux"
              : "win32",
        version,
        systemLocale: navigator.language || "en-US",
        shouldUseDarkColors:
            window.matchMedia?.("(prefers-color-scheme: dark)").matches ??
            false,
        isMaximized: false,
        isFullscreen: false,
        isFocused: true,
        settings: {},
    }
    try {
        const cached = sessionStorage.getItem(SESSION_CACHE_KEY)
        if (cached) {
            base.settings = { ...base.settings, ...JSON.parse(cached) }
        }
    } catch {
        // Ignore sessionStorage errors
    }
    return base
}

export const runtimeState: FluentInitPayload = loadInitState()

export function persistSettingsCache() {
    try {
        sessionStorage.setItem(
            SESSION_CACHE_KEY,
            JSON.stringify(runtimeState.settings)
        )
    } catch {
        // Ignore sessionStorage errors
    }
}

export function tauriInvoke<T = any>(
    cmd: string,
    args?: Record<string, any>
): Promise<T> {
    if (window.__TAURI__?.core?.invoke) {
        return window.__TAURI__.core.invoke<T>(cmd, args)
    }
    if (window.__TAURI_INTERNALS__?.invoke) {
        return window.__TAURI_INTERNALS__.invoke<T>(cmd, args)
    }
    return Promise.reject(new Error(`Tauri runtime not available for ${cmd}`))
}

export function tauriListen<T = any>(
    event: string,
    handler: (payload: T) => void
): Promise<() => void> {
    if (window.__TAURI__?.event?.listen) {
        return window.__TAURI__.event.listen<T>(event, e => handler(e.payload))
    }
    return Promise.resolve(() => {})
}

export const themeListeners = new Set<(shouldDark: boolean) => void>()
export const windowStateListeners = new Set<
    (type: WindowStateListenerType, state: boolean) => void
>()

const darkMediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)")

export function computeShouldUseDarkColors(): boolean {
    const theme =
        (runtimeState.settings.theme as ThemeSettings) ?? ThemeSettings.Default
    if (theme === ThemeSettings.Dark) return true
    if (theme === ThemeSettings.Light) return false
    return darkMediaQuery?.matches ?? runtimeState.shouldUseDarkColors
}

darkMediaQuery?.addEventListener?.("change", () => {
    const dark = computeShouldUseDarkColors()
    runtimeState.shouldUseDarkColors = dark
    themeListeners.forEach(cb => cb(dark))
})

tauriListen<boolean>("theme-updated", shouldDark => {
    const dark =
        (runtimeState.settings.theme as ThemeSettings) ===
            ThemeSettings.Default || !runtimeState.settings.theme
            ? shouldDark
            : computeShouldUseDarkColors()
    runtimeState.shouldUseDarkColors = dark
    themeListeners.forEach(cb => cb(dark))
})

tauriListen<{ maximized: boolean; fullscreen: boolean }>(
    "window-state",
    state => {
        if (runtimeState.isMaximized !== state.maximized) {
            runtimeState.isMaximized = state.maximized
            windowStateListeners.forEach(cb =>
                cb(WindowStateListenerType.Maximized, state.maximized)
            )
        }
        if (runtimeState.isFullscreen !== state.fullscreen) {
            runtimeState.isFullscreen = state.fullscreen
            windowStateListeners.forEach(cb =>
                cb(WindowStateListenerType.Fullscreen, state.fullscreen)
            )
        }
    }
)

tauriListen<boolean>("window-focus-state", focused => {
    runtimeState.isFocused = focused
    windowStateListeners.forEach(cb =>
        cb(WindowStateListenerType.Focused, focused)
    )
})
