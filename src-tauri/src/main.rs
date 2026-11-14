#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use regex::{Regex, RegexBuilder};
use rusqlite::{functions::FunctionFlags, params_from_iter, types::ValueRef, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{
    Emitter, Manager, Theme, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

thread_local! {
    static REGEX_CACHE: RefCell<HashMap<(String, bool), Option<Regex>>> = RefCell::new(HashMap::new());
}

fn eval_regex(pattern: &str, value: &str, case_insensitive: bool) -> i64 {
    REGEX_CACHE.with(|cache| {
        let mut map = cache.borrow_mut();
        if map.len() > 256 {
            map.clear();
        }
        let key = (pattern.to_string(), case_insensitive);
        let compiled = map.entry(key).or_insert_with(|| {
            RegexBuilder::new(pattern)
                .case_insensitive(case_insensitive)
                .build()
                .ok()
        });
        match compiled {
            Some(re) => i64::from(re.is_match(value)),
            None => 0,
        }
    })
}

pub struct AppState {
    pub db: Mutex<Connection>,
    pub settings: Mutex<Map<String, Value>>,
    pub config_path: PathBuf,
    pub data_dir: PathBuf,
    pub pending_save_path: Mutex<Option<PathBuf>>,
    pub clipboard: Mutex<Option<arboard::Clipboard>>,
}

#[derive(Deserialize)]
pub struct DatabaseQuery {
    pub sql: String,
    pub params: Vec<Value>,
    pub method: String,
}

#[derive(Deserialize)]
pub struct RestoreDialogTexts {
    pub title: String,
    pub message: String,
    pub confirm: String,
    pub cancel: String,
}

#[derive(Deserialize)]
pub struct DialogFileFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

fn save_settings_to_disk(config_path: &Path, map: &Map<String, Value>) {
    if let Ok(text) = serde_json::to_string_pretty(&Value::Object(map.clone())) {
        let _ = fs::write(config_path, text);
    }
}

fn next_group_id_from_map(map: &Map<String, Value>) -> i64 {
    let mut max_next = map.get("nextGroupId").and_then(|v| v.as_i64()).unwrap_or(0);
    if let Some(groups) = map.get("sourceGroups").and_then(|v| v.as_array()) {
        for g in groups {
            if let Some(gid) = g.get("gid").and_then(|v| v.as_i64()) {
                if gid >= 0 && gid + 1 > max_next {
                    max_next = gid + 1;
                }
            }
        }
    }
    if let Some(rules) = map.get("sourceRules").and_then(|v| v.as_object()) {
        for key in rules.keys() {
            if let Some(rest) = key.strip_prefix("group:") {
                if let Ok(gid) = rest.parse::<i64>() {
                    if gid >= 0 && gid + 1 > max_next {
                        max_next = gid + 1;
                    }
                }
            }
        }
    }
    max_next
}

fn sanitize_groups_in_map(map: &mut Map<String, Value>) -> bool {
    let mut changed = false;
    let next_id = next_group_id_from_map(map);
    let current_next = map.get("nextGroupId").and_then(|v| v.as_i64()).unwrap_or(0);
    if current_next < next_id {
        map.insert("nextGroupId".to_string(), json!(next_id));
        changed = true;
    }
    let mut next_alloc = next_id.max(current_next);
    if let Some(Value::Array(groups)) = map.get_mut("sourceGroups") {
        let mut seen = BTreeSet::new();
        for group in groups.iter_mut() {
            if let Value::Object(obj) = group {
                let valid_gid = obj
                    .get("gid")
                    .and_then(|v| v.as_i64())
                    .filter(|&id| id >= 0 && !seen.contains(&id));
                let gid = match valid_gid {
                    Some(id) => id,
                    None => {
                        let id = next_alloc;
                        next_alloc += 1;
                        obj.insert("gid".to_string(), json!(id));
                        changed = true;
                        id
                    }
                };
                if obj.remove("index").is_some() {
                    changed = true;
                }
                seen.insert(gid);
            }
        }
    }
    if next_alloc > current_next.max(next_id) {
        map.insert("nextGroupId".to_string(), json!(next_alloc));
        changed = true;
    }
    changed
}

fn init_sqlite(db_path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let _ = conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA temp_store = MEMORY;
         PRAGMA cache_size = -16000;",
    );

    conn.create_scalar_function(
        "regexp",
        2,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            let pattern = ctx.get_raw(0).as_str().unwrap_or("");
            let value = ctx.get_raw(1).as_str().unwrap_or("");
            Ok(eval_regex(pattern, value, false))
        },
    )
    .map_err(|e| e.to_string())?;

    conn.create_scalar_function(
        "regexpi",
        2,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            let pattern = ctx.get_raw(0).as_str().unwrap_or("");
            let value = ctx.get_raw(1).as_str().unwrap_or("");
            Ok(eval_regex(pattern, value, true))
        },
    )
    .map_err(|e| e.to_string())?;

    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS `items` (
            `_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
            `source` integer NOT NULL,
            `guid` text,
            `title` text NOT NULL,
            `link` text NOT NULL,
            `date` integer NOT NULL,
            `fetchedDate` integer NOT NULL,
            `thumb` text,
            `content` text NOT NULL,
            `snippet` text NOT NULL,
            `creator` text,
            `hasRead` integer DEFAULT false NOT NULL,
            `starred` integer DEFAULT false NOT NULL,
            `hidden` integer DEFAULT false NOT NULL,
            `notify` integer DEFAULT false NOT NULL,
            `serviceRef` text
        );
        CREATE TABLE IF NOT EXISTS `sources` (
            `sid` integer PRIMARY KEY NOT NULL,
            `url` text NOT NULL,
            `iconurl` text,
            `name` text NOT NULL,
            `openTarget` integer DEFAULT 0 NOT NULL,
            `lastFetched` integer NOT NULL,
            `serviceRef` text,
            `fetchFrequency` integer DEFAULT 0 NOT NULL,
            `textDir` integer DEFAULT 0 NOT NULL,
            `hidden` integer DEFAULT false NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS `sources_url_unique` ON `sources` (`url`);
        CREATE INDEX IF NOT EXISTS `items_source_date` ON `items` (`source`,"date" desc,"_id" desc);
        CREATE INDEX IF NOT EXISTS `items_date` ON `items` ("date" desc,"_id" desc);
        CREATE INDEX IF NOT EXISTS `items_source_guid` ON `items` (`source`,`guid`) WHERE "items"."guid" IS NOT NULL;
        CREATE INDEX IF NOT EXISTS `items_local_identity` ON `items` (`source`,`title`,`link`,`date`) WHERE "items"."serviceRef" IS NULL;
        CREATE INDEX IF NOT EXISTS `items_service_state` ON `items` (`serviceRef`,`hasRead`,`starred`) WHERE "items"."serviceRef" IS NOT NULL;
        CREATE INDEX IF NOT EXISTS `items_unread_date` ON `items` (`hasRead`,"date" desc,"_id" desc,`source`) WHERE "items"."hasRead" = 0;
        CREATE INDEX IF NOT EXISTS `items_starred_date` ON `items` (`starred`,"date" desc,"_id" desc) WHERE "items"."starred" = 1;
        "#,
    )
    .map_err(|e| e.to_string())?;

    let _ = conn.execute_batch("PRAGMA optimize = 0x10002;");
    Ok(conn)
}

fn json_to_sql_value(v: &Value) -> rusqlite::types::Value {
    match v {
        Value::Null => rusqlite::types::Value::Null,
        Value::Bool(b) => rusqlite::types::Value::Integer(if *b { 1 } else { 0 }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                rusqlite::types::Value::Integer(i)
            } else if let Some(u) = n.as_u64() {
                rusqlite::types::Value::Integer(u as i64)
            } else if let Some(f) = n.as_f64() {
                rusqlite::types::Value::Real(f)
            } else {
                rusqlite::types::Value::Null
            }
        }
        Value::String(s) => rusqlite::types::Value::Text(s.clone()),
        other => rusqlite::types::Value::Text(other.to_string()),
    }
}

fn row_to_json_array(row: &rusqlite::Row, col_count: usize) -> Vec<Value> {
    let mut arr = Vec::with_capacity(col_count);
    for i in 0..col_count {
        let val = match row.get_ref(i) {
            Ok(ValueRef::Null) => Value::Null,
            Ok(ValueRef::Integer(int_val)) => json!(int_val),
            Ok(ValueRef::Real(float_val)) => json!(float_val),
            Ok(ValueRef::Text(bytes)) => Value::String(String::from_utf8_lossy(bytes).into_owned()),
            Ok(ValueRef::Blob(bytes)) => Value::Array(bytes.iter().map(|&b| json!(b)).collect()),
            Err(_) => Value::Null,
        };
        arr.push(val);
    }
    arr
}

fn execute_single_query(conn: &Connection, query: &DatabaseQuery) -> Result<Value, String> {
    let mut stmt = conn.prepare_cached(&query.sql).map_err(|e| e.to_string())?;
    let sql_params: Vec<rusqlite::types::Value> =
        query.params.iter().map(json_to_sql_value).collect();

    if query.method == "run" {
        let changes = stmt
            .execute(params_from_iter(sql_params.iter()))
            .map_err(|e| e.to_string())?;
        let last_id = conn.last_insert_rowid();
        return Ok(json!([changes, last_id]));
    }

    let col_count = stmt.column_count();
    let mut rows = stmt
        .query(params_from_iter(sql_params.iter()))
        .map_err(|e| e.to_string())?;

    if query.method == "get" {
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            return Ok(Value::Array(row_to_json_array(row, col_count)));
        }
        return Ok(Value::Null);
    }

    let mut all_rows = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        all_rows.push(Value::Array(row_to_json_array(row, col_count)));
    }
    Ok(Value::Array(all_rows))
}

#[tauri::command]
fn db_execute(
    state: tauri::State<'_, AppState>,
    sql: String,
    params: Vec<Value>,
    method: String,
) -> Result<Value, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    execute_single_query(
        &conn,
        &DatabaseQuery {
            sql,
            params,
            method,
        },
    )
}

#[tauri::command]
fn db_batch(
    state: tauri::State<'_, AppState>,
    queries: Vec<DatabaseQuery>,
) -> Result<Vec<Value>, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut results = Vec::with_capacity(queries.len());
    for q in &queries {
        results.push(execute_single_query(&tx, q)?);
    }
    tx.commit().map_err(|e| e.to_string())?;
    let _ = conn.execute_batch("PRAGMA optimize;");
    Ok(results)
}

fn parse_valid_timestamp_ms(val: Option<&Value>, fallback_ms: i64) -> i64 {
    match val {
        Some(Value::Number(n)) => {
            if let Some(i) = n.as_i64() {
                return i;
            }
            if let Some(f) = n.as_f64() {
                if f.is_finite() {
                    return f as i64;
                }
            }
            fallback_ms
        }
        Some(Value::String(s)) => {
            if let Ok(n) = s.parse::<i64>() {
                return n;
            }
            fallback_ms
        }
        _ => fallback_ms,
    }
}

fn transform_lovefield_rules(sources: &[Value]) -> Value {
    let mut stored_rules = Map::new();
    for source in sources {
        let Some(sid) = source.get("sid").and_then(|v| v.as_i64()) else {
            continue;
        };
        let Some(rules) = source.get("rules").and_then(|v| v.as_array()) else {
            continue;
        };
        if rules.is_empty() {
            continue;
        }
        let mapped: Vec<Value> = rules
            .iter()
            .map(|rule| {
                let filter_type = rule
                    .get("filter")
                    .and_then(|f| f.get("type"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let search = rule
                    .get("filter")
                    .and_then(|f| f.get("search"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let m = rule.get("match").and_then(|v| v.as_bool()).unwrap_or(false);
                let mut actions_vec = Vec::new();
                if let Some(actions_obj) = rule.get("actions").and_then(|v| v.as_object()) {
                    for (k, flag) in actions_obj {
                        let b = flag.as_bool().unwrap_or(false);
                        actions_vec.push(Value::String(format!("{}-{}", k, b)));
                    }
                }
                json!({
                    "filter": filter_type,
                    "search": search,
                    "match": m,
                    "actions": actions_vec,
                })
            })
            .collect();
        stored_rules.insert(format!("source:{}", sid), Value::Array(mapped));
    }
    Value::Object(stored_rules)
}

#[tauri::command]
async fn db_export_all(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let file = rfd::FileDialog::new()
        .set_file_name("Fluent_Reader_Backup.frdata")
        .add_filter("Fluent Reader Data", &["frdata"])
        .save_file();
    let Some(file_path) = file else {
        return Ok(());
    };

    let output_Result: Result<Value, String> = (|| {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut sources = Vec::new();
        {
            let mut stmt = conn
                .prepare("SELECT sid, url, iconurl, name, openTarget, lastFetched, serviceRef, fetchFrequency, textDir, hidden FROM sources")
                .map_err(|e| e.to_string())?;
            let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
            while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                sources.push(json!({
                    "sid": row.get::<_, i64>(0).unwrap_or(0),
                    "url": row.get::<_, String>(1).unwrap_or_default(),
                    "iconurl": row.get::<_, Option<String>>(2).unwrap_or(None),
                    "name": row.get::<_, String>(3).unwrap_or_default(),
                    "openTarget": row.get::<_, i64>(4).unwrap_or(0),
                    "lastFetched": row.get::<_, i64>(5).unwrap_or(0),
                    "serviceRef": row.get::<_, Option<String>>(6).unwrap_or(None),
                    "fetchFrequency": row.get::<_, i64>(7).unwrap_or(0),
                    "textDir": row.get::<_, i64>(8).unwrap_or(0),
                    "hidden": row.get::<_, i64>(9).unwrap_or(0) != 0,
                }));
            }
        }
        let mut items = Vec::new();
        {
            let mut stmt = conn
                .prepare("SELECT _id, source, guid, title, link, date, fetchedDate, thumb, content, snippet, creator, hasRead, starred, hidden, notify, serviceRef FROM items")
                .map_err(|e| e.to_string())?;
            let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
            while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                items.push(json!({
                    "_id": row.get::<_, i64>(0).unwrap_or(0),
                    "source": row.get::<_, i64>(1).unwrap_or(0),
                    "guid": row.get::<_, Option<String>>(2).unwrap_or(None),
                    "title": row.get::<_, String>(3).unwrap_or_default(),
                    "link": row.get::<_, String>(4).unwrap_or_default(),
                    "date": row.get::<_, i64>(5).unwrap_or(0),
                    "fetchedDate": row.get::<_, i64>(6).unwrap_or(0),
                    "thumb": row.get::<_, Option<String>>(7).unwrap_or(None),
                    "content": row.get::<_, String>(8).unwrap_or_default(),
                    "snippet": row.get::<_, String>(9).unwrap_or_default(),
                    "creator": row.get::<_, Option<String>>(10).unwrap_or(None),
                    "hasRead": row.get::<_, i64>(11).unwrap_or(0) != 0,
                    "starred": row.get::<_, i64>(12).unwrap_or(0) != 0,
                    "hidden": row.get::<_, i64>(13).unwrap_or(0) != 0,
                    "notify": row.get::<_, i64>(14).unwrap_or(0) != 0,
                    "serviceRef": row.get::<_, Option<String>>(15).unwrap_or(None),
                }));
            }
        }
        let mut out = state.settings.lock().map_err(|e| e.to_string())?.clone();
        out.insert(
            "sqlite".to_string(),
            json!({
                "sources": sources,
                "items": items,
            }),
        );
        Ok(Value::Object(out))
    })();

    match output_Result {
        Ok(val) => {
            if let Err(err) = fs::write(&file_path, serde_json::to_string(&val).unwrap_or_default())
            {
                rfd::MessageDialog::new()
                    .set_level(rfd::MessageLevel::Error)
                    .set_title("Export Error")
                    .set_description(err.to_string())
                    .show();
            }
        }
        Err(err) => {
            rfd::MessageDialog::new()
                .set_level(rfd::MessageLevel::Error)
                .set_title("Export Error")
                .set_description(err)
                .show();
        }
    }
    Ok(())
}

#[tauri::command]
fn save_imported_settings(
    state: tauri::State<'_, AppState>,
    window: WebviewWindow,
    configs: Map<String, Value>,
    stored_rules: Value,
) -> Result<Value, String> {
    let mut map = state.settings.lock().map_err(|e| e.to_string())?;
    map.clear();
    for (k, v) in configs {
        if matches!(k.as_str(), "lovefield" | "sqlite" | "nedb" | "useNeDB") {
            continue;
        }
        map.insert(k, v);
    }
    map.insert("dbVersion".to_string(), json!("sqlite"));
    map.insert("sourceRules".to_string(), stored_rules);
    map.insert("version".to_string(), json!(env!("CARGO_PKG_VERSION")));
    sanitize_groups_in_map(&mut map);
    save_settings_to_disk(&state.config_path, &map);

    let theme = map
        .get("theme")
        .and_then(|v| v.as_str())
        .unwrap_or("system")
        .to_owned();
    let settings = map.clone();
    // Applying a theme can call the window handler, which reads settings.
    drop(map);
    apply_window_theme(&window, &theme);

    Ok(Value::Object(settings))
}

#[tauri::command]
fn allocate_group_id(state: tauri::State<'_, AppState>) -> Result<i64, String> {
    let mut map = state.settings.lock().map_err(|e| e.to_string())?;
    let gid = next_group_id_from_map(&map);
    map.insert("nextGroupId".to_string(), json!(gid + 1));
    save_settings_to_disk(&state.config_path, &map);
    Ok(gid)
}

#[tauri::command]
fn set_setting(state: tauri::State<'_, AppState>, key: String, value: Value) -> Result<(), String> {
    let mut map = state.settings.lock().map_err(|e| e.to_string())?;
    if value.is_null() {
        map.remove(&key);
    } else {
        map.insert(key, value);
    }
    save_settings_to_disk(&state.config_path, &map);
    Ok(())
}

#[tauri::command]
fn set_rules_for_target(
    state: tauri::State<'_, AppState>,
    target_key: String,
    rules: Vec<Value>,
) -> Result<Value, String> {
    let mut map = state.settings.lock().map_err(|e| e.to_string())?;
    let mut all_rules = map
        .get("sourceRules")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    if !rules.is_empty() {
        all_rules.insert(target_key, Value::Array(rules));
    } else {
        all_rules.remove(&target_key);
    }
    let rules_val = Value::Object(all_rules);
    map.insert("sourceRules".to_string(), rules_val.clone());
    save_settings_to_disk(&state.config_path, &map);
    Ok(rules_val)
}

#[tauri::command]
fn migrate_lovefield_rules(
    state: tauri::State<'_, AppState>,
    sources: Vec<Value>,
) -> Result<Value, String> {
    let mut map = state.settings.lock().map_err(|e| e.to_string())?;
    let rules_val = transform_lovefield_rules(&sources);
    map.insert("sourceRules".to_string(), rules_val.clone());
    save_settings_to_disk(&state.config_path, &map);
    Ok(rules_val)
}

fn apply_window_theme(window: &WebviewWindow, theme_setting: &str) -> bool {
    let theme_opt = match theme_setting {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        _ => None,
    };
    let _ = window.set_theme(theme_opt);
    let is_dark = match theme_opt {
        Some(Theme::Dark) => true,
        Some(Theme::Light) => false,
        _ => matches!(window.theme(), Ok(Theme::Dark)),
    };
    let _ = window.emit("theme-updated", is_dark);
    is_dark
}

#[tauri::command]
async fn resolve_pac(script: String, url: String) -> Result<Vec<Option<String>>, String> {
    use proxy_watch::pac::{evaluate, PacPolicy, PacScript};

    let url = proxy_watch::Url::parse(&url).map_err(|err| err.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let policy = PacPolicy::new()
            .with_dns_resolution(true)
            .with_internal_addresses(true);
        let routes =
            evaluate(&PacScript::new(script), &url, &policy).map_err(|err| err.to_string())?;
        if routes.is_empty() {
            return Err("PAC returned no route".to_string());
        }
        routes
            .into_iter()
            .map(|route| {
                if route.is_direct() {
                    return Ok(None);
                }
                route
                    .to_url()
                    .map(|url| Some(url.to_string()))
                    .ok_or_else(|| "Invalid PAC proxy URL".to_string())
            })
            .collect()
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
fn set_theme(
    state: tauri::State<'_, AppState>,
    window: WebviewWindow,
    theme: String,
) -> Result<bool, String> {
    let mut map = state.settings.lock().map_err(|e| e.to_string())?;
    map.insert("theme".to_string(), Value::String(theme.clone()));
    save_settings_to_disk(&state.config_path, &map);
    // On Windows, setting the native theme can synchronously fire ThemeChanged,
    // whose handler also reads settings.
    drop(map);
    Ok(apply_window_theme(&window, &theme))
}

#[tauri::command]
fn open_external(window: WebviewWindow, url: String, background: bool) -> Result<(), String> {
    if url.starts_with("https://") || url.starts_with("http://") {
        if background && cfg!(target_os = "windows") {
            let _ = window.set_always_on_top(true);
            let _ = open::that_detached(&url);
            let win_clone = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(800));
                let _ = win_clone.set_always_on_top(false);
            });
        } else {
            let _ = open::that_detached(&url);
        }
    }
    Ok(())
}

#[tauri::command]
async fn show_error_box(
    title: String,
    content: String,
    copy: Option<String>,
) -> Result<(), String> {
    if copy.is_some() {
        let res = rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Error)
            .set_title(&title)
            .set_description(&content)
            .set_buttons(rfd::MessageButtons::OkCancelCustom(
                "OK".to_string(),
                copy.unwrap_or_else(|| "Copy".to_string()),
            ))
            .show();
        if matches!(res, rfd::MessageDialogResult::Custom(_))
            || matches!(res, rfd::MessageDialogResult::Cancel)
        {
            if let Ok(mut cb) = arboard::Clipboard::new() {
                let _ = cb.set_text(format!("{}: {}", title, content));
            }
        }
    } else {
        rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Error)
            .set_title(&title)
            .set_description(&content)
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
    }
    Ok(())
}

#[tauri::command]
async fn show_message_box(
    title: String,
    message: String,
    confirm: String,
    cancel: String,
    _default_cancel: bool,
    dialog_type: String,
) -> Result<bool, String> {
    let level = match dialog_type.as_str() {
        "warning" => rfd::MessageLevel::Warning,
        "error" => rfd::MessageLevel::Error,
        _ => rfd::MessageLevel::Info,
    };
    let buttons = if cfg!(target_os = "windows") {
        rfd::MessageButtons::YesNo
    } else {
        rfd::MessageButtons::OkCancelCustom(confirm.clone(), cancel)
    };
    let res = rfd::MessageDialog::new()
        .set_level(level)
        .set_title(&title)
        .set_description(&message)
        .set_buttons(buttons)
        .show();
    Ok(matches!(
        res,
        rfd::MessageDialogResult::Yes | rfd::MessageDialogResult::Ok
    ) || matches!(res, rfd::MessageDialogResult::Custom(ref s) if s == &confirm))
}

#[tauri::command]
async fn show_save_dialog(
    state: tauri::State<'_, AppState>,
    filters: Vec<DialogFileFilter>,
    default_path: String,
) -> Result<bool, String> {
    let mut dialog = rfd::FileDialog::new().set_file_name(&default_path);
    for f in &filters {
        let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
        dialog = dialog.add_filter(&f.name, &exts);
    }
    if let Some(path) = dialog.save_file() {
        *state.pending_save_path.lock().map_err(|e| e.to_string())? = Some(path);
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
fn write_save_result(
    state: tauri::State<'_, AppState>,
    result: String,
    errmsg: String,
) -> Result<(), String> {
    let path_opt = state
        .pending_save_path
        .lock()
        .map_err(|e| e.to_string())?
        .take();
    if let Some(path) = path_opt {
        if let Err(err) = fs::write(path, result) {
            rfd::MessageDialog::new()
                .set_level(rfd::MessageLevel::Error)
                .set_title(&errmsg)
                .set_description(err.to_string())
                .show();
        }
    }
    Ok(())
}

#[tauri::command]
async fn show_open_dialog(filters: Vec<DialogFileFilter>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new();
    for f in &filters {
        let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
        dialog = dialog.add_filter(&f.name, &exts);
    }
    if let Some(path) = dialog.pick_file() {
        match fs::read_to_string(path) {
            Ok(content) => Ok(Some(content)),
            Err(_) => Ok(None),
        }
    } else {
        Ok(None)
    }
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if let Ok(meta) = entry.metadata() {
                if meta.is_dir() {
                    total += dir_size(&p);
                } else {
                    total += meta.len();
                }
            }
        }
    }
    total
}

#[tauri::command]
fn get_cache(state: tauri::State<'_, AppState>) -> Result<u64, String> {
    let eb_webview = state
        .data_dir
        .join("EBWebView")
        .join("Default")
        .join("Cache");
    if eb_webview.exists() {
        return Ok(dir_size(&eb_webview));
    }
    Ok(0)
}

#[tauri::command]
fn clear_cache(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let eb_webview = state
        .data_dir
        .join("EBWebView")
        .join("Default")
        .join("Cache");
    if eb_webview.exists() {
        let _ = fs::remove_dir_all(&eb_webview);
    }
    Ok(())
}

#[tauri::command]
fn write_clipboard(state: tauri::State<'_, AppState>, text: String) -> Result<(), String> {
    let mut clipboard = state.clipboard.lock().map_err(|err| err.to_string())?;
    if clipboard.is_none() {
        *clipboard = Some(arboard::Clipboard::new().map_err(|err| err.to_string())?);
    }
    clipboard
        .as_mut()
        .unwrap()
        .set_text(text)
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn write_image_clipboard(state: tauri::State<'_, AppState>, data: Vec<u8>) -> Result<(), String> {
    let image = image::ImageReader::new(std::io::Cursor::new(data))
        .with_guessed_format()
        .map_err(|err| err.to_string())?
        .decode()
        .map_err(|err| err.to_string())?
        .into_rgba8();
    let mut clipboard = state.clipboard.lock().map_err(|err| err.to_string())?;
    if clipboard.is_none() {
        *clipboard = Some(arboard::Clipboard::new().map_err(|err| err.to_string())?);
    }
    clipboard
        .as_mut()
        .unwrap()
        .set_image(arboard::ImageData {
            width: image.width() as usize,
            height: image.height() as usize,
            bytes: std::borrow::Cow::Owned(image.into_raw()),
        })
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn save_image_as(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Ok(());
    }
    let default_name = url
        .split('/')
        .last()
        .and_then(|s| s.split('?').next())
        .filter(|s| !s.is_empty() && s.contains('.'))
        .unwrap_or("image.png")
        .to_string();
    let Some(path) = rfd::FileDialog::new()
        .set_file_name(&default_name)
        .save_file()
    else {
        return Ok(());
    };
    if let Ok(resp) = reqwest::get(&url).await {
        if let Ok(bytes) = resp.bytes().await {
            let _ = fs::write(path, bytes);
        }
    }
    Ok(())
}

#[tauri::command]
fn close_window(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn minimize_window(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn maximize_window(window: WebviewWindow) -> Result<bool, String> {
    let is_max = window.is_maximized().unwrap_or(false);
    if is_max {
        window.unmaximize().map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        window.maximize().map_err(|e| e.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
fn request_focus(window: WebviewWindow) -> Result<(), String> {
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    if cfg!(target_os = "windows") {
        let _ = window.set_always_on_top(true);
        let _ = window.set_always_on_top(false);
    }
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
fn request_attention(window: WebviewWindow) -> Result<(), String> {
    if !window.is_focused().unwrap_or(true) {
        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
    }
    Ok(())
}

#[tauri::command]
fn init_font_list() -> Result<Vec<String>, String> {
    let mut fonts = BTreeSet::new();
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
            if let Ok(key) = RegKey::predef(hive)
                .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts")
            {
                for (name, _) in key.enum_values().flatten() {
                    let clean = name
                        .split(" (")
                        .next()
                        .unwrap_or(&name)
                        .split(" & ")
                        .next()
                        .unwrap_or(&name)
                        .trim();
                    if !clean.is_empty() && !clean.starts_with('@') {
                        fonts.insert(clean.to_string());
                    }
                }
            }
        }
    }
    Ok(fonts.into_iter().collect())
}

fn get_platform_str() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "win32"
    } else {
        "linux"
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let _ = fs::create_dir_all(&data_dir);

            let config_path = data_dir.join("config.json");
            let db_path = data_dir.join("fluent-reader.db");

            // First-run seamless migration from Electron Fluent Reader data directory if present
            if !config_path.exists() && !db_path.exists() {
                if let Some(roaming) = data_dir.parent() {
                    let legacy_dir = roaming.join("fluent-reader");
                    let legacy_config = legacy_dir.join("config.json");
                    let legacy_db = legacy_dir.join("fluent-reader.db");
                    if legacy_config.exists() {
                        let _ = fs::copy(&legacy_config, &config_path);
                    }
                    if legacy_db.exists() {
                        let _ = fs::copy(&legacy_db, &db_path);
                    }
                }
            }

            let mut settings_map: Map<String, Value> = fs::read_to_string(&config_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();

            let mut modified = false;
            if settings_map.get("version").and_then(|v| v.as_str()) != Some(env!("CARGO_PKG_VERSION")) {
                settings_map.insert("version".to_string(), json!(env!("CARGO_PKG_VERSION")));
                modified = true;
            }
            if !settings_map.contains_key("dbVersion") {
                settings_map.insert("dbVersion".to_string(), json!("sqlite"));
                modified = true;
            }
            if sanitize_groups_in_map(&mut settings_map) {
                modified = true;
            }
            if modified {
                save_settings_to_disk(&config_path, &settings_map);
            }

            let conn = init_sqlite(&db_path).expect("Failed to initialize SQLite database");

            let theme_setting = settings_map
                .get("theme")
                .and_then(|v| v.as_str())
                .unwrap_or("system")
                .to_string();

            let win_bounds = settings_map
                .get("windowBounds")
                .and_then(|v| v.as_object());
            let width = win_bounds
                .and_then(|b| b.get("width"))
                .and_then(|v| v.as_f64())
                .unwrap_or(1200.0)
                .max(992.0);
            let height = win_bounds
                .and_then(|b| b.get("height"))
                .and_then(|v| v.as_f64())
                .unwrap_or(700.0)
                .max(600.0);
            let was_maximized = win_bounds
                .and_then(|b| b.get("maximized"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let sys_locale = sys_locale::get_locale().unwrap_or_else(|| "en-US".to_string());
            let is_dark_initial = match theme_setting.as_str() {
                "dark" => true,
                "light" => false,
                _ => false,
            };

            let init_payload = json!({
                "platform": get_platform_str(),
                "version": env!("CARGO_PKG_VERSION"),
                "systemLocale": sys_locale,
                "shouldUseDarkColors": is_dark_initial,
                "isMaximized": was_maximized,
                "isFullscreen": false,
                "isFocused": true,
                "settings": settings_map,
            });

            let init_script = format!(
                "window.__FLUENT_INIT__ = {};",
                serde_json::to_string(&init_payload).unwrap_or_else(|_| "{}".to_string())
            );

            app.manage(AppState {
                db: Mutex::new(conn),
                settings: Mutex::new(settings_map),
                config_path: config_path.clone(),
                data_dir,
                pending_save_path: Mutex::new(None),
                clipboard: Mutex::new(None),
            });

            let mut win_builder =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("Fluent Reader Alpine")
                    .inner_size(width, height)
                    .min_inner_size(992.0, 600.0)
                    .decorations(cfg!(target_os = "macos"))
                    .maximized(was_maximized)
                    .initialization_script(&init_script);

            #[cfg(target_os = "windows")]
            {
                win_builder = win_builder.additional_browser_args(
                    "--disable-features=msWebOOUI,msPdfOOUI --enable-gpu-rasterization --enable-zero-copy",
                );
            }

            let window = win_builder.build()?;
            let actual_dark = apply_window_theme(&window, &theme_setting);
            let _ = window.emit("theme-updated", actual_dark);

            let win_for_events = window.clone();
            let app_handle = app.handle().clone();
            window.on_window_event(move |event| match event {
                WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
                    let is_max = win_for_events.is_maximized().unwrap_or(false);
                    let is_full = win_for_events.is_fullscreen().unwrap_or(false);
                    let _ = win_for_events.emit(
                        "window-state",
                        json!({
                            "maximized": is_max,
                            "fullscreen": is_full,
                        }),
                    );
                    if let Some(st) = app_handle.try_state::<AppState>() {
                        if let Ok(mut map) = st.settings.lock() {
                            if is_max {
                                if let Some(Value::Object(b)) = map.get_mut("windowBounds") {
                                    b.insert("maximized".to_string(), json!(true));
                                } else {
                                    map.insert("windowBounds".to_string(), json!({ "maximized": true }));
                                }
                            } else if let (Ok(size), Ok(scale)) =
                                (win_for_events.inner_size(), win_for_events.scale_factor())
                            {
                                let logical = size.to_logical::<f64>(scale);
                                if logical.width >= 992.0 && logical.height >= 600.0 {
                                    map.insert(
                                        "windowBounds".to_string(),
                                        json!({
                                            "width": logical.width.round(),
                                            "height": logical.height.round(),
                                            "maximized": false,
                                        }),
                                    );
                                }
                            }
                        }
                    }
                }
                WindowEvent::Focused(focused) => {
                    let _ = win_for_events.emit("window-focus-state", *focused);
                }
                WindowEvent::ThemeChanged(theme) => {
                    if let Some(st) = app_handle.try_state::<AppState>() {
                        let setting = st
                            .settings
                            .lock()
                            .ok()
                            .and_then(|m| m.get("theme").and_then(|v| v.as_str()).map(String::from))
                            .unwrap_or_else(|| "system".to_string());
                        if setting == "system" {
                            let _ = win_for_events.emit("theme-updated", matches!(theme, Theme::Dark));
                        }
                    }
                }
                WindowEvent::CloseRequested { .. } => {
                    if let Some(st) = app_handle.try_state::<AppState>() {
                        if let Ok(map) = st.settings.lock() {
                            save_settings_to_disk(&st.config_path, &map);
                        }
                        if let Ok(conn) = st.db.lock() {
                            let _ = conn.execute_batch("PRAGMA optimize;");
                        }
                    }
                }
                _ => {}
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_execute,
            db_batch,
            db_export_all,
            save_imported_settings,
            allocate_group_id,
            set_setting,
            set_rules_for_target,
            migrate_lovefield_rules,
            set_theme,
            resolve_pac,
            open_external,
            show_error_box,
            show_message_box,
            show_save_dialog,
            write_save_result,
            show_open_dialog,
            get_cache,
            clear_cache,
            write_clipboard,
            write_image_clipboard,
            save_image_as,
            close_window,
            minimize_window,
            maximize_window,
            request_focus,
            request_attention,
            init_font_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
