# X32 AI Engineer — Room Mic Context V99

Production rollback checkpoints:
- Version 96: `b4704aef-a811-48db-949c-9484b0793022` (prior known-good)
- Version 98: `f0abf328-698f-482f-a725-afa73685021f` (multi-vocal release)
- New version 99: `4ddc2b39-705d-49e7-bc29-6620510d0371`

## Feature
- "Use Room Mic" checkbox appears separately in single-channel Check EQ and multi-vocal analysis.
- **Off by default.** Existing Dante direct-microphone workflow is unchanged when disabled.
- When enabled: browser opens **DVS Receive 3–4, channel 3** as *claimed* room source (not independently identified by an actual audio test).
- Records an ambient room excerpt during vocal sampling. Single-channel processing captures a common 8–12 s overlapping excerpt; multi-channel captures a recent approximately synchronized 8–12 s excerpt per selected vocalist.
- The existing backend accepts validated PCM16 WAV room audio and feeds it as a distinct second recording to the audio model.
- For speech: ambient intelligibility/reverb only, never assume post-EQ voice/PA measurement.
- For singing/worship: room audio is the full mix, and may be useful for contextual audibility but **must never be used as an isolated singer EQ reference**.
- If the requested room stream is missing, silent or clipped, fails visibly without fabricating context.
- Stop Listening buttons, manual approval, per-channel mixer verification, and separate multi-channel Apply buttons remain.
- Independent pre/post-EQ taps and physical room signal attribution are **still not verified**. Capturing claimed room DVS audio does not prove acoustics of an individual processed vocal.

## Validation
- Cloudflare version 99 uploaded, Worker compiled, required KV and OpenAI bindings retained.
- All 18 dashboard JavaScript blocks parse with JavaScript syntax checks.
- Validated room-toggle source, room-audio parsing, multi-audio model payload, safety instruction text, room quality metadata, and version 98 rollback ID.
- Not tested using actual church Dante input or physical speakers. Test after deployment with one speaker and then during worship.

No Windows Python bridge, routing, or mixer settings were changed.
