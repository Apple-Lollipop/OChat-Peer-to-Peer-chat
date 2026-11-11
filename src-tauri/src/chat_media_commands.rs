//! Serves verified local files to the chat player. Nothing is fetched from the peer here.
use super::*;
use desktop::TransferRecord;
use ochat_core::{
    StoredMedia,
    chat_media::{MAX_MEDIA_PREVIEW, MEDIA_CHUNK, MEDIA_SNIFF_LEN, media_mime},
};
use std::{
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
};
use tauri_plugin_dialog::DialogExt;

const UNAVAILABLE: &str = "This file is no longer available";

#[derive(Serialize)]
pub struct ChatMediaInfo {
    size: u64,
    mime: &'static str,
    too_large: bool,
}

enum ChatMediaSource {
    Offered(Arc<ochat_core::ChatNode>),
    Stored(StoredMedia),
    Download { path: PathBuf, size: u64 },
}

impl ChatMediaSource {
    /// Returns the total size and the bytes at `position`, up to `max`.
    fn read(&self, id: Uuid, position: u64, max: usize) -> Result<Option<(u64, Vec<u8>)>, String> {
        match self {
            Self::Offered(client) => client.read_offered_file(id, position, max).map_err(error),
            Self::Stored(video) => video.read(position, max).map(Some).map_err(error),
            Self::Download { path, size } => {
                let mut file = std::fs::File::open(path)
                    .map_err(|_| "This file was moved or deleted from its saved location")?;
                if !file.metadata().map_err(error)?.is_file()
                    || file.metadata().map_err(error)?.len() != *size
                {
                    return Err("This file changed after it was received".into());
                }
                file.seek(SeekFrom::Start(position)).map_err(error)?;
                let mut bytes = Vec::with_capacity(max.min(size.saturating_sub(position) as usize));
                file.take(max as u64)
                    .read_to_end(&mut bytes)
                    .map_err(error)?;
                Ok(Some((*size, bytes)))
            }
        }
    }
}

/// A received file counts only once its own sender's transfer finished verification.
async fn source(
    state: &DesktopState,
    room: Uuid,
    peer: &str,
    id: Uuid,
) -> Reply<Option<ChatMediaSource>> {
    let account = vault(state).await?;
    if account
        .get::<ochat_core::message_tools::Update>(&format!("updates/{room}/{peer}/{id}/edit"))
        .map_err(error)?
        .is_some_and(|update| update.deleted())
    {
        return Ok(None);
    }
    if let Ok(client) = node(state).await?.room_node(room) {
        if client.read_offered_file(id, 0, 0).map_err(error)?.is_some() {
            return Ok(Some(ChatMediaSource::Offered(client)));
        }
    }
    if let Some(video) = StoredMedia::open(&account, room, peer, id).map_err(error)? {
        return Ok(Some(ChatMediaSource::Stored(video)));
    }
    let Some(record) = account
        .get::<TransferRecord>(&format!("desktop_transfer/{room}/{id}/{peer}"))
        .map_err(error)?
        .filter(|record| record.status == "received")
    else {
        return Ok(None);
    };
    Ok(account
        .get::<PathBuf>(&format!("desktop_download/{room}/{id}"))
        .map_err(error)?
        .map(|path| ChatMediaSource::Download {
            path,
            size: record.total,
        }))
}

async fn read(
    source: ChatMediaSource,
    id: Uuid,
    position: u64,
    max: usize,
) -> Reply<Option<(u64, Vec<u8>)>> {
    tauri::async_runtime::spawn_blocking(move || source.read(id, position, max))
        .await
        .map_err(error)?
}

/// `None` leaves the message as a plain file card.
#[tauri::command]
pub async fn chat_media_info(
    state: State<'_, DesktopState>,
    room: Uuid,
    peer: String,
    id: Uuid,
) -> Reply<Option<ChatMediaInfo>> {
    let Some(source) = source(&state, room, &peer, id).await? else {
        return Ok(None);
    };
    let Ok(Some((size, prefix))) = read(source, id, 0, MEDIA_SNIFF_LEN).await else {
        return Ok(None);
    };
    Ok(media_mime(&prefix).map(|mime| ChatMediaInfo {
        size,
        mime,
        too_large: size > MAX_MEDIA_PREVIEW,
    }))
}

#[tauri::command]
pub async fn chat_media_chunk(
    state: State<'_, DesktopState>,
    room: Uuid,
    peer: String,
    id: Uuid,
    offset: u64,
) -> Reply<tauri::ipc::Response> {
    let source = source(&state, room, &peer, id).await?.ok_or(UNAVAILABLE)?;
    let (size, bytes) = read(source, id, offset, MEDIA_CHUNK)
        .await?
        .ok_or(UNAVAILABLE)?;
    if size > MAX_MEDIA_PREVIEW {
        return Err("This file is too large to play in chat".into());
    }
    Ok(tauri::ipc::Response::new(bytes))
}

/// Downloads accepted audio or video into encrypted app storage instead of asking where to save it.
#[tauri::command]
pub async fn receive_chat_media(
    state: State<'_, DesktopState>,
    room: Uuid,
    peer: String,
    id: Uuid,
) -> Reply<bool> {
    node(&state)
        .await?
        .room_node(room)
        .map_err(error)?
        .receive_media(&peer, id)
        .await
        .map_err(|e| format!("{e:#}"))?;
    Ok(true)
}

fn write_copy(source: &ChatMediaSource, id: Uuid, destination: &Path) -> Reply<()> {
    let temp = destination.with_file_name(format!(".ochat-{id}.copy"));
    let written = (|| {
        let mut output = std::fs::File::create(&temp).map_err(error)?;
        let mut offset = 0;
        loop {
            let (size, bytes) = source.read(id, offset, MEDIA_CHUNK)?.ok_or(UNAVAILABLE)?;
            output.write_all(&bytes).map_err(error)?;
            offset += bytes.len() as u64;
            if offset >= size {
                break;
            }
            if bytes.is_empty() {
                return Err("The file ended unexpectedly".to_string());
            }
        }
        output.sync_all().map_err(error)?;
        drop(output);
        std::fs::rename(&temp, destination).map_err(error)
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    written
}

/// Saves a copy wherever the user chooses. Returns false when the dialog is cancelled.
#[tauri::command]
pub async fn save_chat_media(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    room: Uuid,
    peer: String,
    id: Uuid,
    name: String,
) -> Reply<bool> {
    let source = source(&state, room, &peer, id).await?.ok_or(UNAVAILABLE)?;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Save a copy of this file")
            .set_file_name(&name)
            .blocking_save_file()
    })
    .await
    .map_err(error)?;
    let Some(picked) = picked else {
        return Ok(false);
    };
    let destination = picked.into_path().map_err(error)?;
    let target = destination.clone();
    tauri::async_runtime::spawn_blocking(move || write_copy(&source, id, &target))
        .await
        .map_err(error)??;
    vault(&state)
        .await?
        .put(&format!("desktop_download/{room}/{id}"), &destination)
        .map_err(error)?;
    Ok(true)
}
