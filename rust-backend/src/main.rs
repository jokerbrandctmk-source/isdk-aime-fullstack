use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{env, net::SocketAddr, path::PathBuf, sync::Arc};
use tokio::{fs, sync::RwLock};
use tower_http::{cors::CorsLayer, services::ServeDir, trace::TraceLayer};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    db_path: PathBuf,
    db_lock: Arc<RwLock<()>>,
}

#[derive(Deserialize)]
struct AnimeQuery {
    search: Option<String>,
    genre: Option<String>,
    #[serde(rename = "type")]
    content_type: Option<String>,
}

#[derive(Deserialize)]
struct AuthBody {
    username: String,
    password: String,
}

fn slugify(input: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in input.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn hash_password(password: &str, salt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(password.as_bytes());
    format!("{salt}:{:x}", hasher.finalize())
}

fn password_matches(password: &str, stored: &str) -> bool {
    let Some((salt, _)) = stored.split_once(':') else {
        return false;
    };
    hash_password(password, salt) == stored
}

async fn read_db(state: &AppState) -> Map<String, Value> {
    let _guard = state.db_lock.read().await;
    let raw = fs::read_to_string(&state.db_path).await.unwrap_or_else(|_| "{}".to_string());
    serde_json::from_str::<Value>(&raw)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

async fn write_db(state: &AppState, db: &Map<String, Value>) -> Result<(), String> {
    let _guard = state.db_lock.write().await;
    if let Some(parent) = state.db_path.parent() {
        fs::create_dir_all(parent).await.map_err(|err| err.to_string())?;
    }
    let raw = serde_json::to_string_pretty(db).map_err(|err| err.to_string())?;
    fs::write(&state.db_path, raw).await.map_err(|err| err.to_string())
}

fn array_mut<'a>(db: &'a mut Map<String, Value>, key: &str) -> &'a mut Vec<Value> {
    if !db.get(key).is_some_and(Value::is_array) {
        db.insert(key.to_string(), json!([]));
    }
    db.get_mut(key).unwrap().as_array_mut().unwrap()
}

fn object_mut<'a>(db: &'a mut Map<String, Value>, key: &str) -> &'a mut Map<String, Value> {
    if !db.get(key).is_some_and(Value::is_object) {
        db.insert(key.to_string(), json!({}));
    }
    db.get_mut(key).unwrap().as_object_mut().unwrap()
}

fn public_user(user: &Value) -> Value {
    let mut item = user.as_object().cloned().unwrap_or_default();
    item.remove("passwordHash");
    Value::Object(item)
}

fn bearer(headers: &HeaderMap) -> Option<String> {
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_string)
}

fn current_user_id(db: &Map<String, Value>, headers: &HeaderMap) -> Option<String> {
    let token = bearer(headers)?;
    db.get("sessions")
        .and_then(Value::as_object)
        .and_then(|sessions| sessions.get(&token))
        .and_then(Value::as_str)
        .map(str::to_string)
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "service": "ISKD Anime Rust API" }))
}

async fn genres(State(state): State<AppState>) -> Json<Value> {
    let db = read_db(&state).await;
    let mut genres = db
        .get("anime")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|anime| anime.get("genres").and_then(Value::as_array).into_iter().flatten())
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    genres.sort();
    genres.dedup();
    Json(json!({ "genres": genres }))
}

async fn list_anime(State(state): State<AppState>, Query(query): Query<AnimeQuery>) -> Json<Value> {
    let db = read_db(&state).await;
    let search = query.search.unwrap_or_default().to_lowercase();
    let genre = query.genre.unwrap_or_else(|| "All".to_string()).to_lowercase();
    let content_type = query.content_type.unwrap_or_else(|| "All".to_string()).to_lowercase();
    let anime = db
        .get("anime")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|item| {
            let text = serde_json::to_string(item).unwrap_or_default().to_lowercase();
            let search_ok = search.is_empty() || text.contains(&search);
            let genre_ok = genre == "all" || text.contains(&genre);
            let type_ok = content_type == "all"
                || item
                    .get("type")
                    .and_then(Value::as_str)
                    .is_some_and(|value| value.eq_ignore_ascii_case(&content_type));
            search_ok && genre_ok && type_ok
        })
        .collect::<Vec<_>>();
    Json(json!({ "anime": anime }))
}

