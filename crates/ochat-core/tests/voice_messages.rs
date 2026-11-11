use ochat_core::{ChatNode, StoredMedia, settings::Settings, vault::Vault, voice_message};
use std::{sync::Arc, time::Duration};
use tokio::time::{sleep, timeout};

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn memory_recording_is_transferred_verified_and_retained_encrypted() {
    for capacity in [2, 4] {
        let dir = tempfile::tempdir().unwrap();
        let (vault, _) =
            Vault::create(dir.path(), "Listener", "voice message test password").unwrap();
        let vault = Arc::new(vault);
        vault
            .put(
                "profile/settings",
                &Settings {
                    relay_enabled: false,
                    ..Default::default()
                },
            )
            .unwrap();
        let sender = ChatNode::start("Speaker", false).await.unwrap();
        let receiver = ChatNode::start_with_vault(vault.clone()).await.unwrap();
        let invitation = sender.create_room("Voice notes", capacity).await.unwrap();
        receiver.join(&invitation).await.unwrap();
        let room = sender.snapshot().room.unwrap().id;
        let channel = sender.snapshot().text_channel;
        let bytes = voice_message::encode_wav(
            &(0..48_000)
                .map(|i| ((i as f32) / 10.0).sin() * 0.2)
                .collect::<Vec<_>>(),
        )
        .unwrap();
        assert!(
            sender
                .offer_voice_message(channel, b"not a recording".to_vec())
                .await
                .is_err()
        );
        let offer = sender
            .offer_voice_message(channel, bytes.clone())
            .await
            .unwrap();
        assert_eq!(offer.channel, channel);
        assert_eq!(offer.name, "Voice message.wav");
        assert_eq!(offer.hash, blake3::hash(&bytes).to_hex().to_string());
        assert_eq!(
            sender
                .read_offered_file(offer.id, 0, bytes.len())
                .unwrap()
                .unwrap()
                .1,
            bytes
        );
        timeout(Duration::from_secs(10), async {
            while receiver.incoming_offer(&sender.id(), offer.id).is_err() {
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        receiver
            .receive_media(&sender.id(), offer.id)
            .await
            .unwrap();
        receiver.leave().await;
        let stored = StoredMedia::open(&vault, room, &sender.id(), offer.id)
            .unwrap()
            .unwrap();
        assert_eq!(stored.read(0, bytes.len()).unwrap().1, bytes);
        let folder = vault
            .directory()
            .join("received-media")
            .join(room.to_string());
        for entry in std::fs::read_dir(folder).unwrap() {
            let ciphertext = std::fs::read(entry.unwrap().path()).unwrap();
            assert!(!ciphertext.windows(44).any(|window| window == &bytes[..44]));
        }
        sender.leave().await;
    }
}
