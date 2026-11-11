# Local account recovery, recent friends and voice-message deletion

## Account recovery

The locked login screen now has **Forgot password?** with two paths:

- **Use my recovery key** verifies the supplied 256-bit root against an authenticated encrypted record in the existing account. It then wraps the same root with a new Argon2id-derived password key and fresh salt/nonce. The new header replaces the old header through the existing private-file/rename mechanism. The database, identity, contacts, rooms, media keys and recovery key are retained. No old password or backup archive is needed when the original local data remains available. Recovery does not connect to peers or announce presence; the user then unlocks with the new password.
- **Start over** requires an acknowledgement and the exact phrase `DELETE MY ACCOUNT`. A one-use native token expires after five minutes and binds to the current encrypted account header, preventing stale confirmation from deleting a replaced account. Reset requires a locked profile, holds the interprocess account lock, confines filesystem operations to the canonical account folder, refuses linked account roots/headers, and removes nested links rather than their targets. Header removal is delayed until other data has been removed so a failed filesystem deletion can be retried.

Wrong keys, invalid passwords, missing data and concurrent account use fail before replacing the password header. Key verification uses the encrypted name record with bounded lengths, not merely the recovery key's typo checksum. Secrets are cleared from the recovery interface on navigation/closure; native input and root buffers use the existing zeroization primitives. The new commands remain confined to the trusted main window by the central command-origin guard.

A recovery key does not reconstruct missing files. Missing/damaged local data still needs an encrypted backup. Reset affects this device's account directory, including locally held media and internal backups; exported backups/downloads elsewhere and other participants' copies remain independent. File deletion does not promise forensic erasure from SSDs, snapshots or prior backups. The standard library's documented link behavior is described in [Rust's remove_dir_all documentation](https://doc.rust-lang.org/std/fs/fn.remove_dir_all.html).

## Friends

**Recent conversations** appears above Online/Offline and is ordered by the latest sent or received private exchange. A small encrypted timestamp hint persists the order and backfills earlier history once. Replayed file offers retain their original time. Group activity does not reorder friends; search, presence and actions remain available. Existing row nodes are moved to retain keyboard focus. Clearing history, forgetting a conversation and locking clear the corresponding recency state.

## Voice messages

Own voice notes support **right-click → Delete message…**, using the same signed author-only deletion update as text. Other participants cannot delete the author's recording. A deleted recording becomes a tombstone, stops current playback, revokes its local Blob and in-app media access, removes stored snapshot keys, and refuses subsequent downloads/replayed offers. Deleted media cannot return through offline synchronization or restart. Externally saved copies remain independent. This does not change the wire protocol or introduce broader moderation privileges.

## Validation performed

- **298 frontend tests passed**, including account recovery, destructive confirmation, stale responses, password visibility, live/saved friend ordering, unchanged row identity/focus, private-versus-group activity, voice context actions and stopped/revoked playback.
- **131 core unit tests passed**; the normal five external-service probes remained ignored. Coverage includes wrong-key rejection without modifying header/database bytes, identity/history preservation, password replacement, reset freshness, filesystem scoping, and real Windows junction fixtures proving linked targets are preserved.
- **11 relevant core integration tests passed** across media, message tools, offline ordering, voice deletion, voice recording and conversation removal. They cover unauthorized deletion rejection, offline tombstones, snapshot revocation, replay rejection and restart behavior.
- **Two native command-boundary tests passed**, plus the Windows native compile check, Rust formatting and whitespace checks.
- **Eight locked-login visual flows passed**: light/dark at 480, 780, 1180 and 1600 pixels, including scrolling/reachable actions at 480 × 520. These use synthetic IPC and never access or delete a real profile.

The account tests used disposable profiles only. Native macOS/Linux builds and physical-device testing were not run for these changes. Version and protocol stay unchanged; publication is not part of this work.

## Private sidebar follow-up

The **Private** conversation list now promotes a direct chat when a new sent or received message arrives, independently of whether the Friends card view has been loaded. A fresh private attachment can promote its chat through the persisted native activity timestamp; replayed offers do not. Promotion uses the existing encrypted conversation-layout save queue, so the order survives restart. Pins remain first, group-room order stays intact, and manual ordering remains effective until another new exchange. Duplicate messages do not undo a manual move. Moving a focused private tab preserves its node and keyboard focus; the current chat, draft and voice connection remain unchanged.

Follow-up validation: 300 frontend tests passed, plus eight real-browser synthetic Private sidebar layouts at 480, 780, 1180 and 1600 pixels in light/dark. Tests target the visible sidebar rather than only Friends cards, and cover saved order, pins, new sent/received messages, duplicates, manual reordering, focus, drafts and active voice. This fix changes frontend ordering only; no protocol, account format or version change was made.

## Friend-row primary action follow-up

Clicking an accepted friend's name/header or empty row area now opens their private conversation through the same `open_direct` flow as the Message icon. The primary button is labeled “Message [name]” and supports Enter/Space. **View profile** remains available as a separate action under the row's three-dot menu. Pending request rows continue to open contact details and retain Accept/Decline/Retry. Interactive secondary controls do not trigger the row's conversation action, and a shared busy guard prevents duplicate opens.

Validation: 301 frontend tests passed. Four additional real-browser flows (light/dark at 480 and 1180 pixels) exercise name click, row-padding click, keyboard Enter, and the separate View profile action using synthetic IPC only. The protocol and native account/connection code are unchanged.

Release follow-up: the feature checks above were performed on local 0.0.6 development builds. These additions are packaged in 0.0.7. Full functional suites are not rerun by the publication workflow; version, source, native build and artifact-integrity checks remain enabled.