async fn get_anime(State(state): State<AppState>, Path(slug): Path<String>) -> impl IntoResponse {
    let db = read_db(&state).await;
    let found = db
        .get("anime")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|item| item.get("slug").and_then(Value::as_str) == Some(&slug));
    match found {
        Some(anime) => (StatusCode::OK, Json(json!({ "anime": anime }))).into_response(),
        None => (StatusCode::NOT_FOUND, Json(json!({ "error": "Anime not found" }))).into_response(),
    }
}

async fn create_anime(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut body): Json<Value>,
) -> impl IntoResponse {
    let mut db = read_db(&state).await;
    let title = body
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Untitled")
        .to_string();
    let mut slug = slugify(&title);
    if slug.is_empty() {
        slug = format!("upload-{}", Uuid::new_v4());
    }
    let original = slug.clone();
    let mut count = 2;
    let existing_anime = db.get("anime").and_then(Value::as_array).cloned().unwrap_or_default();
    while existing_anime
        .iter()
        .any(|item| item.get("slug").and_then(Value::as_str) == Some(&slug))
    {
        slug = format!("{original}-{count}");
        count += 1;
    }

    let episode_id = format!("{slug}-01");
    let episode_title = body
        .get("episodeTitle")
        .and_then(Value::as_str)
        .unwrap_or("Episode 1")
        .to_string();
    let episode_duration = body
        .get("episodeDurationMinutes")
        .and_then(Value::as_u64)
        .unwrap_or(24)
        * 60;
    let episode_synopsis = body
        .get("episodeSynopsis")
        .and_then(Value::as_str)
        .unwrap_or("Opening episode.")
        .to_string();
    let episode_video = body
        .get("episodeVideoUrl")
        .or_else(|| body.get("episodeVideo"))
        .or_else(|| body.get("video"))
        .cloned()
        .unwrap_or(Value::Null);
    let episode_qualities = body
        .get("episodeVideoQualities")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let episode_video_1080 = body.get("episodeVideo1080").cloned().unwrap_or(Value::Null);
    let episode_video_720 = body.get("episodeVideo720").cloned().unwrap_or(Value::Null);
    let episode_video_480 = body.get("episodeVideo480").cloned().unwrap_or(Value::Null);
    let user_id = current_user_id(&db, &headers);

    let item = body.as_object_mut().unwrap();
    item.insert("id".to_string(), json!(format!("ani_{}", Uuid::new_v4())));
    item.insert("slug".to_string(), json!(slug));
    item.entry("poster".to_string()).or_insert(json!("/assets/anime/poster.png"));
    item.entry("backdrop".to_string()).or_insert(json!("/assets/anime/poster.png"));
    item.entry("rating".to_string()).or_insert(json!(4.2));
    item.entry("views".to_string()).or_insert(json!(0));
    item.entry("likes".to_string()).or_insert(json!(0));
    item.insert("likedBy".to_string(), json!([]));
    item.insert("createdAt".to_string(), json!(Utc::now().to_rfc3339()));
    if let Some(id) = user_id {
        item.insert("createdBy".to_string(), json!(id));
    }
    item.insert(
        "episodes".to_string(),
        json!([{
            "id": episode_id,
            "number": 1,
            "title": episode_title,
            "duration": episode_duration,
            "video": episode_video,
            "qualities": episode_qualities,
            "video1080": episode_video_1080,
            "video720": episode_video_720,
            "video480": episode_video_480,
            "synopsis": episode_synopsis
        }]),
    );

    let saved = body.clone();
    array_mut(&mut db, "anime").insert(0, saved.clone());
    if let Err(error) = write_db(&state, &db).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error }))).into_response();
    }
    (StatusCode::CREATED, Json(json!({ "anime": saved }))).into_response()
}

