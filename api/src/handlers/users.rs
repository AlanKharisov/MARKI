use axum::{
    extract::{Query, State},
    Json,
};
use serde_json::Value;
use std::sync::Arc;

use crate::{
    errors::{ApiResult, AppError},
    models::{PublicUser, UserSearchQuery},
    AppState,
};

/// How many user documents one search scans. Firestore has no text search, so
/// matching happens in memory; raise this (or move to a search index) as users grow.
const SCAN_LIMIT: i32 = 1000;
const MAX_RESULTS: usize = 20;

fn text(doc: &Value, key: &str) -> String {
    doc.get(key).and_then(Value::as_str).unwrap_or_default().to_owned()
}

fn opt_text(doc: &Value, key: &str) -> Option<String> {
    doc.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned)
}

/// `GET /api/users/search?q=` — find users by name or username (case-insensitive,
/// substring). A leading `@` is ignored. Email is never matched or returned.
pub async fn search_users(
    State(state): State<Arc<AppState>>,
    Query(query): Query<UserSearchQuery>,
) -> ApiResult<Json<Vec<PublicUser>>> {
    let q = query.q.trim().trim_start_matches('@').to_lowercase();
    if q.chars().count() < 2 {
        return Err(AppError::BadRequest("Query must be at least 2 characters".into()));
    }

    let docs = state
        .firestore
        .query("users", vec![], None, Some(SCAN_LIMIT))
        .await
        .map_err(|e| AppError::Firebase(e.to_string()))?;

    let mut users: Vec<PublicUser> = docs
        .iter()
        .filter(|d| !d.get("banned").and_then(Value::as_bool).unwrap_or(false))
        .filter_map(|d| {
            let name = text(d, "name");
            let username = text(d, "username");
            let hit = name.to_lowercase().contains(&q) || username.to_lowercase().contains(&q);
            let uid = text(d, "uid");
            (hit && !uid.is_empty()).then(|| PublicUser {
                uid,
                name,
                username,
                avatar: opt_text(d, "avatar"),
                bio: opt_text(d, "bio"),
                company_approved: d.get("companyApproved").and_then(Value::as_bool).unwrap_or(false),
            })
        })
        .collect();

    // Exact and prefix username matches first.
    users.sort_by_key(|u| {
        let un = u.username.to_lowercase();
        (un != q, !un.starts_with(&q), u.name.to_lowercase())
    });
    users.truncate(MAX_RESULTS);
    Ok(Json(users))
}
