import {
    tauriInvoke,
    runtimeState,
    persistSettingsCache,
} from "./tauri-runtime"
import { getValidDate } from "../scripts/date"
import { StoredRules } from "../schema-types"

export type DatabaseQuery = {
    sql: string
    params: unknown[]
    method: "run" | "all" | "values" | "get"
}

export type DatabaseResult = unknown[] | undefined

export type RestoreDialogTexts = {
    title: string
    message: string
    confirm: string
    cancel: string
}

function transformLovefieldRules(
    sources: Record<string, unknown>[]
): StoredRules {
    const storedRules: StoredRules = {}
    for (const source of sources) {
        const rules = source.rules as Record<string, unknown>[] | undefined
        if (!Array.isArray(rules) || rules.length === 0) continue
        storedRules[`source:${source.sid as number}`] = rules.map(rule => {
            const filter = rule.filter as Record<string, unknown>
            const actions = rule.actions as Record<string, boolean>
            return {
                filter: (filter?.type as number) ?? 0,
                search: (filter?.search as string) ?? "",
                match: rule.match as boolean,
                actions: Object.entries(actions || {}).map(
                    ([type, flag]) => `${type}-${flag}`
                ),
            }
        })
    }
    return storedRules
}

const dbBridge = {
    execute: async (
        sql: string,
        params: unknown[],
        method: DatabaseQuery["method"]
    ): Promise<DatabaseResult> => {
        const res = await tauriInvoke<DatabaseResult>("db_execute", {
            sql,
            params,
            method,
        })
        return res ?? undefined
    },

    batch: async (queries: DatabaseQuery[]): Promise<DatabaseResult[]> => {
        const res = await tauriInvoke<DatabaseResult[]>("db_batch", {
            queries,
        })
        return res.map(r => r ?? undefined)
    },

    exportAll: (): Promise<void> => tauriInvoke("db_export_all"),

    importAll: async (texts: RestoreDialogTexts): Promise<boolean> => {
        const content = await tauriInvoke<string | null>("show_open_dialog", {
            filters: [
                {
                    name: "Fluent Reader Data",
                    extensions: ["frdata", "json"],
                },
            ],
        })
        if (!content) return true

        let configs: Record<string, unknown>
        try {
            configs = JSON.parse(content)
            if (
                !configs ||
                typeof configs !== "object" ||
                Array.isArray(configs)
            ) {
                throw new Error("Unrecognized backup format.")
            }
        } catch (err) {
            await tauriInvoke("show_error_box", {
                title: "Import Error",
                content: String(err),
                copy: null,
            })
            return true
        }

        const confirmed = await tauriInvoke<boolean>("show_message_box", {
            title: texts.title,
            message: texts.message,
            confirm: texts.confirm,
            cancel: texts.cancel,
            defaultCancel: true,
            dialogType: "warning",
        })
        if (!confirmed) return true

        const restoreDate = new Date()

        const backup = (configs.sqlite ?? configs.lovefield) as {
            sources?: Record<string, unknown>[]
            items?: Record<string, unknown>[]
        }
        if (!Array.isArray(backup?.sources) || !Array.isArray(backup.items)) {
            await tauriInvoke("show_error_box", {
                title: "Import Error",
                content: "Unrecognized backup format.",
                copy: null,
            })
            return true
        }
        try {
            const storedRules = configs.sqlite
                ? (configs.sourceRules as StoredRules) || {}
                : transformLovefieldRules(backup.sources)
            const queries: DatabaseQuery[] = [
                { sql: "DELETE FROM items", params: [], method: "run" },
                { sql: "DELETE FROM sources", params: [], method: "run" },
            ]
            for (const s of backup.sources) {
                const lastFetched = getValidDate(
                    s.lastFetched,
                    new Date(0)
                ).getTime()
                queries.push({
                    sql: "INSERT INTO sources (sid, url, iconurl, name, openTarget, lastFetched, serviceRef, fetchFrequency, textDir, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    params: [
                        s.sid as number,
                        s.url as string,
                        (s.iconurl as string) || null,
                        s.name as string,
                        (s.openTarget as number) || 0,
                        lastFetched,
                        (s.serviceRef as string) || null,
                        (s.fetchFrequency as number) || 0,
                        (s.textDir as number) || 0,
                        s.hidden ? 1 : 0,
                    ],
                    method: "run",
                })
            }
            for (const i of backup.items) {
                const fetchedDate = getValidDate(
                    i.fetchedDate,
                    i.date,
                    restoreDate
                )
                const date = getValidDate(i.date, fetchedDate)
                queries.push({
                    sql: "INSERT INTO items (_id, source, guid, title, link, date, fetchedDate, thumb, content, snippet, creator, hasRead, starred, hidden, notify, serviceRef) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    params: [
                        i._id as number,
                        i.source as number,
                        typeof i.guid === "string" && i.guid.trim()
                            ? i.guid
                            : null,
                        (i.title as string) || "",
                        (i.link as string) || "",
                        date.getTime(),
                        fetchedDate.getTime(),
                        (i.thumb as string) || null,
                        (i.content as string) || "",
                        (i.snippet as string) || "",
                        (i.creator as string) || null,
                        i.hasRead ? 1 : 0,
                        i.starred ? 1 : 0,
                        i.hidden ? 1 : 0,
                        i.notify ? 1 : 0,
                        (i.serviceRef as string) || null,
                    ],
                    method: "run",
                })
            }
            await dbBridge.batch(queries)

            const cleanConfigs: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(configs)) {
                if (["lovefield", "sqlite", "nedb", "useNeDB"].includes(k))
                    continue
                cleanConfigs[k] = v
            }
            const newSettings = await tauriInvoke<Record<string, any>>(
                "save_imported_settings",
                {
                    configs: cleanConfigs,
                    storedRules,
                }
            )
            runtimeState.settings = newSettings
            persistSettingsCache()
            window.location.reload()
            return false
        } catch (err) {
            await tauriInvoke("show_error_box", {
                title: "Import Error",
                content: String(err),
                copy: null,
            })
            return true
        }
    },
}

declare global {
    interface Window {
        db: typeof dbBridge
    }
}

export default dbBridge