async fn auth(
    State(state): State<AppState>,
    Path(mode): Path<String>,
    Json(body): Json<AuthBody>,
) -> impl IntoResponse {
    let mut db = read_db(&state).await;
    if mode == "register" {
        if array_mut(&mut db, "users").iter().any(|user| {
            user.get("username")
                .and_then(Value::as_str)
                .is_some_and(|name| name.eq_ignore_ascii_case(&body.username))
        }) {
            return (StatusCode::CONFLICT, Json(json!({ "error": "Username already exists." }))).into_response();
        }
        let salt = Uuid::new_v4().to_string();
        let user = json!({
            "id": format!("usr_{}", Uuid::new_v4()),
            "username": body.username,
            "passwordHash": hash_password(&body.password, &salt),
            "createdAt": Utc::now().to_rfc3339()
        });
        array_mut(&mut db, "users").push(user.clone());
        let token = Uuid::new_v4().to_string();
        object_mut(&mut db, "sessions").insert(token.clone(), json!(user["id"].as_str().unwrap()));
        let _ = write_db(&state, &db).await;
        return (StatusCode::CREATED, Json(json!({ "token": token, "user": public_user(&user) }))).into_response();
    }

    let Some(user) = array_mut(&mut db, "users").iter().find(|user| {
        user.get("username")
            .and_then(Value::as_str)
            .is_some_and(|name| name.eq_ignore_ascii_case(&body.username))
            && user
                .get("passwordHash")
                .and_then(Value::as_str)
                .is_some_and(|hash| password_matches(&body.password, hash))
    }).cloned() else {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid username or password." }))).into_response();
    };

    let token = Uuid::new_v4().to_string();
    object_mut(&mut db, "sessions").insert(token.clone(), json!(user["id"].as_str().unwrap()));
    let _ = write_db(&state, &db).await;
    (StatusCode::OK, Json(json!({ "token": token, "user": public_user(&user) }))).into_response()
}

async fn me(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    let db = read_db(&state).await;
    let Some(user_id) = current_user_id(&db, &headers) else {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Sign in required." }))).into_response();
    };
    let user = db
        .get("users")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|user| user.get("id").and_then(Value::as_str) == Some(&user_id));
    match user {
        Some(user) => (StatusCode::OK, Json(json!({ "user": public_user(user) }))).into_response(),
        None => (StatusCode::UNAUTHORIZED, Json(json!({ "error": "User not found." }))).into_response(),
    }
}

async fn overview(State(state): State<AppState>) -> Json<Value> {
    let db = read_db(&state).await;
    let anime = db.get("anime").and_then(Value::as_array).cloned().unwrap_or_default();
    let users = db.get("users").and_then(Value::as_array).cloned().unwrap_or_default();
    let views: i64 = anime.iter().map(|item| item.get("views").and_then(Value::as_i64).unwrap_or(0)).sum();
    let likes: i64 = anime.iter().map(|item| item.get("likes").and_then(Value::as_i64).unwrap_or(0)).sum();
    Json(json!({
        "storage": {
            "mode": "rust-json",
            "dbPath": state.db_path.display().to_string(),
            "note": "Rust API saves shared data here when deployed online."
        },
        "users": users.into_iter().map(|user| public_user(&user)).collect::<Vec<_>>(),
        "totals": { "users": db.get("users").and_then(Value::as_array).map(Vec::len).unwrap_or(0), "anime": anime.len(), "views": views, "likes": likes, "comments": 0 },
        "topAnime": anime
    }))
}

async fn get_watchlist(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    let db = read_db(&state).await;
    let Some(user_id) = current_user_id(&db, &headers) else {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Sign in required." }))).into_response();
    };
    let slugs = db
        .get("watchlists")
        .and_then(Value::as_object)
        .and_then(|watchlists| watchlists.get(&user_id))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    (StatusCode::OK, Json(json!({ "slugs": slugs }))).into_response()
}

async fn add_watchlist(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(slug): Path<String>,
) -> impl IntoResponse {
    let mut db = read_db(&state).await;
    let Some(user_id) = current_user_id(&db, &headers) else {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Sign in required." }))).into_response();
    };
    let slugs = {
        let watchlists = object_mut(&mut db, "watchlists");
        let list = watchlists.entry(user_id).or_insert(json!([])).as_array_mut().unwrap();
        if !list.iter().any(|item| item.as_str() == Some(&slug)) {
            list.push(json!(slug));
        }
        list.clone()
    };
    let _ = write_db(&state, &db).await;
    (StatusCode::OK, Json(json!({ "slugs": slugs }))).into_response()
}

async fn remove_watchlist(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(slug): Path<String>,
) -> impl IntoResponse {
    let mut db = read_db(&state).await;
    let Some(user_id) = current_user_id(&db, &headers) else {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Sign in required." }))).into_response();
    };
    let slugs = {
        let watchlists = object_mut(&mut db, "watchlists");
        let list = watchlists.entry(user_id).or_insert(json!([])).as_array_mut().unwrap();
        list.retain(|item| item.as_str() != Some(&slug));
        list.clone()
    };
    let _ = write_db(&state, &db).await;
    (StatusCode::OK, Json(json!({ "slugs": slugs }))).into_response()
}

