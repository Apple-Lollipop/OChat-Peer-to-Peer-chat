use super::*;

pub struct ResetConfirmation {
    token: Uuid,
    fingerprint: [u8; 32],
    expires: std::time::Instant,
}

async fn require_locked(state: &DesktopState) -> Reply<()> {
    if state.session.lock().await.is_some() {
        return Err("Lock the account before using account recovery".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn recover_local_password(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    recovery_key: String,
    password: String,
) -> Reply<()> {
    let _guard = state.account_guard.lock().await;
    require_locked(&state).await?;
    let directory = directory(&app)?;
    let key = zeroize::Zeroizing::new(recovery_key);
    let password = zeroize::Zeroizing::new(password);
    tauri::async_runtime::spawn_blocking(move || {
        Vault::recover_password(&directory, &key, &password)
    })
    .await
    .map_err(error)?
    .map_err(error)?;
    state.pending_reset.lock().await.take();
    Ok(())
}

#[tauri::command]
pub async fn prepare_account_reset(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Reply<Uuid> {
    let _guard = state.account_guard.lock().await;
    require_locked(&state).await?;
    let directory = directory(&app)?;
    let fingerprint =
        tauri::async_runtime::spawn_blocking(move || Vault::reset_fingerprint(&directory))
            .await
            .map_err(error)?
            .map_err(error)?;
    let token = Uuid::new_v4();
    *state.pending_reset.lock().await = Some(ResetConfirmation {
        token,
        fingerprint,
        expires: std::time::Instant::now() + Duration::from_secs(300),
    });
    Ok(token)
}

#[tauri::command]
pub async fn reset_local_account(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    token: Uuid,
    confirmation: String,
    acknowledged: bool,
) -> Reply<()> {
    if !acknowledged || confirmation != "DELETE MY ACCOUNT" {
        return Err("Confirm the data loss and type DELETE MY ACCOUNT exactly".into());
    }
    let _guard = state.account_guard.lock().await;
    require_locked(&state).await?;
    let pending = state
        .pending_reset
        .lock()
        .await
        .take()
        .filter(|pending| pending.token == token && pending.expires > std::time::Instant::now())
        .ok_or("Reset confirmation expired. Go back and open the reset option again")?;
    let directory = directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        Vault::reset_local(&directory, pending.fingerprint)
    })
    .await
    .map_err(error)?
    .map_err(error)?;
    state.effects.stop_all();
    state.pending_backup.lock().await.take();
    Ok(())
}
