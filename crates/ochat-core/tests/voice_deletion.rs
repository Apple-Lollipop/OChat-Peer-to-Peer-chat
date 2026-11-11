use ochat_core::{
    ChatNode, StoredMedia, conversations::MessageRef, message_tools::Change, settings::Settings,
    vault::Vault, voice_message,
};
use std::{sync::Arc, time::Duration};
use tokio::time::{sleep, timeout};
fn account(path: &std::path::Path, name: &str) -> Arc<Vault> {
    let (vault, _) = Vault::create(path, name, "voice deletion test password").unwrap();
    vault
        .put(
            "profile/settings",
            &Settings {
                relay_enabled: false,
                ..Default::default()
            },
        )
        .unwrap();
    Arc::new(vault)
}
async fn eventually(mut f: impl FnMut() -> bool) {
    timeout(Duration::from_secs(15), async {
        while !f() {
            sleep(Duration::from_millis(30)).await;
        }
    })
    .await
    .unwrap();
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn author_deletion_revokes_received_audio_and_survives_offline_sync_and_restart() {
    let temp = tempfile::tempdir().unwrap();
    let av = account(&temp.path().join("alice"), "Alice");
    let bv = account(&temp.path().join("bob"), "Bob");
    let alice = ChatNode::start_with_vault(av.clone()).await.unwrap();
    let bob = ChatNode::start_with_vault(bv.clone()).await.unwrap();
    let invitation = alice.create_room("Voice notes", 4).await.unwrap();
    let room = alice.snapshot().room.unwrap().id;
    bob.join(&invitation).await.unwrap();
    let wav = voice_message::encode_wav(&vec![0.2; 48_000]).unwrap();
    let offer = alice
        .offer_voice_message(alice.snapshot().text_channel, wav)
        .await
        .unwrap();
    eventually(|| bob.incoming_offer(&alice.id(), offer.id).is_ok()).await;
    let reference = MessageRef {
        peer: alice.id(),
        id: offer.id,
    };
    assert!(
        bob.update_message(
            room,
            reference.clone(),
            Change::Edit {
                text: None,
                emojis: vec![]
            }
        )
        .await
        .is_err(),
        "a recipient cannot delete the author's audio"
    );
    assert!(
        !alice
            .history(room)
            .unwrap()
            .iter()
            .any(|entry| entry.event["deleted"] == true)
    );
    bob.receive_media(&alice.id(), offer.id).await.unwrap();
    assert!(
        StoredMedia::open(&bv, room, &alice.id(), offer.id)
            .unwrap()
            .is_some()
    );
    bob.leave().await;
    alice
        .update_message(
            room,
            reference.clone(),
            Change::Edit {
                text: None,
                emojis: vec![],
            },
        )
        .await
        .unwrap();
    assert!(alice.read_offered_file(offer.id, 0, 12).unwrap().is_none());
    assert!(
        alice
            .update_message(
                room,
                reference,
                Change::Edit {
                    text: Some("restore".into()),
                    emojis: vec![]
                }
            )
            .await
            .is_err()
    );
    bob.join(&invitation).await.unwrap();
    eventually(|| {
        bob.history(room).unwrap().iter().any(|entry| {
            entry.event["offer"]["id"] == offer.id.to_string() && entry.event["deleted"] == true
        })
    })
    .await;
    assert!(bob.incoming_offer(&alice.id(), offer.id).is_err());
    assert!(bob.receive_media(&alice.id(), offer.id).await.is_err());
    assert!(
        StoredMedia::open(&bv, room, &alice.id(), offer.id)
            .unwrap()
            .is_none()
    );
    assert!(
        bob.shared_items(room)
            .unwrap()
            .iter()
            .all(|entry| entry.event["offer"]["id"] != offer.id.to_string())
    );
    alice.close().await;
    bob.close().await;
    let restarted = ChatNode::start_with_vault(av).await.unwrap();
    assert!(
        restarted
            .history(room)
            .unwrap()
            .iter()
            .any(|entry| entry.event["offer"]["id"] == offer.id.to_string()
                && entry.event["deleted"] == true)
    );
    restarted.close().await;
}
