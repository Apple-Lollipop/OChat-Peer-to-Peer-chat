# Voice messages — implementation and validation

The composer microphone button starts an explicit native recording. Stop recording opens a local preview with playback controls, Discard and Send. Recordings are limited to three minutes; reaching the limit stops capture and prepares the preview without sending it. Text drafts remain unchanged. Changing conversations or text channels, joining a call, or locking the account discards the recording. Existing calls must end before recording.

## Data path

- CPAL and the existing DSP worker use the saved microphone and audio-processing preferences. Processed 48 kHz mono samples are captured before the live-call transmission gate; quiet words are not removed by that gate. The worker's network output stays muted and is not connected to a peer.
- Capture is bounded in memory. Stop closes the native audio session and creates a PCM16 WAV for compatible playback on Windows, Linux and macOS. No plaintext temporary audio file is created.
- Send binds to the original room and text channel. WAV bytes enter the existing authenticated encrypted staging directly from memory, then use the existing encrypted P2P attachment transport and BLAKE3 verification. No protocol or account-version change is required.
- The receiver presses Play to explicitly receive and listen. Received audio uses encrypted media storage and the existing seeking, volume and Save a copy controls. As with other attachments, the sender must be reachable for the first transfer. An explicitly saved external copy is unencrypted.
- Lock/session guards, recording identifiers, cancellation epochs and the native command-origin boundary prevent late recording responses from reopening a private preview or targeting another conversation. Native sample and retained recording buffers are zeroized when discarded.

## Executed checks

Final results: 284 frontend tests passed; 132 core unit/integration tests passed with five pre-existing live-service probes ignored; two Windows native command-boundary tests passed; eight visual layouts passed. Formatting, whitespace checks and the Windows native compile check passed.

- Frontend tests: recording/stop/preview/send, unchanged draft, channel/call/lock cancellation, late microphone initialization, failed-send retry, Escape, microphone errors, automatic duration limit, and manual receipt/playback.
- Core unit tests, including WAV bounds, malformed-header rejection, processing signals, encrypted snapshots and existing security tests. Five existing live-service probes are intentionally ignored by the normal suite (Tor, public relay, link preview and Risibank).
- Local synthetic P2P transfers in both a two-person conversation and a group: correct channel and hash, sender playback, receiver playback after leaving the room, and ciphertext inspection. Existing file-transfer and three-peer integration tests also pass.
- Windows native command-boundary tests and `cargo check -p ochat --locked`.
- Eight headless Edge layouts: light/dark at 480, 780, 1180 and 1600 pixels. Recording controls and the composer remain inside the viewport, including 480 × 520.

## Still requiring a physical-device check

Record real speech using each platform's microphone permission dialog and selected device, send to another device, replay after restarting, and test device removal. No physical microphone was opened by the automated tests. Linux/macOS native builds and hardware checks were not performed for this change. No release or version bump was made.

## Waveform presentation refinement

The recorder now uses a stable, accent-colored waveform driven by the native microphone level, replacing the browser meter. The local preview and chat bubble have custom play/pause, keyboard-accessible waveform seeking and duration controls. The chat hides the attachment filename and byte count. Volume, save-copy and transfer details remain available under the three-dot disclosure.

Playback envelopes are computed from validated PCM samples only after explicit playback loading; they do not require another microphone or network request. Analysis is bounded to approximately 100,000 sample reads for long recordings. Before the recording has been loaded, the waveform is neutral rather than an invented signal. Progress changes the color of the played bars; motion preferences are respected. The transport, encryption and native capture pipeline are unchanged by this presentation refinement.

Refinement validation: 287 frontend tests passed, including real PCM envelopes, silence, seeking, playback progress and compact controls. The eight visual layouts now also exercise actual playback and seeking of a synthetic WAV in the preview and received-message bubble, with browser output muted and no microphone opened.

Release follow-up: the feature checks above were performed on local 0.0.6 development builds. These additions are packaged in 0.0.7. Full functional suites are not rerun by the publication workflow; version, source, native build and artifact-integrity checks remain enabled.
