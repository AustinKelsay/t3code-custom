interface PlayHtmlAudioElementOptions {
  readonly keepMuted?: boolean;
}

export async function playHtmlAudioElement(
  audioElement: HTMLAudioElement,
  options?: PlayHtmlAudioElementOptions,
) {
  const keepMuted = options?.keepMuted ?? audioElement.muted;
  const previousMuted = audioElement.muted;
  audioElement.muted = true;

  try {
    await audioElement.play();
  } catch (error) {
    audioElement.muted = keepMuted ? true : previousMuted;
    throw error;
  }

  if (keepMuted) {
    audioElement.muted = true;
    return;
  }

  if (typeof globalThis.requestAnimationFrame !== "function") {
    audioElement.muted = false;
    return;
  }

  globalThis.requestAnimationFrame(() => {
    audioElement.muted = false;
  });
}
