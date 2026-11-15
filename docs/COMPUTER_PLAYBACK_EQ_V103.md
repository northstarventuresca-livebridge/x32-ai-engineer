# X32 AI Engineer — Computer Audio EQ, Version 103

**Live baseline before this development:** Cloudflare release V102
`656b8236-7efa-43ab-92af-ae5f465e51ef`.

**Uploaded development Worker:** V103
`bf56274f-b327-47b6-89a7-06f6cffcbe86`.

## Operator-identified mixer assignments
- **Mac playback:** X32 Channel 26, physical mixer Input 5.
- **Windows PC playback:** X32 Channel 27, physical mixer Input 6.
- **Room microphone:** X32 Channel 28, physical mixer Input 15.

These assignments do **not** identify Dante Virtual Soundcard receive streams. Device and L/R lane must be explicitly selected in Chrome and confirmed using a moving meter and captured sample. No routing was modified.

## New UI
- Separate **Computer Audio EQ** panel after the multi-vocal controls.
- Select CH26 Mac or CH27 PC, pick actual DVS receive device and lane, verify that its meter follows source playback.
- Browser saves per-channel device/lane and operator confirmation.
- Play captured sample to verify the recorded source.
- Analyze actual computer program audio (speech, music, videos, etc.) rather than using a singer-only algorithm.
- Optional Use Room Mic, utilizing existing CH28 meter and audio capture; analysis receives separate program and ambient room recordings.
- The AI must explain room observations, whether the computer source is audible in the room and how room audio influenced or did not influence the suggested X32 channel EQ.
- During worship or other full-mix circumstances, room source cannot be attributed to one computer: do not EQ CH26/27 to correct full PA mix or room acoustics.
- Individual modeled red-current/green-suggested EQ overlay and separate Apply button for CH26 or CH27.
- Stop Listening and operator-confirmed per-channel X32 Apply with verified mixer readback; no automatic writes.

## Validation
- Cloudflare Worker uploaded and compiled.
- Existing DVS vocal channels and Room Mic context UI retained.
- All 20 embedded dashboard JS blocks parse.
- Thirteen static routing/safety/feature checks pass.
- Backend guard tests reject wrong channel, bad source kind, mismatched readback, missing room sample and malformed WAV.
- Real Dante/room microphone content and actual room-based AI recommendations still require on-site testing.

No local Windows Python bridge, mixer channel EQ, Dante transmit/receive routes, or physical audio connections changed.
