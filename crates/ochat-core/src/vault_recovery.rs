//! Recovery never replaces data or identity. Reset operates only on a locked, identified profile.
use super::*;

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn profile_directory(directory: &Path) -> Result<PathBuf> {
    let metadata = fs::symlink_metadata(directory).context("Local account data is missing")?;
    ensure!(
        metadata.is_dir() && !is_link(&metadata),
        "The account directory must be a real folder, not a link"
    );
    let canonical = directory.canonicalize()?;
    ensure!(
        canonical.file_name().is_some() && canonical.parent().is_some(),
        "Refusing to reset a filesystem root"
    );
    let header = fs::symlink_metadata(canonical.join("profile.json"))?;
    ensure!(
        header.is_file() && !is_link(&header),
        "Invalid local account header"
    );
    read_header(&canonical)?;
    Ok(canonical)
}

impl Vault {
    /// Authenticate the supplied root against an existing encrypted account record before rewrapping it.
    pub fn recover_password(directory: &Path, recovery: &str, password: &str) -> Result<()> {
        password_valid(password)?;
        let root = parse_recovery_key(recovery)?;
        let _directory = profile_directory(directory)?;
        let lock = lock_profile(directory)?;
        let header = read_header(directory)?;
        let database = fs::symlink_metadata(directory.join("vault.sqlite"))
            .context("Encrypted account data is missing. Import a backup instead")?;
        ensure!(
            database.is_file() && !is_link(&database),
            "Invalid encrypted account database"
        );
        let db = Connection::open_with_flags(
            directory.join("vault.sqlite"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        let vault = Self {
            key: Zeroizing::new(derive(&root, header.profile.as_bytes(), b"ochat/v2/vault")),
            root,
            profile: header.profile,
            directory: directory.into(),
            db: Mutex::new(db),
            index: Mutex::new(None),
            _lock: lock,
        };
        // The identity check needs only the small name record, never arbitrary database blobs.
        use rusqlite::OptionalExtension;
        let record_id = vault.storage_id("profile/name");
        let bounds: Option<(i64, i64)> = vault
            .db
            .lock()
            .unwrap()
            .query_row(
                "SELECT length(nonce),length(data) FROM objects WHERE id=?1",
                params![record_id.as_slice()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        ensure!(
            matches!(bounds, Some((24, 16..=4096))),
            "This recovery key does not match the local account, or its encrypted data is damaged"
        );
        let name = vault
            .get::<String>("profile/name")
            .context(
                "This recovery key does not match the account, or its encrypted data is damaged",
            )?
            .context("This recovery key does not match the local account")?;
        crate::protocol::clean_name(&name)?;
        vault.rewrap_password(password)
    }

    /// Public ciphertext fingerprint; no secret or decrypted profile information is returned.
    pub fn reset_fingerprint(directory: &Path) -> Result<[u8; 32]> {
        let _lock = lock_profile(directory)?;
        let canonical = profile_directory(directory)?;
        Ok(*blake3::hash(&read_bounded(&canonical.join("profile.json"), 4095)?).as_bytes())
    }

    /// The caller must obtain explicit destructive confirmation. Does not affect external exports.
    pub fn reset_local(directory: &Path, expected: [u8; 32]) -> Result<()> {
        let _lock = lock_profile(directory)?;
        let canonical = profile_directory(directory)?;
        let header = read_bounded(&canonical.join("profile.json"), 4095)?;
        ensure!(
            bool::from(blake3::hash(&header).as_bytes().ct_eq(&expected)),
            "The account changed. Open the reset confirmation again"
        );
        let parent = canonical.parent().context("Invalid account directory")?;
        let removed = parent.join(format!(".ochat-reset-{}", Uuid::new_v4()));
        ensure!(
            removed.parent() == Some(parent) && !removed.exists(),
            "Invalid reset destination"
        );
        // Both resolved paths are confined to the original account's parent. No UI path is accepted.
        fs::rename(&canonical, &removed)
            .context("The account folder is in use. Close other apps and retry")?;
        let deletion: Result<()> = (|| {
            ensure!(
                !is_link(&fs::symlink_metadata(&removed)?),
                "The reset folder changed"
            );
            ensure!(
                removed.canonicalize()? == removed,
                "The reset folder moved outside its account location"
            );
            for entry in fs::read_dir(&removed)? {
                let entry = entry?;
                if entry.file_name() == "profile.json" {
                    continue;
                }
                let kind = entry.file_type()?;
                if kind.is_dir() || kind.is_symlink() {
                    // std::fs::remove_dir_all removes symlinks themselves, never their targets.
                    fs::remove_dir_all(entry.path())?;
                } else {
                    fs::remove_file(entry.path())?;
                }
            }
            fs::remove_file(removed.join("profile.json"))?;
            fs::remove_dir(&removed)?;
            Ok(())
        })();
        if let Err(failure) = deletion {
            // Keep the confirmation route available after a partial filesystem failure.
            if removed.exists() {
                if !removed.join("profile.json").exists() {
                    let _ = write_private(&removed.join("profile.json"), &header);
                }
                fs::rename(&removed, &canonical).context("Account reset was interrupted. Close Ochat and check the local account folder before continuing")?;
            }
            return Err(failure.context(
                "Some local files could not be removed. Close apps using them and retry the reset",
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const PASSWORD: &str = "original password 123";
    const NEW: &str = "replacement password 456";
    #[test]
    fn recovery_preserves_identity_and_records_and_rejects_wrong_keys_without_changes() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("account");
        let (vault, key) = Vault::create(&dir, "Alice", PASSWORD).unwrap();
        vault.put("history/example", &"private message").unwrap();
        let identity = vault.identity().public();
        let (_, wrong) = Vault::create(&temp.path().join("other"), "Other", PASSWORD).unwrap();
        assert!(
            Vault::recover_password(&dir, &key, NEW).is_err(),
            "an unlocked account cannot be recovered concurrently"
        );
        drop(vault);
        let before = fs::read(dir.join("profile.json")).unwrap();
        let database = fs::read(dir.join("vault.sqlite")).unwrap();
        assert!(Vault::recover_password(&dir, &wrong, NEW).is_err());
        assert!(Vault::recover_password(&dir, "not a key", NEW).is_err());
        assert!(Vault::recover_password(&dir, &key, "short").is_err());
        assert_eq!(before, fs::read(dir.join("profile.json")).unwrap());
        assert_eq!(database, fs::read(dir.join("vault.sqlite")).unwrap());
        Vault::recover_password(&dir, &key, NEW).unwrap();
        assert!(Vault::unlock(&dir, PASSWORD).is_err());
        let recovered = Vault::unlock(&dir, NEW).unwrap();
        assert_eq!(recovered.identity().public(), identity);
        assert_eq!(
            recovered.get::<String>("history/example").unwrap().unwrap(),
            "private message"
        );
        assert_eq!(recovered.reveal_key(NEW).unwrap(), key);
    }
    #[test]
    fn reset_requires_current_header_and_removes_only_the_account() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("account");
        let (vault, _) = Vault::create(&dir, "Alice", PASSWORD).unwrap();
        assert!(Vault::reset_fingerprint(&dir).is_err());
        drop(vault);
        let old = Vault::reset_fingerprint(&dir).unwrap();
        let vault = Vault::unlock(&dir, PASSWORD).unwrap();
        vault.change_password(PASSWORD, NEW).unwrap();
        drop(vault);
        assert!(Vault::reset_local(&dir, old).is_err());
        let sentinel = temp.path().join("export.ochat-backup");
        fs::write(&sentinel, b"external export").unwrap();
        let fingerprint = Vault::reset_fingerprint(&dir).unwrap();
        fs::create_dir_all(dir.join("file-staging").join("room")).unwrap();
        fs::write(
            dir.join("file-staging").join("room").join("media.bin"),
            b"encrypted media",
        )
        .unwrap();
        Vault::reset_local(&dir, fingerprint).unwrap();
        assert!(!dir.exists());
        assert_eq!(fs::read(&sentinel).unwrap(), b"external export");
        let (fresh, _) = Vault::create(&dir, "New account", NEW).unwrap();
        assert_eq!(
            fresh.get::<String>("profile/name").unwrap().unwrap(),
            "New account"
        );
        assert!(
            Vault::reset_fingerprint(temp.path()).is_err(),
            "arbitrary directories cannot be reset"
        );
    }
    #[cfg(windows)]
    #[test]
    fn reset_rejects_profile_junctions_and_preserves_nested_junction_targets() {
        fn junction(link: &Path, target: &Path) {
            let result = std::process::Command::new("cmd.exe")
                .args(["/D", "/C", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "Could not create the synthetic junction fixture"
            );
        }
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("account");
        let (vault, _) = Vault::create(&dir, "Alice", PASSWORD).unwrap();
        drop(vault);
        let outside = temp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("keep"), b"keep").unwrap();
        let alias = temp.path().join("alias");
        junction(&alias, &dir);
        assert!(Vault::reset_fingerprint(&alias).is_err());
        junction(&dir.join("linked-folder"), &outside);
        Vault::reset_local(&dir, Vault::reset_fingerprint(&dir).unwrap()).unwrap();
        assert_eq!(fs::read(outside.join("keep")).unwrap(), b"keep");
    }
    #[cfg(unix)]
    #[test]
    fn reset_never_follows_links_outside_the_profile() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("account");
        let (vault, _) = Vault::create(&dir, "Alice", PASSWORD).unwrap();
        drop(vault);
        let external = temp.path().join("outside");
        fs::create_dir(&external).unwrap();
        fs::write(external.join("keep"), b"keep").unwrap();
        let alias = temp.path().join("alias");
        symlink(&dir, &alias).unwrap();
        assert!(Vault::reset_fingerprint(&alias).is_err());
        symlink(&external, dir.join("linked-folder")).unwrap();
        Vault::reset_local(&dir, Vault::reset_fingerprint(&dir).unwrap()).unwrap();
        assert!(external.join("keep").exists());
    }
}
