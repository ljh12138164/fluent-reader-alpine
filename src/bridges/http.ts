import { fetch as nativeFetch } from "@tauri-apps/plugin-http"
import { tauriInvoke } from "./tauri-runtime"

let cachedPac: { url: string; expires: number; script: Promise<string> }

export async function fetch(
    url: string,
    options?: RequestInit
): Promise<Response> {
    const address =
        window.settings.getProxyStatus() && window.settings.getProxy()
    if (!address) return nativeFetch(url, options)

    options?.signal?.throwIfAborted()
    if (cachedPac?.url !== address || cachedPac.expires <= Date.now()) {
        const script = nativeFetch(address, { connectTimeout: 10000 }).then(
            response => {
                if (!response.ok) throw new Error(`PAC HTTP ${response.status}`)
                return response.text()
            }
        )
        cachedPac = { url: address, expires: Date.now() + 60000, script }
        void script.catch(() => {
            if (cachedPac.script === script) cachedPac.expires = 0
        })
    }

    const script = await cachedPac.script
    const routes = await tauriInvoke<(string | null)[]>("resolve_pac", {
        script,
        url,
    })
    const method = (options?.method ?? "GET").toUpperCase()
    for (const [index, proxy] of routes.entries()) {
        try {
            return await nativeFetch(url, {
                ...options,
                connectTimeout: 10000,
                proxy: proxy ? { all: proxy } : undefined,
            })
        } catch (err) {
            // The HTTP plugin reports a send error as a string. Retrying a
            // write could repeat a request the server already received.
            if (
                index === routes.length - 1 ||
                (method !== "GET" && method !== "HEAD") ||
                options?.signal?.aborted ||
                typeof err !== "string" ||
                !err.startsWith("error sending request")
            ) {
                throw err
            }
        }
    }
    throw new Error("PAC returned no route")
}
