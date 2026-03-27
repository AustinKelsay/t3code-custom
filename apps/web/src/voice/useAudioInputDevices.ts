import { useCallback, useEffect, useState } from "react";

export interface AudioInputDeviceOption {
  readonly deviceId: string;
  readonly label: string;
}

interface UseAudioInputDevicesResult {
  readonly devices: readonly AudioInputDeviceOption[];
  readonly isSupported: boolean;
  readonly refresh: () => Promise<void>;
}

function formatDeviceLabel(device: MediaDeviceInfo, index: number): string {
  const trimmedLabel = device.label.trim();
  if (trimmedLabel) {
    return trimmedLabel;
  }
  return `Microphone ${index + 1}`;
}

export function useAudioInputDevices(): UseAudioInputDevicesResult {
  const [devices, setDevices] = useState<readonly AudioInputDeviceOption[]>([]);

  const refresh = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      setDevices([]);
      return;
    }

    try {
      const availableDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = availableDevices
        .filter((device): device is MediaDeviceInfo => device.kind === "audioinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: formatDeviceLabel(device, index),
        }));
      setDevices(audioInputs);
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      return;
    }
    const mediaDevices = navigator.mediaDevices;
    if (typeof mediaDevices.addEventListener !== "function") {
      return;
    }
    const handleDeviceChange = () => {
      void refresh();
    };
    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [refresh]);

  return {
    devices,
    isSupported:
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.enumerateDevices === "function",
    refresh,
  };
}
