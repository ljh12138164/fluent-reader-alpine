import {
    ImageCallbackTypes,
    TouchBarTexts,
    WindowStateListenerType,
} from "../schema-types"
import { IObjectWithKey } from "@fluentui/react"
import { fetch } from "./http"
import {
    runtimeState,
    tauriInvoke,
    windowStateListeners,
} from "./tauri-runtime"

export type FileFilter = {
    name: string
    extensions: string[]
}

export type WebviewInputEvent = {
    type: string
    key: string
    code: string
    shift: boolean
    alt: boolean
    control: boolean
    meta: boolean
    isAutoRepeat: boolean
}

let mainContextCallback: ((pos: [number, number], text: string) => any) | null =
    null
const webviewContextListeners = new Set<
    (pos?: [number, number], text?: string, url?: string) => any
>()
const webviewKeydownListeners = new Set<(event: WebviewInputEvent) => any>()
const webviewErrorListeners = new Set<(reason: string) => any>()
let lastContextImageSrc = ""

export function emitWebviewContextMenu(
    pos?: [number, number],
    text?: string,
    url?: string,
    imgSrc?: string
) {
    if (imgSrc) {
        lastContextImageSrc = imgSrc
    }
    webviewContextListeners.forEach(cb => cb(pos, text, url))
}

export function emitWebviewKeydown(input: WebviewInputEvent) {
    webviewKeydownListeners.forEach(cb => cb(input))
}

export function emitWebviewError(reason: string) {
    webviewErrorListeners.forEach(cb => cb(reason))
}

window.addEventListener("message", event => {
    const iframe = document.querySelector<HTMLIFrameElement>("#article")
    if (
        !iframe ||
        event.source !== iframe.contentWindow ||
        event.origin !== "null"
    )
        return
    const data = event.data
    if (!data || typeof data !== "object") return
    if (data.type === "fr-open-external" && typeof data.url === "string") {
        tauriInvoke("open_external", {
            url: data.url,
            background: Boolean(data.background),
        })
    } else if (data.type === "fr-webview-keydown" && data.input) {
        emitWebviewKeydown(data.input)
    } else if (data.type === "fr-webview-context-menu") {
        if (!data.pos) {
            emitWebviewContextMenu()
        } else {
            const rect = iframe.getBoundingClientRect()
            const pos: [number, number] = [
                Math.round(rect.left + data.pos[0]),
                Math.round(rect.top + data.pos[1]),
            ]
            if (data.imgSrc) {
                emitWebviewContextMenu(pos, undefined, undefined, data.imgSrc)
            } else {
                emitWebviewContextMenu(pos, data.text, data.url)
            }
        }
    }
})

window.addEventListener("contextmenu", e => {
    const selection = window.getSelection()?.toString() || ""
    if (selection && mainContextCallback) {
        e.preventDefault()
        mainContextCallback([e.clientX, e.clientY], selection)
    } else if (
        !(
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement
        )
    ) {
        e.preventDefault()
    }
})

