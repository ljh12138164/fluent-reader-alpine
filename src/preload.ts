import settingsBridge from "./bridges/settings"
import utilsBridge from "./bridges/utils"
import dbBridge from "./bridges/db"

window.settings = settingsBridge
window.utils = utilsBridge
window.db = dbBridge
globalThis.settings = settingsBridge
globalThis.utils = utilsBridge
globalThis.db = dbBridge
