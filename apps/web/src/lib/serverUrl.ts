const REMOTE_AUTH_TOKEN_STORAGE_KEY = "t3code:remote-auth-token";

function readWindowLocation(): Location | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.location;
}

function readConfiguredWsUrl(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const bridgeUrl = window.desktopBridge?.getWsUrl?.();
  if (typeof bridgeUrl === "string" && bridgeUrl.length > 0) {
    return bridgeUrl;
  }

  const envUrl = import.meta.env.VITE_WS_URL as string | undefined;
  return typeof envUrl === "string" && envUrl.length > 0 ? envUrl : null;
}

function readPageToken(): string | null {
  const location = readWindowLocation();
  if (!location) {
    return null;
  }

  try {
    return new URL(location.href).searchParams.get("token");
  } catch {
    return null;
  }
}

function readStoredToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage.getItem(REMOTE_AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(REMOTE_AUTH_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage failures so remote access still works in restricted contexts.
  }
}

function readRemoteAuthToken(): string | null {
  const pageToken = readPageToken();
  if (pageToken && pageToken.length > 0) {
    persistToken(pageToken);
    return pageToken;
  }

  const storedToken = readStoredToken();
  return storedToken && storedToken.length > 0 ? storedToken : null;
}

function replaceCurrentUrlToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.get("token") === token) {
      return;
    }
    currentUrl.searchParams.set("token", token);
    window.history.replaceState(window.history.state, "", currentUrl.toString());
  } catch {
    // Ignore URL/history failures to avoid breaking app startup.
  }
}

export function ensureRemoteAuthTokenInUrl(): void {
  const token = readRemoteAuthToken();
  if (!token || token.length === 0) {
    return;
  }

  replaceCurrentUrlToken(token);
}

function appendTokenQuery(url: string, token: string): string {
  try {
    const location = readWindowLocation();
    const resolved = location ? new URL(url, location.href) : new URL(url);
    if (!resolved.searchParams.has("token")) {
      resolved.searchParams.set("token", token);
    }
    return resolved.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}token=${encodeURIComponent(token)}`;
  }
}

export function resolveWsUrl(): string {
  const location = readWindowLocation();
  const fallbackUrl = location
    ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`
    : "";
  const baseUrl = readConfiguredWsUrl() ?? fallbackUrl;
  const token = readRemoteAuthToken();

  if (!token || token.length === 0) {
    return baseUrl;
  }

  return appendTokenQuery(baseUrl, token);
}

export function resolveServerHttpOrigin(): string {
  const wsCandidate = resolveWsUrl();
  const location = readWindowLocation();

  if (wsCandidate.length === 0) {
    return location?.origin ?? "";
  }

  try {
    const wsUrl = new URL(wsCandidate, location?.href);
    const protocol =
      wsUrl.protocol === "wss:" ? "https:" : wsUrl.protocol === "ws:" ? "http:" : wsUrl.protocol;
    return `${protocol}//${wsUrl.host}`;
  } catch {
    return location?.origin ?? "";
  }
}
