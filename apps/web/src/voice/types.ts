import type { VoiceSessionPhase } from "@t3tools/contracts";

export interface VoiceUiState {
  phase: VoiceSessionPhase;
  transcriptPreview: string;
  errorMessage: string | null;
  permissionState: "unknown" | "prompt" | "granted" | "denied" | "unsupported";
  liveReplyPhase: "idle" | "speaking" | "complete";
  liveReplyTranscript: string;
}

export type VoiceUiAction =
  | { type: "connect_requested" }
  | { type: "connect_succeeded" }
  | { type: "permission_state_changed"; permissionState: VoiceUiState["permissionState"] }
  | { type: "listening_started" }
  | { type: "transcript_delta"; delta: string }
  | { type: "processing_started" }
  | { type: "live_reply_started" }
  | { type: "live_reply_delta"; delta: string }
  | { type: "live_reply_completed" }
  | { type: "live_reply_interrupted" }
  | { type: "reset" }
  | { type: "error"; message: string };

export const DEFAULT_VOICE_UI_STATE: VoiceUiState = {
  phase: "idle",
  transcriptPreview: "",
  errorMessage: null,
  permissionState: "unknown",
  liveReplyPhase: "idle",
  liveReplyTranscript: "",
};
