import { DEFAULT_VOICE_UI_STATE, type VoiceUiAction, type VoiceUiState } from "./types";

export function voiceReducer(state: VoiceUiState, action: VoiceUiAction): VoiceUiState {
  switch (action.type) {
    case "connect_requested":
      return {
        ...state,
        phase: "connecting",
        transcriptPreview: "",
        errorMessage: null,
      };
    case "connect_succeeded":
      return {
        ...state,
        phase: "ready",
        errorMessage: null,
      };
    case "permission_state_changed":
      return {
        ...state,
        permissionState: action.permissionState,
      };
    case "listening_started":
      return {
        ...state,
        phase: "listening",
        transcriptPreview: "",
        errorMessage: null,
      };
    case "transcript_delta":
      return {
        ...state,
        transcriptPreview: `${state.transcriptPreview}${action.delta}`,
      };
    case "processing_started":
      return {
        ...state,
        phase: "processing",
      };
    case "live_reply_started":
      return {
        ...state,
        liveReplyPhase: "speaking",
        liveReplyTranscript: "",
      };
    case "live_reply_delta":
      return {
        ...state,
        liveReplyPhase: "speaking",
        liveReplyTranscript: `${state.liveReplyTranscript}${action.delta}`,
      };
    case "live_reply_completed":
      return {
        ...state,
        liveReplyPhase: state.liveReplyTranscript ? "complete" : "idle",
      };
    case "live_reply_interrupted":
      return {
        ...state,
        liveReplyPhase: "idle",
        liveReplyTranscript: "",
      };
    case "error":
      return {
        ...state,
        phase: "error",
        errorMessage: action.message,
      };
    case "reset":
      return DEFAULT_VOICE_UI_STATE;
    default:
      return state;
  }
}
