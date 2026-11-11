//! Bounded authenticated snapshots: source paths are never reopened after an offer.
use super::*;
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
};
use zeroize::{Zeroize, Zeroizing};
const CHUNK: u64 = 64 * 1024;
#[derive(Clone)]
pub(super) enum OfferedSource {
    Legacy(PathBuf),
    Stage(Arc<StagedFile>),
}
pub(super) struct StagedFile {
    path: PathBuf,
    key: Zeroizing<[u8; 32]>,
    size: u64,
    context: Uuid,
    _temp: Option<tempfile::TempDir>,
    durable: AtomicBool,
}
#[derive(Serialize, Deserialize)]
struct Record {
    version: u8,
    offer: FileOffer,
    key: [u8; 32],
    context: Uuid,
}
impl Drop for Record {
    fn drop(&mut self) {
        self.key.zeroize();
    }
}
impl Drop for StagedFile {
    fn drop(&mut self) {
        if !self.durable.load(Ordering::Relaxed) {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}
/// Seals plaintext as it arrives. An unfinished stage deletes itself when dropped.
pub(super) struct StageWriter {
    output: File,
    stage: StagedFile,
    pending: Zeroizing<Vec<u8>>,
}
impl StageWriter {
    pub(super) fn create(dir: &Path) -> Result<Self> {
        Self::open(dir, None)
    }
    fn open(dir: &Path, temp: Option<tempfile::TempDir>) -> Result<Self> {
        std::fs::create_dir_all(dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        }
        let context = Uuid::new_v4();
        let path = dir.join(format!("{context}.bin"));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let output = options.open(&path)?;
        Ok(Self {
            output,
            stage: StagedFile {
                path,
                key: Zeroizing::new(rand::random()),
                size: 0,
                context,
                _temp: temp,
                durable: AtomicBool::new(false),
            },
            pending: Zeroizing::new(Vec::with_capacity(CHUNK as usize)),
        })
    }
    pub(super) fn append(&mut self, mut data: &[u8]) -> Result<()> {
        while !data.is_empty() {
            let take = (CHUNK as usize - self.pending.len()).min(data.len());
            self.pending.extend_from_slice(&data[..take]);
            data = &data[take..];
            if self.pending.len() == CHUNK as usize {
                self.seal()?;
            }
        }
        Ok(())
    }
    fn seal(&mut self) -> Result<()> {
        let cipher = XChaCha20Poly1305::new((&*self.stage.key).into());
        let nonce: [u8; 24] = rand::random();
        let len = self.pending.len();
        let aad = self.stage.aad(self.stage.size / CHUNK, len);
        let encrypted = cipher
            .encrypt(
                &XNonce::from(nonce),
                Payload {
                    msg: &self.pending,
                    aad: &aad,
                },
            )
            .map_err(|_| anyhow::anyhow!("File snapshot encryption failed"))?;
        self.output.write_all(&nonce)?;
        self.output.write_all(&encrypted)?;
        self.stage.size += len as u64;
        self.pending.clear();
        Ok(())
    }
    pub(super) fn finish(mut self) -> Result<Arc<StagedFile>> {
        if !self.pending.is_empty() {
            self.seal()?;
        }
        self.output.sync_all()?;
        Ok(Arc::new(self.stage))
    }
}
impl StagedFile {
    pub(super) fn from_bytes(bytes: &[u8], directory: Option<&Path>) -> Result<Arc<Self>> {
        let temp = if directory.is_none() {
            Some(tempfile::tempdir()?)
        } else {
            None
        };
        let dir = directory
            .map(Path::to_path_buf)
            .unwrap_or_else(|| temp.as_ref().unwrap().path().to_path_buf());
        let mut writer = StageWriter::open(&dir, temp)?;
        writer.append(bytes)?;
        writer.finish()
    }

    pub(super) fn capture(
        source: &Path,
        directory: Option<&Path>,
        _offer: Uuid,
    ) -> Result<(Arc<Self>, u64, String)> {
        let mut input = File::open(source)?;
        let meta = input.metadata()?;
        ensure!(
            meta.is_file() && meta.len() <= MAX_FILE,
            "Choose a file no larger than 2 GiB"
        );
        let temp = if directory.is_none() {
            Some(tempfile::tempdir()?)
        } else {
            None
        };
        let dir = directory
            .map(Path::to_path_buf)
            .unwrap_or_else(|| temp.as_ref().unwrap().path().to_path_buf());
        let mut writer = StageWriter::open(&dir, temp)?;
        let mut hash = blake3::Hasher::new();
        let mut buf = Zeroizing::new(vec![0; CHUNK as usize]);
        let mut total = 0;
        loop {
            let len = input.read(&mut buf)?;
            if len == 0 {
                break;
            }
            total += len as u64;
            ensure!(total <= MAX_FILE, "Choose a file no larger than 2 GiB");
            writer.append(&buf[..len])?;
            hash.update(&buf[..len]);
        }
        let stage = writer.finish()?;
        Ok((stage, total, hash.finalize().to_hex().to_string()))
    }
    fn aad(&self, index: u64, len: usize) -> Vec<u8> {
        let mut aad = b"ochat/5/file-snapshot".to_vec();
        aad.extend(self.context.as_bytes());
        aad.extend(index.to_le_bytes());
        aad.extend((len as u64).to_le_bytes());
        aad
    }
    pub(super) fn persist(&self, vault: &Vault, room: Uuid, offer: &FileOffer) -> Result<()> {
        vault.put(
            &format!("send_file/{room}/{}", offer.id),
            &Record {
                version: 2,
                offer: offer.clone(),
                key: *self.key,
                context: self.context,
            },
        )?;
        self.durable.store(true, Ordering::Relaxed);
        Ok(())
    }
    pub(super) fn read_at(&self, position: u64) -> Result<Zeroizing<Vec<u8>>> {
        ensure!(position <= self.size, "Invalid file position");
        if position == self.size {
            return Ok(Zeroizing::new(vec![]));
        }
        let index = position / CHUNK;
        let start = index * CHUNK;
        let len = (self.size - start).min(CHUNK) as usize;
        let mut file = File::open(&self.path)?;
        file.seek(SeekFrom::Start(index * (CHUNK + 40)))?;
        let mut nonce = [0; 24];
        file.read_exact(&mut nonce)?;
        let mut bytes = vec![0; len + 16];
        file.read_exact(&mut bytes)?;
        let cipher = XChaCha20Poly1305::new((&*self.key).into());
        let aad = self.aad(index, len);
        let mut plain = Zeroizing::new(
            cipher
                .decrypt(
                    &XNonce::from(nonce),
                    Payload {
                        msg: &bytes,
                        aad: &aad,
                    },
                )
                .map_err(|_| {
                    anyhow::anyhow!("Encrypted file snapshot is damaged; create a new offer")
                })?,
        );
        let skip = (position - start) as usize;
        if skip > 0 {
            plain.drain(..skip);
        }
        Ok(plain)
    }
    pub(super) fn size(&self) -> u64 {
        self.size
    }
    /// Plaintext from `position`, up to `max` bytes, across chunk boundaries.
    pub(super) fn read_range(&self, position: u64, max: usize) -> Result<Vec<u8>> {
        let mut bytes = Vec::new();
        let mut cursor = position;
        while bytes.len() < max && cursor < self.size {
            let chunk = self.read_at(cursor)?;
            ensure!(!chunk.is_empty(), "Encrypted file snapshot was truncated");
            let take = chunk.len().min(max - bytes.len());
            bytes.extend_from_slice(&chunk[..take]);
            cursor += take as u64;
        }
        Ok(bytes)
    }
    pub(super) fn persist_received(
        &self,
        vault: &Vault,
        room: Uuid,
        peer: &str,
        offer: &FileOffer,
    ) -> Result<()> {
        vault.put(
            &received_key(room, offer.id, peer),
            &Record {
                version: 2,
                offer: offer.clone(),
                key: *self.key,
                context: self.context,
            },
        )?;
        self.durable.store(true, Ordering::Relaxed);
        Ok(())
    }
    pub(super) fn prefix_hash(&self, offset: u64) -> Result<String> {
        ensure!(offset <= self.size, "Invalid resume offset");
        let mut hash = blake3::Hasher::new();
        let mut position = 0;
        while position < offset {
            let bytes = self.read_at(position)?;
            let len = bytes.len().min((offset - position) as usize);
            hash.update(&bytes[..len]);
            position += len as u64;
        }
        Ok(hash.finalize().to_hex().to_string())
    }
}
fn received_key(room: Uuid, id: Uuid, peer: &str) -> String {
    format!("received_media/{room}/{id}/{peer}")
}
pub(super) fn received_directory(vault: &Vault, room: Uuid) -> PathBuf {
    vault
        .directory()
        .join("received-media")
        .join(room.to_string())
}
/// Media stored from this sender, or `None` once it is gone from app storage.
pub(super) fn open_received(
    vault: &Vault,
    room: Uuid,
    peer: &str,
    id: Uuid,
) -> Result<Option<Arc<StagedFile>>> {
    if vault
        .get::<crate::message_tools::Update>(&format!("updates/{room}/{peer}/{id}/edit"))?
        .is_some_and(|update| update.deleted())
    {
        return Ok(None);
    }
    let Some(record) = vault.get::<Record>(&received_key(room, id, peer))? else {
        return Ok(None);
    };
    let path = received_directory(vault, room).join(format!("{}.bin", record.context));
    let expected = record.offer.size + record.offer.size.div_ceil(CHUNK) * 40;
    if !std::fs::metadata(&path).is_ok_and(|meta| meta.len() == expected) {
        return Ok(None);
    }
    Ok(Some(Arc::new(StagedFile {
        path,
        key: Zeroizing::new(record.key),
        size: record.offer.size,
        context: record.context,
        _temp: None,
        durable: AtomicBool::new(true),
    })))
}
/// Revoke Ochat's encrypted snapshot and key, leaving user-exported copies alone.
pub(super) fn remove_message_media(
    vault: &Vault,
    room: Uuid,
    peer: &str,
    id: Uuid,
    own: bool,
) -> Result<()> {
    let mut keys = vec![(
        received_key(room, id, peer),
        received_directory(vault, room),
    )];
    if own {
        keys.push((
            format!("send_file/{room}/{id}"),
            vault
                .directory()
                .join("file-staging")
                .join(room.to_string()),
        ));
    }
    for (key, folder) in keys {
        if let Some(value) = vault.get::<serde_json::Value>(&key)? {
            vault.delete_prefix(&key)?;
            // A reader may still hold a Windows file handle. The signed tombstone
            // and revoked key remain authoritative even if physical cleanup waits.
            if let Ok(record) = serde_json::from_value::<Record>(value) {
                let _ = std::fs::remove_file(folder.join(format!("{}.bin", record.context)));
            }
        }
    }
    Ok(())
}
pub(super) fn restore(
    vault: &Vault,
    room: Uuid,
    value: serde_json::Value,
) -> Result<(FileOffer, OfferedSource)> {
    if value.is_array() {
        let (offer, path): (FileOffer, PathBuf) = serde_json::from_value(value)?;
        offer.validate()?;
        return Ok((offer, OfferedSource::Legacy(path)));
    }
    let record: Record = serde_json::from_value(value)?;
    ensure!(record.version == 2, "Unsupported file snapshot");
    record.offer.validate()?;
    let path = vault
        .directory()
        .join("file-staging")
        .join(room.to_string())
        .join(format!("{}.bin", record.context));
    let expected = record.offer.size + record.offer.size.div_ceil(CHUNK) * 40;
    ensure!(
        std::fs::metadata(&path)?.len() == expected,
        "Encrypted file snapshot is incomplete"
    );
    let stage = StagedFile {
        path,
        key: Zeroizing::new(record.key),
        size: record.offer.size,
        context: record.context,
        _temp: None,
        durable: AtomicBool::new(true),
    };
    Ok((record.offer.clone(), OfferedSource::Stage(Arc::new(stage))))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn immutable_snapshot_survives_same_size_replacement_and_in_transfer_change() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source");
        let original = vec![b'A'; CHUNK as usize * 3 + 17];
        std::fs::write(&source, &original).unwrap();
        let (stage, size, hash) = StagedFile::capture(&source, None, Uuid::new_v4()).unwrap();
        assert_eq!(size, original.len() as u64);
        assert_eq!(hash, blake3::hash(&original).to_hex().to_string());
        std::fs::write(&source, vec![b'B'; original.len()]).unwrap();
        let first = stage.read_at(0).unwrap();
        assert_eq!(&*first, &original[..CHUNK as usize]);
        std::fs::write(&source, vec![b'C'; original.len()]).unwrap();
        let mut result = first.to_vec();
        while result.len() < original.len() {
            result.extend_from_slice(&stage.read_at(result.len() as u64).unwrap());
        }
        assert_eq!(result, original);
        let encrypted = std::fs::read(&stage.path).unwrap();
        assert!(!encrypted.windows(64).any(|v| v == [b'A'; 64]));
        assert_eq!(
            stage.prefix_hash(CHUNK + 123).unwrap(),
            blake3::hash(&original[..CHUNK as usize + 123])
                .to_hex()
                .to_string()
        );
    }
    #[test]
    fn streamed_writes_seal_uneven_input_into_readable_chunks() {
        let dir = tempfile::tempdir().unwrap();
        let original: Vec<u8> = (0..CHUNK as usize * 2 + 1234).map(|i| i as u8).collect();
        let mut writer = StageWriter::create(dir.path()).unwrap();
        let path = writer.stage.path.clone();
        for piece in original.chunks(777) {
            writer.append(piece).unwrap();
        }
        let stage = writer.finish().unwrap();
        assert_eq!(stage.size(), original.len() as u64);
        assert_eq!(
            stage.read_range(CHUNK - 5, CHUNK as usize + 9).unwrap(),
            original[CHUNK as usize - 5..CHUNK as usize * 2 + 4]
        );
        assert_eq!(stage.read_range(0, usize::MAX).unwrap(), original);
        let encrypted = std::fs::read(&path).unwrap();
        assert!(!encrypted.windows(64).any(|v| v == &original[..64]));
        drop(stage);
        assert!(!path.exists());
    }
    #[test]
    fn abandoned_stream_leaves_no_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let mut writer = StageWriter::create(dir.path()).unwrap();
        writer.append(&[7; 100]).unwrap();
        let path = writer.stage.path.clone();
        assert!(path.exists());
        drop(writer);
        assert!(!path.exists());
    }
    #[test]
    fn snapshot_tampering_is_rejected_and_ephemeral_ciphertext_is_cleaned() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source");
        std::fs::write(&source, b"sensitive bytes").unwrap();
        let (stage, _, _) = StagedFile::capture(&source, None, Uuid::new_v4()).unwrap();
        let path = stage.path.clone();
        let mut bytes = std::fs::read(&path).unwrap();
        bytes[25] ^= 1;
        std::fs::write(&path, bytes).unwrap();
        assert!(stage.read_at(0).is_err());
        drop(stage);
        assert!(!path.exists());
    }
    #[test]
    fn snapshot_restores_without_original_source_and_is_cleaned_on_room_purge() {
        let dir = tempfile::tempdir().unwrap();
        let (vault, recovery) =
            Vault::create(&dir.path().join("account"), "Test", "testing password 123").unwrap();
        let room = Uuid::new_v4();
        let id = Uuid::new_v4();
        let source = dir.path().join("source");
        std::fs::write(&source, b"original").unwrap();
        let directory = vault
            .directory()
            .join("file-staging")
            .join(room.to_string());
        let (stage, size, hash) = StagedFile::capture(&source, Some(&directory), id).unwrap();
        let channel = Uuid::new_v4();
        let offer = FileOffer {
            id,
            channel: Some(channel),
            name: "source".into(),
            size,
            hash,
        };
        stage.persist(&vault, room, &offer).unwrap();
        drop(stage);
        std::fs::remove_file(source).unwrap();
        let value = vault
            .get::<serde_json::Value>(&format!("send_file/{room}/{id}"))
            .unwrap()
            .unwrap();
        let (_, OfferedSource::Stage(stage)) = restore(&vault, room, value).unwrap() else {
            panic!()
        };
        assert_eq!(&*stage.read_at(0).unwrap(), b"original");
        let backup = dir.path().join("export.ochat-backup");
        vault.export(&backup).unwrap();
        let restored = dir.path().join("restored");
        Vault::import(
            &restored,
            &backup,
            &recovery,
            "restored password 123",
            false,
        )
        .unwrap();
        let restored = Vault::unlock(&restored, "restored password 123").unwrap();
        assert!(
            restored
                .list::<serde_json::Value>("send_file/")
                .unwrap()
                .is_empty()
        );
        assert!(!restored.directory().join("file-staging").exists());
        vault
            .apply_channel_catalogue(room, &crate::channels::Catalogue::default(), Some(channel))
            .unwrap();
        assert!(
            vault
                .get::<serde_json::Value>(&format!("send_file/{room}/{id}"))
                .unwrap()
                .is_none()
        );
        assert!(!stage.path.exists());
        vault.purge_room(room).unwrap();
        assert!(!directory.exists());
    }
}
