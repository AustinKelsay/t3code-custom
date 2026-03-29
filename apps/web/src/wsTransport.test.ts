import { WS_CHANNELS } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WsTransport } from "./wsTransport";

type WsEventType = "open" | "message" | "close" | "error";
type WsListener = (event?: { data?: unknown }) => void;

const sockets: MockWebSocket[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  readonly sent: string[] = [];
  readonly url: string;
  private readonly listeners = new Map<WsEventType, Set<WsListener>>();

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }

  addEventListener(type: WsEventType, listener: WsListener) {
    const listeners = this.listeners.get(type) ?? new Set<WsListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close");
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open");
  }

  serverMessage(data: unknown) {
    this.emit("message", { data });
  }

  private emit(type: WsEventType, event?: { data?: unknown }) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(event);
    }
  }
}

const originalWebSocket = globalThis.WebSocket;

function getSocket(): MockWebSocket {
  const socket = sockets.at(-1);
  if (!socket) {
    throw new Error("Expected a websocket instance");
  }
  return socket;
}

beforeEach(() => {
  sockets.length = 0;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        hostname: "localhost",
        port: "3020",
        host: "localhost:3020",
        origin: "http://localhost:3020",
        href: "http://localhost:3020/",
      },
      sessionStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
      },
      desktopBridge: undefined,
    },
  });

  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  vi.restoreAllMocks();
});

describe("WsTransport", () => {
  it("routes valid push envelopes to channel listeners", () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    const listener = vi.fn();
    transport.subscribe(WS_CHANNELS.serverConfigUpdated, listener);

    socket.serverMessage(
      JSON.stringify({
        type: "push",
        sequence: 1,
        channel: WS_CHANNELS.serverConfigUpdated,
        data: { issues: [], providers: [] },
      }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "push",
      sequence: 1,
      channel: WS_CHANNELS.serverConfigUpdated,
      data: { issues: [], providers: [] },
    });

    transport.dispose();
  });

  it("resolves pending requests for valid response envelopes", async () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    const requestPromise = transport.request("projects.list");
    const sent = socket.sent.at(-1);
    if (!sent) {
      throw new Error("Expected request envelope to be sent");
    }

    const requestEnvelope = JSON.parse(sent) as { id: string };
    socket.serverMessage(
      JSON.stringify({
        id: requestEnvelope.id,
        result: { projects: [] },
      }),
    );

    await expect(requestPromise).resolves.toEqual({ projects: [] });

    transport.dispose();
  });

  it("drops malformed envelopes without crashing transport", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    const listener = vi.fn();
    transport.subscribe(WS_CHANNELS.serverConfigUpdated, listener);

    socket.serverMessage("{ invalid-json");
    socket.serverMessage(
      JSON.stringify({
        type: "push",
        sequence: 2,
        channel: 42,
        data: { bad: true },
      }),
    );
    socket.serverMessage(
      JSON.stringify({
        type: "push",
        sequence: 3,
        channel: WS_CHANNELS.serverConfigUpdated,
        data: { issues: [], providers: [] },
      }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "push",
      sequence: 3,
      channel: WS_CHANNELS.serverConfigUpdated,
      data: { issues: [], providers: [] },
    });
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenNthCalledWith(
      1,
      "Dropped inbound WebSocket envelope",
      expect.stringMatching(/^SyntaxError:/),
    );
    expect(warnSpy).toHaveBeenNthCalledWith(
      2,
      "Dropped inbound WebSocket envelope",
      expect.stringContaining('Expected "server.configUpdated"'),
    );

    transport.dispose();
  });

  it("queues requests until the websocket opens", async () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();

    const requestPromise = transport.request("projects.list");
    expect(socket.sent).toHaveLength(0);

    socket.open();
    expect(socket.sent).toHaveLength(1);
    const requestEnvelope = JSON.parse(socket.sent[0] ?? "{}") as { id: string };
    socket.serverMessage(
      JSON.stringify({
        id: requestEnvelope.id,
        result: { projects: [] },
      }),
    );

    await expect(requestPromise).resolves.toEqual({ projects: [] });
    transport.dispose();
  });

  it("inherits the page token for websocket auth when the base url has no token", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          protocol: "http:",
          hostname: "100.93.167.23",
          port: "3773",
          host: "100.93.167.23:3773",
          origin: "http://100.93.167.23:3773",
          href: "http://100.93.167.23:3773/?token=remote-secret",
        },
        sessionStorage: {
          getItem: vi.fn(() => null),
          setItem: vi.fn(),
        },
        desktopBridge: undefined,
      },
    });

    const transport = new WsTransport();

    expect(getSocket().url).toBe("ws://100.93.167.23:3773/?token=remote-secret");

    transport.dispose();
  });

  it("reuses the session token when the current route no longer has the query string", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          protocol: "http:",
          hostname: "100.93.167.23",
          port: "3773",
          host: "100.93.167.23:3773",
          origin: "http://100.93.167.23:3773",
          href: "http://100.93.167.23:3773/e845008c-cbfc-4e30-8dff-f80eefbc8fde",
        },
        sessionStorage: {
          getItem: vi.fn(() => "remote-secret"),
          setItem: vi.fn(),
        },
        desktopBridge: undefined,
      },
    });

    const transport = new WsTransport();

    expect(getSocket().url).toBe("ws://100.93.167.23:3773/?token=remote-secret");

    transport.dispose();
  });

  it("restores the token into the current url before socket setup when session state has it", async () => {
    const replaceState = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          protocol: "http:",
          hostname: "100.93.167.23",
          port: "3773",
          host: "100.93.167.23:3773",
          origin: "http://100.93.167.23:3773",
          href: "http://100.93.167.23:3773/e845008c-cbfc-4e30-8dff-f80eefbc8fde",
        },
        history: {
          state: null,
          replaceState,
        },
        sessionStorage: {
          getItem: vi.fn(() => "remote-secret"),
          setItem: vi.fn(),
        },
        desktopBridge: undefined,
      },
    });

    const { ensureRemoteAuthTokenInUrl } = await import("./lib/serverUrl");
    ensureRemoteAuthTokenInUrl();

    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "http://100.93.167.23:3773/e845008c-cbfc-4e30-8dff-f80eefbc8fde?token=remote-secret",
    );
  });
});
