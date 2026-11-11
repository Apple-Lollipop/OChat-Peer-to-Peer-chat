//! Small encrypted room-activity hints; old histories are scanned only once.
use super::*;
static ACTIVITY: Mutex<()> = Mutex::new(());

pub(super) fn latest(vault: &Vault, room: Uuid) -> Result<u64> {
    let _guard = ACTIVITY.lock().unwrap();
    let key = format!("conversation_activity/{room}");
    if let Some(at) = vault.get::<u64>(&key)? {
        return Ok(at);
    }
    let at = history_latest(vault, room)?;
    vault.put(&key, &at)?;
    Ok(at)
}
fn history_latest(vault: &Vault, room: Uuid) -> Result<u64> {
    Ok(vault
        .list::<HistoryEntry>(&format!("history/{room}/"))?
        .into_iter()
        .filter(|entry| {
            matches!(
                entry.event["type"].as_str(),
                Some("message" | "file_offered")
            )
        })
        .map(|entry| entry.event["timestamp"].as_u64().unwrap_or(entry.timestamp))
        .max()
        .unwrap_or(0))
}

pub(super) fn record(vault: &Vault, room: Uuid, timestamp: u64) -> Result<()> {
    let _guard = ACTIVITY.lock().unwrap();
    let key = format!("conversation_activity/{room}");
    let previous = vault.get::<u64>(&key)?;
    let at = timestamp.max(match previous {
        Some(at) => at,
        None => history_latest(vault, room)?,
    });
    if previous != Some(at) {
        vault.put(&key, &at)?;
    }
    Ok(())
}

pub(super) fn clear(vault: &Vault, room: Uuid) -> Result<()> {
    let _guard = ACTIVITY.lock().unwrap();
    vault.put(&format!("conversation_activity/{room}"), &0u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persisted_recency_backfills_old_histories_and_never_regresses_for_late_messages() {
        let dir = tempfile::tempdir().unwrap();
        let (vault, _) = Vault::create(dir.path(), "Test", "friend recency test password").unwrap();
        let room = Uuid::new_v4();
        for (id, at, kind) in [
            (1, 20, "message"),
            (2, 50, "message"),
            (3, 100, "member_joined"),
        ] {
            vault
                .put(
                    &format!("history/{room}/{id}"),
                    &HistoryEntry {
                        room,
                        timestamp: at,
                        event: serde_json::json!({"type":kind,"timestamp":at}),
                    },
                )
                .unwrap();
        }
        assert_eq!(latest(&vault, room).unwrap(), 50);
        record(&vault, room, 70).unwrap();
        record(&vault, room, 40).unwrap();
        assert_eq!(latest(&vault, room).unwrap(), 70);
        drop(vault);
        let vault = Vault::unlock(dir.path(), "friend recency test password").unwrap();
        assert_eq!(latest(&vault, room).unwrap(), 70);
        clear(&vault, room).unwrap();
        assert_eq!(latest(&vault, room).unwrap(), 0);
    }
}