const utilsBridge: UtilsBridge = {
    platform: runtimeState.platform,

    getVersion: () => {
        return runtimeState.version
    },

    openExternal: (url: string, background = false) => {
        tauriInvoke("open_external", { url, background })
    },

    showErrorBox: (title: string, content: string, copy?: string) => {
        return tauriInvoke("show_error_box", {
            title,
            content,
            copy: copy ?? null,
        })
    },

    showMessageBox: async (
        title: string,
        message: string,
        confirm: string,
        cancel: string,
        defaultCancel = false,
        type = "none"
    ) => {
        return await tauriInvoke<boolean>("show_message_box", {
            title,
            message,
            confirm,
            cancel,
            defaultCancel,
            dialogType: type,
        })
    },

    showSaveDialog: async (filters: FileFilter[], path: string) => {
        const result = await tauriInvoke<boolean>("show_save_dialog", {
            filters,
            defaultPath: path,
        })
        if (result) {
            return (resultContent: string, errmsg: string) => {
                tauriInvoke("write_save_result", {
                    result: resultContent,
                    errmsg,
                })
            }
        } else {
            return null
        }
    },

    showOpenDialog: async (filters: FileFilter[]) => {
        return await tauriInvoke<string | null>("show_open_dialog", { filters })
    },

    getCacheSize: async () => {
        return await tauriInvoke<number>("get_cache")
    },

    clearCache: async () => {
        await tauriInvoke("clear_cache")
    },

    addMainContextListener: (
        callback: (pos: [number, number], text: string) => any
    ) => {
        mainContextCallback = callback
    },

    addWebviewContextListener: (
        callback: (pos: [number, number], text: string, url: string) => any
    ) => {
        webviewContextListeners.add(callback)
        return () => {
            webviewContextListeners.delete(callback)
        }
    },

    imageCallback: (type: ImageCallbackTypes) => {
        if (!lastContextImageSrc) return
        switch (type) {
            case ImageCallbackTypes.OpenExternal:
            case ImageCallbackTypes.OpenExternalBg:
                tauriInvoke("open_external", {
                    url: lastContextImageSrc,
                    background: type === ImageCallbackTypes.OpenExternalBg,
                })
                break
            case ImageCallbackTypes.SaveAs:
                tauriInvoke("save_image_as", { url: lastContextImageSrc })
                break
            case ImageCallbackTypes.Copy: {
                const url = lastContextImageSrc
                const data = url.startsWith("data:")
                    ? Promise.resolve().then(() => {
                          const comma = url.indexOf(",")
                          const body = url.slice(comma + 1)
                          return url.slice(0, comma).endsWith(";base64")
                              ? Uint8Array.from(atob(body), c =>
                                    c.charCodeAt(0)
                                )
                              : Uint8Array.from(
                                    body.match(/%[0-9a-f]{2}|./gi) || [],
                                    c =>
                                        c.startsWith("%")
                                            ? parseInt(c.slice(1), 16)
                                            : c.charCodeAt(0)
                                )
                      })
                    : (url.startsWith("blob:")
                          ? window.fetch(url)
                          : fetch(url)
                      ).then(async response => {
                          if (!response.ok)
                              throw new Error(`HTTP ${response.status}`)
                          return new Uint8Array(await response.arrayBuffer())
                      })
                data.then(data =>
                    tauriInvoke("write_image_clipboard", {
                        data: Array.from(data),
                    })
                ).catch(err =>
                    utilsBridge.showErrorBox("Copy image", String(err))
                )
                break
            }
            case ImageCallbackTypes.CopyLink:
                tauriInvoke("write_clipboard", { text: lastContextImageSrc })
                break
        }
    },

    addWebviewKeydownListener: (
        callback: (event: WebviewInputEvent) => any
    ) => {
        webviewKeydownListeners.add(callback)
        return () => {
            webviewKeydownListeners.delete(callback)
        }
    },

    addWebviewErrorListener: (callback: (reason: string) => any) => {
        webviewErrorListeners.add(callback)
        return () => {
            webviewErrorListeners.delete(callback)
        }
    },

    writeClipboard: (text: string) => {
        tauriInvoke("write_clipboard", { text })
    },

    closeWindow: () => {
        tauriInvoke("close_window")
    },
    minimizeWindow: () => {
        tauriInvoke("minimize_window")
    },
    maximizeWindow: () => {
        tauriInvoke<boolean>("maximize_window").then(isMax => {
            runtimeState.isMaximized = isMax
        })
    },
    isMaximized: () => {
        return runtimeState.isMaximized
    },
    isFullscreen: () => {
        return runtimeState.isFullscreen
    },
    isFocused: () => {
        return runtimeState.isFocused
    },
    focus: () => {
        tauriInvoke("request_focus")
    },
    requestAttention: () => {
        tauriInvoke("request_attention")
    },
    addWindowStateListener: (
        callback: (type: WindowStateListenerType, state: boolean) => any
    ) => {
        windowStateListeners.add(callback)
    },

    addTouchBarEventsListener: (_callback: (e: IObjectWithKey) => any) => {},
    initTouchBar: (_texts: TouchBarTexts) => {},
    destroyTouchBar: () => {},

    initFontList: () => {
        return tauriInvoke<Array<string>>("init_font_list")
    },
}

interface UtilsBridge {
    platform: string
    getVersion(): string
    openExternal(url: string, background?: boolean): void
    showErrorBox(title: string, content: string, copy?: string): Promise<void>
    showMessageBox(
        title: string,
        message: string,
        confirm: string,
        cancel: string,
        defaultCancel?: boolean,
        type?: string
    ): Promise<boolean>
    showSaveDialog(
        filters: FileFilter[],
        path: string
    ): Promise<((resultContent: string, errmsg: string) => void) | null>
    showOpenDialog(filters: FileFilter[]): Promise<string | null>
    getCacheSize(): Promise<number>
    clearCache(): Promise<void>
    addMainContextListener(
        callback: (pos: [number, number], text: string) => any
    ): void
    addWebviewContextListener(
        callback: (pos: [number, number], text: string, url: string) => any
    ): () => void
    imageCallback(type: ImageCallbackTypes): void
    addWebviewKeydownListener(
        callback: (event: WebviewInputEvent) => any
    ): () => void
    addWebviewErrorListener(callback: (reason: string) => any): () => void
    writeClipboard(text: string): void
    closeWindow(): void
    minimizeWindow(): void
    maximizeWindow(): void
    isMaximized(): boolean
    isFullscreen(): boolean
    isFocused(): boolean
    focus(): void
    requestAttention(): void
    addWindowStateListener(
        callback: (type: WindowStateListenerType, state: boolean) => any
    ): void
    addTouchBarEventsListener(callback: (e: IObjectWithKey) => any): void
    initTouchBar(texts: TouchBarTexts): void
    destroyTouchBar(): void
    initFontList(): Promise<string[]>
}

declare global {
    interface Window {
        utils: UtilsBridge
        fontList: Array<string>
    }
    var utils: UtilsBridge
    var fontList: Array<string>
}

export default utilsBridge
