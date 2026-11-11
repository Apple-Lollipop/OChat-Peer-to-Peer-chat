use super::*;

pub struct Recording {
    id: Uuid,
    room: Uuid,
    channel: Option<Uuid>,
    session: Option<audio::AudioSession>,
    bytes: Option<Vec<u8>>,
}

impl Drop for Recording {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        if let Some(bytes) = &mut self.bytes {
            bytes.zeroize();
        }
    }
}

#[tauri::command]
pub async fn start_voice_message(
    state: State<'_, DesktopState>,
    room: Uuid,
    channel: Option<Uuid>,
) -> Reply<Uuid> {
    let _guard = state.account_guard.lock().await;
    let hub = node(&state).await?;
    if hub.media_busy() {
        return Err("Leave the call before recording a voice message".into());
    }
    let target = hub.room_node(room).map_err(error)?;
    if target.snapshot().text_channel != channel {
        return Err("Choose the text channel first".into());
    }
    state.effects.stop_test();
    let epoch = state.effects.recording_epoch.load(Ordering::SeqCst);
    let session = audio::AudioSession::start_message(hub.settings().audio)
        .await
        .map_err(error)?;
    if state.effects.recording_epoch.load(Ordering::SeqCst) != epoch || hub.media_busy() {
        session.shutdown().await.map_err(error)?;
        return Err("Recording cancelled".into());
    }
    let id = Uuid::new_v4();
    *state.effects.recording.lock().unwrap() = Some(Recording {
        id,
        room,
        channel,
        session: Some(session),
        bytes: None,
    });
    Ok(id)
}

#[tauri::command]
pub fn voice_message_status(state: State<'_, DesktopState>, id: Uuid) -> Reply<serde_json::Value> {
    let recording = state.effects.recording.lock().unwrap();
    let recording = recording
        .as_ref()
        .filter(|r| r.id == id)
        .ok_or("Recording ended")?;
    let session = recording
        .session
        .as_ref()
        .ok_or("Recording is not active")?;
    if let Some(failure) = session.take_error() {
        return Err(failure);
    }
    let samples = session.message_samples();
    Ok(
        serde_json::json!({"seconds": samples as f64 / ochat_core::voice_message::RATE as f64, "level":session.level(), "full":samples >= ochat_core::voice_message::MAX_SAMPLES}),
    )
}

#[tauri::command]
pub async fn finish_voice_message(
    state: State<'_, DesktopState>,
    id: Uuid,
) -> Reply<tauri::ipc::Response> {
    let _guard = state.account_guard.lock().await;
    node(&state).await?;
    let session = state
        .effects
        .recording
        .lock()
        .unwrap()
        .as_mut()
        .filter(|r| r.id == id)
        .and_then(|r| r.session.take())
        .ok_or("Recording ended")?;
    let bytes = session.finish_message().await.map_err(error)?;
    let mut recording = state.effects.recording.lock().unwrap();
    let recording = recording
        .as_mut()
        .filter(|r| r.id == id)
        .ok_or("Recording cancelled")?;
    recording.bytes = Some(bytes.clone());
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn cancel_voice_message(state: State<'_, DesktopState>, id: Option<Uuid>) {
    if id.is_none() {
        state.effects.recording_epoch.fetch_add(1, Ordering::SeqCst);
    }
    let mut recording = state.effects.recording.lock().unwrap();
    if recording
        .as_ref()
        .is_some_and(|r| id.is_none_or(|id| r.id == id))
    {
        recording.take();
    }
}

#[tauri::command]
pub async fn send_voice_message(state: State<'_, DesktopState>, id: Uuid) -> Reply<()> {
    let _guard = state.account_guard.lock().await;
    let hub = node(&state).await?;
    let (room, channel, bytes) = {
        let recording = state.effects.recording.lock().unwrap();
        let recording = recording
            .as_ref()
            .filter(|r| r.id == id)
            .ok_or("Recording ended")?;
        (
            recording.room,
            recording.channel,
            recording
                .bytes
                .clone()
                .ok_or("Stop recording before sending")?,
        )
    };
    hub.room_node(room)
        .map_err(error)?
        .offer_voice_message(channel, bytes)
        .await
        .map_err(error)?;
    let mut recording = state.effects.recording.lock().unwrap();
    if recording.as_ref().is_some_and(|r| r.id == id) {
        recording.take();
    }
    Ok(())
}
