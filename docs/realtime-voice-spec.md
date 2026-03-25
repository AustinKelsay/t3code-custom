# Realtime Voice Chat Spec

## Status

- Branch: `feature/realtime-voice-chat`
- Date: 2026-03-24
- Scope: implementation spec for the voice system as it exists in this branch

## Goal

Make T3 Code feel like a live voice coding chat without replacing the existing thread and provider architecture.

The shipped design is:

- OpenAI Realtime handles browser mic input and transcription.
- Durable thread turns still go through normal orchestration.
- Assistant readback is driven from the authoritative streamed assistant text.
- Assistant readback audio is synthesized with OpenAI TTS, not browser `speechSynthesis`.
- Voice is available for all providers.

## Product Behavior

### Input

When the user taps the mic button in the chat composer:

1. The browser requests or reuses microphone permission.
2. The app mints a short-lived OpenAI Realtime client secret through `apps/server`.
3. The browser opens a Realtime WebRTC session.
4. The user speaks.
5. Live transcript text is shown locally while listening.
6. When the utterance is finalized, the transcript is submitted through the existing `thread.turn.start` path.

Voice input is off by default on app boot. It only becomes active after the user explicitly starts listening.

### Output

Assistant speech is not generated directly from the Realtime input session.

Instead:

1. The authoritative assistant message streams into the normal chat UI.
2. The web app segments the streamed text into sentence-like chunks.
3. Those chunks are sent to the server TTS endpoint.
4. The server calls OpenAI `v1/audio/speech`.
5. The browser plays the returned audio and continues sentence-by-sentence.

This means the spoken output follows the real Codex/Claude response rather than a separate provisional answer path.

### Handoff Rules

- Input listening and output playback are separate concerns.
- While spoken output is playing, the app pauses input listening.
- After playback finishes, the app can re-arm listening according to the current chat control state.
- Stop means stop listening. The app should not keep a hidden hot mic running.

## Architecture

There are three distinct paths:

1. Realtime input path
2. Durable orchestration path
3. TTS output path

### Realtime Input Path

- Browser requests a client secret from `apps/server`.
- `apps/server` validates the thread and calls `POST /v1/realtime/client_secrets`.
- Browser connects directly to OpenAI Realtime over WebRTC.
- Local voice UI state lives in the web app only.

### Durable Orchestration Path

- Finalized transcript is turned into a normal user message.
- The thread turn is started through the existing orchestration command path.
- Provider streaming, activities, approvals, and persisted messages remain unchanged.

### TTS Output Path

- The browser watches the authoritative streamed assistant text.
- Sentence chunks are queued locally.
- The browser calls `api.voice.synthesizeSpeech(...)`.
- The server calls OpenAI `v1/audio/speech` with the configured voice, model, and instructions.
- Returned audio is played through a dedicated browser audio element.

## Why It Was Built This Way

This split was chosen because it matches the repo constraints better than trying to use one Realtime session for everything.

Benefits:

- durable chat logic stays in existing orchestration
- voice stays mostly isolated in new files
- provider behavior does not need to be reworked
- audio output quality is better than browser `speechSynthesis`
- upstream merge risk is lower because core files only have thin integration changes

## Current UX

### Chat Footer Controls

The bottom composer uses a compact grouped voice control.

Current controls:

1. mic button
2. speaker mute/unmute button
3. speed button
4. skip button

Notes:

- The old large footer voice panels were removed to keep the composer compact.
- The mic button is icon-only.
- The old inline `Voice`, `Listening`, and `Ready` labels were removed.
- Mobile tap targets are intentionally larger than desktop.

### Header

The thread header still includes a compact voice status badge.

### Transcript Preview

The app can still surface transcript preview while listening, but the composer area was intentionally simplified so voice UI does not dominate the chat footer.

## Settings

Voice settings live in the chat settings screen and also partially in the chat footer.

Current settings:

- `voiceEnabled`
- `voiceAutoSpeakReplies`
- `voiceModel`
- `voiceName`
- `voicePlaybackRate`
- `voiceInstructions`

