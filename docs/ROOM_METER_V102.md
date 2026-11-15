# X32 AI Engineer — Room Mic Meter & AI Context (release candidate 102)

- **Existing live release:** 99, version `4ddc2b39-705d-49e7-bc29-6620510d0371` (rollback).
- **New Cloudflare Worker version:** 102, `656b8236-7efa-43ab-92af-ae5f465e51ef`.
- X32 room microphone identified by operator as **CH28, physical Input 15**. **This does not prove Dante route**. The initial DVS Receive 3–4 guess remains unverified.
- Optional **Use Room Mic** (off by default) shows continuous local browser audio meter with dBFS and a live bar. It also offers a DVS device and left/right lane selector; the user can confirm audio responds when speaking near CH28.
- The meter follows whichever room mic toggle was clicked: single Speaking/Singing Check EQ or multi-vocal Check EQ.
- When enabled, both workflows use the SAME live room stream to include an 8–12 s room recording with each channel's direct vocal recording.
- AI prompts now REQUIRE a distinct roomAssessment: audibleRoomObservations, impactOnEQ and limitations. Missing assessment returns an error and prevents new EQ suggestions, rather than claiming it used room audio.
- For speaking, ambient room clarity and reverb may inform suggested vocal EQ as context.
- For live worship, the room captures the **whole mix**: its observations are contextual only; isolated singer EQ must remain primarily based on that singer's direct microphone.
- The user still independently approves every mixer Apply. No X32 routing, Dante source mapping, local Python bridge, or existing EQ configuration was changed.
- Both pre/post-EQ taps and identity of the actual Dante room feed are **unverified**; a moving meter confirms a signal, not its microphone provenance.

Verification: version 102 compiled on Cloudflare; all 19 dashboard JavaScript script blocks parsed; 12/12 source/configuration checks passed. Actual mic capture and multi-input AI response require an on-site test.

Files: `web/room-meter-v100.js`, `web/multi-vocal-panel.js`.
