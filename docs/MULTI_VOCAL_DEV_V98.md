# Multi-channel AI vocal analysis — development preview

## Build and rollback
- Known-good production remains Worker `x32-ai-engineer-church` **version 96**, ID `b4704aef-a811-48db-949c-9484b0793022` (not redeployed).
- Current **non-deployed development version 98**, ID `f0abf328-698f-482f-a725-afa73685021f`.
- Version URL: `https://f0abf328-x32-ai-engineer-church.globalconnectionschurch.workers.dev/` (requires Cloudflare Access authorization).
- Existing Windows Python bridge is completely untouched. Physical X32 routing and EQ were not changed.
- Source UI for this stage: `web/multi-vocal-panel.js`.
- This is not a complete live audio or hardware validation. Testing requires actual DVS and X32 input signals.

## New experience
- Pick **1–6 microphones** from the ten previously mapped Dante X32 channels: 1–6, 13–16.
- Capture each selected microphone through its own DVS receive pair/lane at the same time (no mixed recordings).
- 12-second audio segment per channel after signal activity is detected.
- Insufficient activity means wait up to 75 seconds for a better clip, rather than submitting silence. Signal energy cannot reliably identify singer vs backing instruments; the OpenAI audible-vocal assessment and confidence checks must still be respected.
- **Stop Listening** on multi and both existing single Check EQ Speaking / Check EQ Singing paths. Cancels recording and requests without mixer changes.
- Separate AI results per mic, each with modeled **red=current, green=suggested** EQ overlay.
- Independent Apply buttons with explicit channel confirmation, a fresh X32 EQ/HPF readback comparison, and verified readback after any approved write.
- No automatic EQ writes in multi mode. Live EQ and old single-channel functionality are preserved.
- Rate limiting is scoped to the selected channel in development so concurrent checks do not block one another.
- Actual pre-EQ and post-EQ tap identities remain **unverified**. No true room or post-EQ audio validation is claimed.

## Validation performed
- Cloudflare Worker version uploaded and compiled successfully.
- All 18 inline dashboard JavaScript blocks syntax-checked with a JS parser.
- Nine source/configuration/rollback checks passed.
- **Not tested with live microphones, physical mixer or post-EQ listening.**