async fn get_progress(State(state): State<AppState>, headers: HeaderMap) -> impl IntoResponse {
    let db = read_db(&state).await;
    let Some(user_id) = current_user_id(&db, &headers) else {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Sign in required." }))).into_response();
    };
    let progress = db
        .get("progress")
        .and_then(Value::as_object)
        .and_then(|progress| progress.get(&user_id))
        .cloned()
        .unwrap_or_else(|| json!({}));
    (StatusCode::OK, Json(json!({ "progress": progress }))).into_response()
}

async fn save_progress(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(episode_id): Path<String>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let mut db = read_db(&state).await;
    let Some(user_id) = current_user_id(&db, &headers) else {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Sign in required." }))).into_response();
    };
    let anime_slug = db
        .get("anime")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|anime| {
            anime.get("episodes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .any(|episode| episode.get("id").and_then(Value::as_str) == Some(&episode_id))
        })
        .and_then(|anime| anime.get("slug").and_then(Value::as_str))
        .unwrap_or("")
        .to_string();
    let progress = {
        let progress_root = object_mut(&mut db, "progress");
        let user_progress = progress_root.entry(user_id).or_insert(json!({})).as_object_mut().unwrap();
        user_progress.insert(
            episode_id.clone(),
            json!({
                "animeSlug": anime_slug,
                "episodeId": episode_id,
                "position": body.get("position").and_then(Value::as_f64).unwrap_or(0.0),
                "duration": body.get("duration").and_then(Value::as_f64).unwrap_or(1.0),
                "updatedAt": Utc::now().to_rfc3339()
            }),
        );
        Value::Object(user_progress.clone())
    };
    let _ = write_db(&state, &db).await;
    (StatusCode::OK, Json(json!({ "progress": progress }))).into_response()
}

async fn get_comments(State(state): State<AppState>, Path(episode_id): Path<String>) -> Json<Value> {
    let db = read_db(&state).await;
    let comments = db
        .get("comments")
        .and_then(Value::as_object)
        .and_then(|comments| comments.get(&episode_id))
        .cloned()
        .unwrap_or_else(|| json!([]));
    Json(json!({ "comments": comments }))
}

async fn post_comment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(episode_id): Path<String>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let mut db = read_db(&state).await;
    let user_name = current_user_id(&db, &headers)
        .and_then(|id| {
            db.get("users")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .find(|user| user.get("id").and_then(Value::as_str) == Some(&id))
                .and_then(|user| user.get("username").and_then(Value::as_str))
                .map(str::to_string)
        })
        .unwrap_or_else(|| "Guest".to_string());
    let comments = {
        let comments_root = object_mut(&mut db, "comments");
        let list = comments_root.entry(episode_id).or_insert(json!([])).as_array_mut().unwrap();
        list.insert(
            0,
            json!({
                "id": format!("comment_{}", Uuid::new_v4()),
                "user": user_name,
                "body": body.get("body").and_then(Value::as_str).unwrap_or(""),
                "createdAt": Utc::now().to_rfc3339()
            }),
        );
        list.clone()
    };
    let _ = write_db(&state, &db).await;
    (StatusCode::OK, Json(json!({ "comments": comments }))).into_response()
}

#[tokio::main]
async fn main() {
    let port = env::var("PORT").ok().and_then(|value| value.parse().ok()).unwrap_or(3001);
    let db_path = env::var("DB_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("../data/db.json"));
    let state = AppState { db_path, db_lock: Arc::new(RwLock::new(())) };

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/genres", get(genres))
        .route("/api/anime", get(list_anime).post(create_anime))
        .route("/api/anime/{slug}", get(get_anime))
        .route("/api/auth/{mode}", post(auth))
        .route("/api/me", get(me))
        .route("/api/watchlist", get(get_watchlist))
        .route("/api/watchlist/{slug}", post(add_watchlist).delete(remove_watchlist))
        .route("/api/progress", get(get_progress))
        .route("/api/progress/{episode_id}", post(save_progress))
        .route("/api/comments/{episode_id}", get(get_comments).post(post_comment))
        .route("/api/admin/overview", get(overview))
        .nest_service("/", ServeDir::new("../public"))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("ISKD Anime Rust API listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
