# X32 AI Engineer — direct microphone vs output vs room (release 108)

Existing live baseline: Cloudflare Worker V104 `20821292-4b3c-4858-9663-3b9a3a4bfbd5`.
New staged / release candidate: Worker V108 `13a36ef6-2f68-4e6c-830d-45e0ad276062`.

## Features
- Single-channel **Check EQ Speaking** and **Check EQ Singing** have a new optional "Compare direct mic with mixer output (after EQ)" option.
- User may select a distinct Dante Virtual Soundcard receive device and left/right lane. Per-X32-channel selection is remembered. A live dBFS meter confirms signal is reaching Chrome; it does not verify mixer post-EQ route.
- Optional **Use Room Mic** keeps known X32 CH28 / physical Input15 captured separately, without needing to repeat the user's existing mic identification.
- Captures direct mic (12 sec) and overlapping separately monitored output (8–12 sec) and room (8–12 sec) where enabled. Never alters existing Dante routing.
- If output mode is selected, uses separate authenticated API `POST /api/ai/direct-output-compare`, sending labeled clips and currently read-back mixer EQ. The AI must explain output differences, source similarity, EQ impact and limitations, plus room observations if included.
- AI reports `outputAssessment` and `roomAssessment` in existing EQ reports and overlay graph. Modeled red current / green suggested EQ is still NOT acoustic output measurement.
- **No Apply** when the output is absent, silent, clipping, same browser device/lane as direct, identical WAV to direct, room and post use the exact same device/lane, model cannot identify same source, numeric EQ is invalid, or operator has not confirmed the post output mapping.
- Manual existing X32 Apply and verified parameter readback retained. No automatic mixer changes and no changes to Windows bridge or Dante routing.
- Direct channel tap and post-output tap positions remain **operator-declared, not verified by querying actual mixer routing**. A distinct post-EQ Dante source must exist to hear real processed channel audio.
- During worship, the room mic hears the complete mix; cannot establish any one singer's processed PA sound.

## Validation
- Worker uploaded/compiled.
- All 21 inline dashboard scripts parse.
- Thirteen integration/configuration checks passed.
- Simulated API tests verified 3-audio success, two-audio fallback, missing output, wrong X32 channel, duplicate input/output file, mismatched post source channel and disabled Apply when output route is unconfirmed.
- No live music/PA/actual signal path test performed.

Source: `web/direct-post-eq-meter.js`, `worker/direct-output-compare.js`, `patches/v105-dashboard-patches.json`. Prior known-good V104 remains available for rollback.