Current defaults:

- `voiceEnabled = true`
- `voiceAutoSpeakReplies = true`
- `voiceModel = ""`
- `voiceName = ""`
- `voicePlaybackRate = "1.5"`
- `voiceInstructions = "Speak in a motivating, friendly, natural tone. Keep delivery clear, conversational, and concise without sounding robotic."`

### Voice Name

The settings page exposes a curated set of OpenAI voice names:

- `alloy`
- `ash`
- `ballad`
- `cedar`
- `coral`
- `echo`
- `fable`
- `marin`
- `nova`
- `onyx`
- `sage`
- `shimmer`
- `verse`

### Voice Speed

Voice speed options currently supported:

- `0.75x`
- `1.0x`
- `1.25x`
- `1.5x`
- `1.75x`
- `2.0x`

The settings page exposes the full control, and the chat footer includes an inline speed button for fast adjustment in-thread.

### Voice Instructions

The user can provide voice style instructions that are passed to OpenAI TTS. This is intended for tone and delivery preferences rather than content changes.

### OpenAI Usage Link

The settings page includes a link back to OpenAI usage so token and cost consumption can be checked directly in the platform UI.

## File Layout

### Shared Contracts

- [voice.ts](/home/clawd/code/t3code/packages/contracts/src/voice.ts)
- [ipc.ts](/home/clawd/code/t3code/packages/contracts/src/ipc.ts)
- [ws.ts](/home/clawd/code/t3code/packages/contracts/src/ws.ts)

### Server

- [RealtimeTokenService.ts](/home/clawd/code/t3code/apps/server/src/voice/Services/RealtimeTokenService.ts)
- [RealtimeTokenService.ts](/home/clawd/code/t3code/apps/server/src/voice/Layers/RealtimeTokenService.ts)
- [SpeechSynthesisService.ts](/home/clawd/code/t3code/apps/server/src/voice/Services/SpeechSynthesisService.ts)
- [SpeechSynthesisService.ts](/home/clawd/code/t3code/apps/server/src/voice/Layers/SpeechSynthesisService.ts)

### Web Runtime

- [useVoiceSession.ts](/home/clawd/code/t3code/apps/web/src/voice/useVoiceSession.ts)
- [voiceReducer.ts](/home/clawd/code/t3code/apps/web/src/voice/voiceReducer.ts)
- [voiceSessionRegistry.ts](/home/clawd/code/t3code/apps/web/src/voice/voiceSessionRegistry.ts)
- [useRealtimeSpeechOutput.ts](/home/clawd/code/t3code/apps/web/src/voice/useRealtimeSpeechOutput.ts)
- [types.ts](/home/clawd/code/t3code/apps/web/src/voice/types.ts)

### Web UI

- [ChatView.tsx](/home/clawd/code/t3code/apps/web/src/components/ChatView.tsx)
- [ChatHeader.tsx](/home/clawd/code/t3code/apps/web/src/components/chat/ChatHeader.tsx)
- [VoiceControlsGroup.tsx](/home/clawd/code/t3code/apps/web/src/components/chat/VoiceControlsGroup.tsx)
- [VoiceStatusBadge.tsx](/home/clawd/code/t3code/apps/web/src/components/chat/VoiceStatusBadge.tsx)
- [VoiceTranscriptPreview.tsx](/home/clawd/code/t3code/apps/web/src/components/chat/VoiceTranscriptPreview.tsx)
- [LiveVoiceReplyPreview.tsx](/home/clawd/code/t3code/apps/web/src/components/chat/LiveVoiceReplyPreview.tsx)
- [FinalProviderAnswerPreview.tsx](/home/clawd/code/t3code/apps/web/src/components/chat/FinalProviderAnswerPreview.tsx)
- [settings route](/home/clawd/code/t3code/apps/web/src/routes/_chat.settings.tsx)

## Contracts

The shared contract package remains schema-only.

