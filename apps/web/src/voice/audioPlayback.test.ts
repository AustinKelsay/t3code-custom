import { describe, expect, it, vi } from "vitest";

import { playHtmlAudioElement } from "./audioPlayback";

function createAudioElement(play: () => Promise<void>, muted = false) {
  return {
    muted,
    play,
  } as HTMLAudioElement;
}

describe("playHtmlAudioElement", () => {
  it("primes playback with mute and restores audio after play starts", async () => {
    const playStates: boolean[] = [];
    const audioElement = createAudioElement(async function () {
      playStates.push(audioElement.muted);
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    await playHtmlAudioElement(audioElement);

    expect(playStates).toEqual([true]);
    expect(audioElement.muted).toBe(false);
    vi.unstubAllGlobals();
  });

  it("keeps the audio element muted when requested", async () => {
    const playStates: boolean[] = [];
    const audioElement = createAudioElement(async function () {
      playStates.push(audioElement.muted);
    });

    await playHtmlAudioElement(audioElement, {
      keepMuted: true,
    });

    expect(playStates).toEqual([true]);
    expect(audioElement.muted).toBe(true);
  });

  it("restores the previous mute state when play fails", async () => {
    const audioElement = createAudioElement(async () => {
      throw new DOMException("Autoplay blocked", "NotAllowedError");
    });

    await expect(playHtmlAudioElement(audioElement)).rejects.toThrow("Autoplay blocked");
    expect(audioElement.muted).toBe(false);
  });
});