Important schemas in [voice.ts](/home/clawd/code/t3code/packages/contracts/src/voice.ts):

- `VoiceSessionPhase`
- `VoiceRealtimeSessionCreateInput`
- `VoiceRealtimeClientSecret`
- `VoiceSpeechSynthesisInput`
- `VoiceSpeechSynthesisResult`
- `VoiceTranscriptSegment`

The browser-facing API currently includes:

- `voice.realtimeSession.create`
- `voice.synthesizeSpeech`

## Server Details

### Realtime Token Service

The Realtime token service:

- reads `OPENAI_API_KEY`
- validates thread and project existence from the projection snapshot
- selects defaults from env if the user has not overridden them
- requests a Realtime client secret from OpenAI
- returns only ephemeral token data to the browser

Current env defaults:

- `T3CODE_VOICE_MODEL`, default `gpt-realtime`
- `T3CODE_VOICE_NAME`, default `alloy`

Current Realtime session behavior:

- `output_modalities: ["audio"]`
- input transcription via `gpt-4o-mini-transcribe`
- server VAD
- concise instructions oriented around accurate transcription

### Speech Synthesis Service

The TTS service:

- reads `OPENAI_API_KEY`
- validates the target thread
- calls `POST https://api.openai.com/v1/audio/speech`
- returns `audioBase64` plus mime type to the browser

Current env defaults:

- `T3CODE_TTS_MODEL`, default `gpt-4o-mini-tts`
- `T3CODE_VOICE_NAME`, default `alloy`

The request can include:

- model
- voice
- input text
- optional instructions

## Web Runtime Details

### `useVoiceSession`

Responsibilities:

- request a Realtime client secret
- create and manage the input Realtime session
- manage mic permission flow
- expose listening state to the chat UI
- emit final transcript text back into the normal send path

Important rule:

- the app should not start listening on boot
- the input session should only become active after explicit user action

### `useRealtimeSpeechOutput`

Responsibilities:

- observe streamed assistant text chosen for narration
- split text into speakable chunks
- synthesize queued chunks through the server TTS API
- play them in order
- support skipping the current sentence
- apply the configured playback speed to every chunk

Playback-rate handling is intentionally aggressive because browsers may reset rate on new source assignment. The hook reapplies the chosen rate when:

- the audio element is created
- a new audio source is attached
- media readiness events fire
- playback starts
- the user changes speed during a session

## Current Known Tradeoffs

- Startup latency for spoken output is still bounded by a server round-trip plus TTS generation time.
- Playback speed changes make speech shorter once audio starts, but they do not remove synthesis latency.
- The system is optimized for sentence-by-sentence readback, not one giant post-turn summary.
- Realtime input and TTS output are intentionally separate to avoid cross-session hot-mic failures.

## Upstream Merge Safety

This branch intentionally keeps most voice-specific logic in extracted files.

Preferred extension points:

- `apps/web/src/voice/`
- `apps/web/src/components/chat/Voice*`
- `apps/server/src/voice/`
- `packages/contracts/src/voice.ts`

Core files like [ChatView.tsx](/home/clawd/code/t3code/apps/web/src/components/ChatView.tsx) and [wsServer.ts](/home/clawd/code/t3code/apps/server/src/wsServer.ts) should remain thin integration points where possible.

## Acceptance Criteria

The current implementation is considered correct when all of the following are true:

- voice input is off on initial page load
- pressing the mic button starts listening
- final transcript becomes a normal thread turn
- assistant streamed text is read back in a natural OpenAI voice
- skip advances sentence-by-sentence through queued speech
- speed changes affect newly spoken chunks
- stop actually stops listening
- the compact composer controls remain usable on mobile
- settings changes flow through to live voice behavior

## Future Work

Reasonable next steps from the current architecture:

- reduce TTS startup latency with earlier chunking and overlapping synthesis
- add better visual telemetry for active playback speed when debugging browser behavior
- support richer per-thread voice preferences
- support a more conversational duplex mode if the product later moves beyond turn-based orchestration
