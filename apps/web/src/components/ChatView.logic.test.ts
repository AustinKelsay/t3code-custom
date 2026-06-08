import { scopeThreadRef } from "@t3tools/client-runtime";
import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  TurnQueueItemId,
  CommandId,
  TurnSteerEntryId,
  EventId,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { type EnvironmentState, useStore } from "../store";
import { type Thread } from "../types";

import {
  MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  buildComposerTurnDispatch,
  buildExpiredTerminalContextToastCopy,
  createLocalDispatchSnapshot,
  deriveComposerSendState,
  hasServerAcknowledgedLocalDispatch,
  reconcileMountedTerminalThreadIds,
  resolveFollowUpBehavior,
  resolveProviderTurnSteeringSupport,
  resolveSendEnvMode,
  shouldWriteThreadErrorToCurrentServerThread,
  waitForStartedServerThread,
} from "./ChatView.logic";

const localEnvironmentId = EnvironmentId.make("environment-local");

describe("deriveComposerSendState", () => {
  it("treats expired terminal pills as non-sendable content", () => {
    const state = deriveComposerSendState({
      prompt: "\uFFFC",
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.make("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("");
    expect(state.sendableTerminalContexts).toEqual([]);
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(false);
  });

  it("keeps text sendable while excluding expired terminal pills", () => {
    const state = deriveComposerSendState({
      prompt: `yoo \uFFFC waddup`,
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.make("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("yoo  waddup");
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(true);
  });
});

describe("resolveFollowUpBehavior", () => {
  it("defaults queue requests to queue", () => {
    expect(
      resolveFollowUpBehavior({
        setting: "queue",
        activeTurnState: "active",
        providerTurnSteering: "native",
        attachmentCount: 0,
      }),
    ).toEqual({
      behavior: "queue",
      requestedBehavior: "queue",
      fallbackReason: null,
    });
  });

  it("uses steer when requested during an active steerable Codex turn", () => {
    expect(
      resolveFollowUpBehavior({
        setting: "steer",
        activeTurnState: "active",
        providerTurnSteering: "native",
        attachmentCount: 0,
      }),
    ).toEqual({
      behavior: "steer",
      requestedBehavior: "steer",
      fallbackReason: null,
    });
  });

  it("lets a one-shot queue override win over a steer setting", () => {
    expect(
      resolveFollowUpBehavior({
        setting: "steer",
        override: "queue",
        activeTurnState: "active",
        providerTurnSteering: "native",
        attachmentCount: 0,
      }),
    ).toEqual({
      behavior: "queue",
      requestedBehavior: "queue",
      fallbackReason: null,
    });
  });

  it("falls back to queue when steer is unsupported or payload has attachments", () => {
    expect(
      resolveFollowUpBehavior({
        setting: "steer",
        activeTurnState: "active",
        providerTurnSteering: "unsupported",
        attachmentCount: 0,
      }),
    ).toMatchObject({
      behavior: "queue",
      requestedBehavior: "steer",
      fallbackReason: "unsupported-provider",
    });

    expect(
      resolveFollowUpBehavior({
        setting: "steer",
        activeTurnState: "active",
        providerTurnSteering: "native",
        attachmentCount: 1,
      }),
    ).toMatchObject({
      behavior: "queue",
      requestedBehavior: "steer",
      fallbackReason: "non-steerable-payload",
    });
  });
});

describe("resolveProviderTurnSteeringSupport", () => {
  it("reads provider steering support from the provider status snapshot", () => {
    expect(
      resolveProviderTurnSteeringSupport({
        driver: ProviderDriverKind.make("codex"),
        capabilities: { turnSteering: "native" },
      }),
    ).toBe("native");
    expect(
      resolveProviderTurnSteeringSupport({
        driver: ProviderDriverKind.make("claudeAgent"),
        capabilities: { turnSteering: "unsupported" },
      }),
    ).toBe("unsupported");
  });

  it("keeps legacy Codex snapshots steerable when provider capabilities are missing", () => {
    expect(
      resolveProviderTurnSteeringSupport({
        driver: ProviderDriverKind.make("codex"),
      }),
    ).toBe("native");
    expect(resolveProviderTurnSteeringSupport(null)).toBe("unsupported");
  });
});

describe("buildComposerTurnDispatch", () => {
  const baseInput = {
    commandId: CommandId.make("command-1"),
    threadId: ThreadId.make("thread-1"),
    activeTurnId: TurnId.make("turn-active"),
    messageId: MessageId.make("message-1"),
    text: "keep going",
    attachments: [],
    createdAt: "2026-05-25T12:00:00.000Z",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5",
      options: [],
    },
    titleSeed: "keep going",
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    followUpBehavior: "steer" as const,
  };

  it("dispatches a text-only running follow-up as turn steering when Steer is selected", () => {
    const result = buildComposerTurnDispatch({
      ...baseInput,
      phase: "running",
    });

    expect(result.delivery).toBe("steer");
    expect(result.command).toEqual({
      type: "thread.turn.steer",
      commandId: baseInput.commandId,
      threadId: baseInput.threadId,
      turnId: baseInput.activeTurnId,
      message: {
        messageId: baseInput.messageId,
        role: "user",
        text: "keep going",
        attachments: [],
      },
      createdAt: baseInput.createdAt,
    });
  });

  it("dispatches a running follow-up as queued when Queue is selected", () => {
    const result = buildComposerTurnDispatch({
      ...baseInput,
      phase: "running",
      followUpBehavior: "queue",
    });

    expect(result.delivery).toBe("queue");
    expect(result.command.type).toBe("thread.turn.queue");
  });

  it("honors a one-shot Steer override while Queue is selected", () => {
    const result = buildComposerTurnDispatch({
      ...baseInput,
      phase: "running",
      followUpBehavior: "queue",
      followUpBehaviorOverride: "steer",
    });

    expect(result.delivery).toBe("steer");
    expect(result.command.type).toBe("thread.turn.steer");
  });

  it("falls back to Queue for running Steer follow-ups with attachments", () => {
    const result = buildComposerTurnDispatch({
      ...baseInput,
      phase: "running",
      attachments: [
        {
          type: "image",
          name: "screenshot.png",
          mimeType: "image/png",
          sizeBytes: 42,
          dataUrl: "data:image/png;base64,AA==",
        },
      ],
    });

    expect(result.delivery).toBe("queue");
    expect(result.command.type).toBe("thread.turn.queue");
  });
});

describe("buildExpiredTerminalContextToastCopy", () => {
  it("formats clear empty-state guidance", () => {
    expect(buildExpiredTerminalContextToastCopy(1, "empty")).toEqual({
      title: "Expired terminal context won't be sent",
      description: "Remove it or re-add it to include terminal output.",
    });
  });

  it("formats omission guidance for sent messages", () => {
    expect(buildExpiredTerminalContextToastCopy(2, "omitted")).toEqual({
      title: "Expired terminal contexts omitted from message",
      description: "Re-add it if you want that terminal output included.",
    });
  });
});

describe("resolveSendEnvMode", () => {
  it("keeps worktree mode for git repositories", () => {
    expect(resolveSendEnvMode({ requestedEnvMode: "worktree", isGitRepo: true })).toBe("worktree");
  });

  it("forces local mode for non-git repositories", () => {
    expect(resolveSendEnvMode({ requestedEnvMode: "worktree", isGitRepo: false })).toBe("local");
    expect(resolveSendEnvMode({ requestedEnvMode: "local", isGitRepo: false })).toBe("local");
  });
});

describe("reconcileMountedTerminalThreadIds", () => {
  it("keeps previously mounted open threads and adds the active open thread", () => {
    expect(
      reconcileMountedTerminalThreadIds({
        currentThreadIds: [ThreadId.make("thread-hidden"), ThreadId.make("thread-stale")],
        openThreadIds: [ThreadId.make("thread-hidden"), ThreadId.make("thread-active")],
        activeThreadId: ThreadId.make("thread-active"),
        activeThreadTerminalOpen: true,
      }),
    ).toEqual([ThreadId.make("thread-hidden"), ThreadId.make("thread-active")]);
  });

  it("drops mounted threads once their terminal drawer is no longer open", () => {
    expect(
      reconcileMountedTerminalThreadIds({
        currentThreadIds: [ThreadId.make("thread-closed")],
        openThreadIds: [],
        activeThreadId: ThreadId.make("thread-closed"),
        activeThreadTerminalOpen: false,
      }),
    ).toEqual([]);
  });

  it("keeps only the most recently active hidden terminal threads", () => {
    expect(
      reconcileMountedTerminalThreadIds({
        currentThreadIds: [
          ThreadId.make("thread-1"),
          ThreadId.make("thread-2"),
          ThreadId.make("thread-3"),
        ],
        openThreadIds: [
          ThreadId.make("thread-1"),
          ThreadId.make("thread-2"),
          ThreadId.make("thread-3"),
          ThreadId.make("thread-4"),
        ],
        activeThreadId: ThreadId.make("thread-4"),
        activeThreadTerminalOpen: true,
        maxHiddenThreadCount: 2,
      }),
    ).toEqual([ThreadId.make("thread-2"), ThreadId.make("thread-3"), ThreadId.make("thread-4")]);
  });

  it("moves the active thread to the end so it is treated as most recently used", () => {
    expect(
      reconcileMountedTerminalThreadIds({
        currentThreadIds: [
          ThreadId.make("thread-a"),
          ThreadId.make("thread-b"),
          ThreadId.make("thread-c"),
        ],
        openThreadIds: [
          ThreadId.make("thread-a"),
          ThreadId.make("thread-b"),
          ThreadId.make("thread-c"),
        ],
        activeThreadId: ThreadId.make("thread-a"),
        activeThreadTerminalOpen: true,
        maxHiddenThreadCount: 2,
      }),
    ).toEqual([ThreadId.make("thread-b"), ThreadId.make("thread-c"), ThreadId.make("thread-a")]);
  });

  it("defaults to the hidden mounted terminal cap", () => {
    const currentThreadIds = Array.from(
      { length: MAX_HIDDEN_MOUNTED_TERMINAL_THREADS + 2 },
      (_, index) => ThreadId.make(`thread-${index + 1}`),
    );

    expect(
      reconcileMountedTerminalThreadIds({
        currentThreadIds,
        openThreadIds: currentThreadIds,
        activeThreadId: null,
        activeThreadTerminalOpen: false,
      }),
    ).toEqual(currentThreadIds.slice(-MAX_HIDDEN_MOUNTED_TERMINAL_THREADS));
  });
});

describe("shouldWriteThreadErrorToCurrentServerThread", () => {
  it("routes errors to the active server thread when route and target match", () => {
    const threadId = ThreadId.make("thread-1");
    const routeThreadRef = scopeThreadRef(localEnvironmentId, threadId);

    expect(
      shouldWriteThreadErrorToCurrentServerThread({
        serverThread: {
          environmentId: localEnvironmentId,
          id: threadId,
        },
        routeThreadRef,
        targetThreadId: threadId,
      }),
    ).toBe(true);
  });

  it("does not route draft-thread errors into server-backed state", () => {
    const threadId = ThreadId.make("thread-1");

    expect(
      shouldWriteThreadErrorToCurrentServerThread({
        serverThread: undefined,
        routeThreadRef: scopeThreadRef(localEnvironmentId, threadId),
        targetThreadId: threadId,
      }),
    ).toBe(false);
  });
});

const makeThread = (input?: {
  id?: ThreadId;
  session?: Thread["session"];
  messages?: Thread["messages"];
  queuedTurns?: Thread["queuedTurns"];
  steerEntries?: Thread["steerEntries"];
  latestTurn?: {
    turnId: TurnId;
    state: "running" | "completed";
    requestedAt: string;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
}): Thread => ({
  id: input?.id ?? ThreadId.make("thread-1"),
  environmentId: localEnvironmentId,
  codexThreadId: null,
  projectId: ProjectId.make("project-1"),
  title: "Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  session: input?.session ?? null,
  messages: input?.messages ?? [],
  queuedTurns: input?.queuedTurns ?? [],
  steerEntries: input?.steerEntries ?? [],
  proposedPlans: [],
  error: null,
  createdAt: "2026-03-29T00:00:00.000Z",
  archivedAt: null,
  updatedAt: "2026-03-29T00:00:00.000Z",
  latestTurn: input?.latestTurn
    ? {
        ...input.latestTurn,
        assistantMessageId: null,
      }
    : null,
  branch: null,
  worktreePath: null,
  turnDiffSummaries: [],
  activities: [],
});

function setStoreThreads(threads: ReadonlyArray<ReturnType<typeof makeThread>>) {
  const projectId = ProjectId.make("project-1");
  const environmentState: EnvironmentState = {
    projectIds: [projectId],
    projectById: {
      [projectId]: {
        id: projectId,
        environmentId: localEnvironmentId,
        name: "Project",
        cwd: "/tmp/project",
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        createdAt: "2026-03-29T00:00:00.000Z",
        updatedAt: "2026-03-29T00:00:00.000Z",
        scripts: [],
      },
    },
    threadIds: threads.map((thread) => thread.id),
    threadIdsByProjectId: {
      [projectId]: threads.map((thread) => thread.id),
    },
    threadShellById: Object.fromEntries(
      threads.map((thread) => [
        thread.id,
        {
          id: thread.id,
          environmentId: thread.environmentId,
          codexThreadId: thread.codexThreadId,
          projectId: thread.projectId,
          title: thread.title,
          modelSelection: thread.modelSelection,
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
          error: thread.error,
          createdAt: thread.createdAt,
          archivedAt: thread.archivedAt,
          updatedAt: thread.updatedAt,
          branch: thread.branch,
          worktreePath: thread.worktreePath,
        },
      ]),
    ),
    threadSessionById: Object.fromEntries(threads.map((thread) => [thread.id, thread.session])),
    threadTurnStateById: Object.fromEntries(
      threads.map((thread) => [
        thread.id,
        {
          latestTurn: thread.latestTurn,
          ...(thread.pendingSourceProposedPlan
            ? { pendingSourceProposedPlan: thread.pendingSourceProposedPlan }
            : {}),
        },
      ]),
    ),
    messageIdsByThreadId: Object.fromEntries(
      threads.map((thread) => [thread.id, thread.messages.map((message) => message.id)]),
    ),
    messageByThreadId: Object.fromEntries(
      threads.map((thread) => [
        thread.id,
        Object.fromEntries(thread.messages.map((message) => [message.id, message])),
      ]),
    ),
    queuedTurnIdsByThreadId: Object.fromEntries(
      threads.map((thread) => [
        thread.id,
        thread.queuedTurns.map((queuedTurn) => queuedTurn.queueItemId),
      ]),
    ),
    queuedTurnByThreadId: Object.fromEntries(
      threads.map((thread) => [
        thread.id,
        Object.fromEntries(
          thread.queuedTurns.map((queuedTurn) => [queuedTurn.queueItemId, queuedTurn]),
        ),
      ]),
    ),
    activityIdsByThreadId: Object.fromEntries(
      threads.map((thread) => [thread.id, thread.activities.map((activity) => activity.id)]),
    ),
    activityByThreadId: Object.fromEntries(
      threads.map((thread) => [
        thread.id,
        Object.fromEntries(thread.activities.map((activity) => [activity.id, activity])),
      ]),
    ),
    proposedPlanIdsByThreadId: Object.fromEntries(
      threads.map((thread) => [thread.id, thread.proposedPlans.map((plan) => plan.id)]),
    ),
    proposedPlanByThreadId: Object.fromEntries(
      threads.map((thread) => [
        thread.id,
        Object.fromEntries(thread.proposedPlans.map((plan) => [plan.id, plan])),
      ]),
    ),
    turnDiffIdsByThreadId: Object.fromEntries(
      threads.map((thread) => [
        thread.id,
        thread.turnDiffSummaries.map((summary) => summary.turnId),
      ]),
    ),
    turnDiffSummaryByThreadId: Object.fromEntries(
      threads.map((thread) => [
        thread.id,
        Object.fromEntries(thread.turnDiffSummaries.map((summary) => [summary.turnId, summary])),
      ]),
    ),
    sidebarThreadSummaryById: {},
    bootstrapComplete: true,
  };
  useStore.setState({
    activeEnvironmentId: localEnvironmentId,
    environmentStateById: {
      [localEnvironmentId]: environmentState,
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setStoreThreads([]);
});

describe("waitForStartedServerThread", () => {
  it("resolves immediately when the thread is already started", async () => {
    const threadId = ThreadId.make("thread-started");
    setStoreThreads([
      makeThread({
        id: threadId,
        latestTurn: {
          turnId: TurnId.make("turn-started"),
          state: "running",
          requestedAt: "2026-03-29T00:00:01.000Z",
          startedAt: "2026-03-29T00:00:01.000Z",
          completedAt: null,
        },
      }),
    ]);

    await expect(
      waitForStartedServerThread(scopeThreadRef(localEnvironmentId, threadId)),
    ).resolves.toBe(true);
  });

  it("waits for the thread to start via subscription updates", async () => {
    const threadId = ThreadId.make("thread-wait");
    setStoreThreads([makeThread({ id: threadId })]);

    const promise = waitForStartedServerThread(scopeThreadRef(localEnvironmentId, threadId), 500);

    setStoreThreads([
      makeThread({
        id: threadId,
        latestTurn: {
          turnId: TurnId.make("turn-started"),
          state: "running",
          requestedAt: "2026-03-29T00:00:01.000Z",
          startedAt: "2026-03-29T00:00:01.000Z",
          completedAt: null,
        },
      }),
    ]);

    await expect(promise).resolves.toBe(true);
  });

  it("handles the thread starting between the initial read and subscription setup", async () => {
    const threadId = ThreadId.make("thread-race");
    setStoreThreads([makeThread({ id: threadId })]);

    const originalSubscribe = useStore.subscribe.bind(useStore);
    let raced = false;
    vi.spyOn(useStore, "subscribe").mockImplementation((listener) => {
      if (!raced) {
        raced = true;
        setStoreThreads([
          makeThread({
            id: threadId,
            latestTurn: {
              turnId: TurnId.make("turn-race"),
              state: "running",
              requestedAt: "2026-03-29T00:00:01.000Z",
              startedAt: "2026-03-29T00:00:01.000Z",
              completedAt: null,
            },
          }),
        ]);
      }
      return originalSubscribe(listener);
    });

    await expect(
      waitForStartedServerThread(scopeThreadRef(localEnvironmentId, threadId), 500),
    ).resolves.toBe(true);
  });

  it("returns false after the timeout when the thread never starts", async () => {
    vi.useFakeTimers();

    const threadId = ThreadId.make("thread-timeout");
    setStoreThreads([makeThread({ id: threadId })]);
    const promise = waitForStartedServerThread(scopeThreadRef(localEnvironmentId, threadId), 500);

    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).resolves.toBe(false);
  });
});

describe("hasServerAcknowledgedLocalDispatch", () => {
  const projectId = ProjectId.make("project-1");
  const previousLatestTurn = {
    turnId: TurnId.make("turn-1"),
    state: "completed" as const,
    requestedAt: "2026-03-29T00:00:00.000Z",
    startedAt: "2026-03-29T00:00:01.000Z",
    completedAt: "2026-03-29T00:00:10.000Z",
    assistantMessageId: null,
  };

  const previousSession = {
    provider: ProviderDriverKind.make("codex"),
    status: "ready" as const,
    createdAt: "2026-03-29T00:00:00.000Z",
    updatedAt: "2026-03-29T00:00:10.000Z",
    orchestrationStatus: "idle" as const,
  };

  it("does not clear local dispatch before server state changes", () => {
    const localDispatch = createLocalDispatchSnapshot({
      id: ThreadId.make("thread-1"),
      environmentId: localEnvironmentId,
      codexThreadId: null,
      projectId,
      title: "Thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      session: previousSession,
      messages: [],
      queuedTurns: [],
      steerEntries: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      archivedAt: null,
      updatedAt: "2026-03-29T00:00:10.000Z",
      latestTurn: previousLatestTurn,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      activities: [],
    });

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: previousLatestTurn,
        session: previousSession,
        messages: [],
        queuedTurns: [],
        steerEntries: [],
        activities: [],
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
  });

  it("clears local dispatch when a new turn is already settled", () => {
    const localDispatch = createLocalDispatchSnapshot({
      id: ThreadId.make("thread-1"),
      environmentId: localEnvironmentId,
      codexThreadId: null,
      projectId,
      title: "Thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      session: previousSession,
      messages: [],
      queuedTurns: [],
      steerEntries: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      archivedAt: null,
      updatedAt: "2026-03-29T00:00:10.000Z",
      latestTurn: previousLatestTurn,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      activities: [],
    });

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: {
          ...previousLatestTurn,
          turnId: TurnId.make("turn-2"),
          requestedAt: "2026-03-29T00:01:00.000Z",
          startedAt: "2026-03-29T00:01:01.000Z",
          completedAt: "2026-03-29T00:01:30.000Z",
        },
        session: {
          ...previousSession,
          updatedAt: "2026-03-29T00:01:30.000Z",
        },
        messages: [],
        queuedTurns: [],
        steerEntries: [],
        activities: [],
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("does not clear local dispatch while the session is running a newer turn than latestTurn", () => {
    const localDispatch = createLocalDispatchSnapshot({
      id: ThreadId.make("thread-1"),
      environmentId: localEnvironmentId,
      codexThreadId: null,
      projectId,
      title: "Thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      session: previousSession,
      messages: [],
      queuedTurns: [],
      steerEntries: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      archivedAt: null,
      updatedAt: "2026-03-29T00:00:10.000Z",
      latestTurn: previousLatestTurn,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      activities: [],
    });

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: previousLatestTurn,
        session: {
          ...previousSession,
          status: "running",
          orchestrationStatus: "running",
          activeTurnId: TurnId.make("turn-2"),
          updatedAt: "2026-03-29T00:01:00.000Z",
        },
        messages: [],
        queuedTurns: [],
        steerEntries: [],
        activities: [],
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
  });

  it("does not clear local dispatch while the session is running but latestTurn has not advanced yet", () => {
    const localDispatch = createLocalDispatchSnapshot({
      id: ThreadId.make("thread-1"),
      environmentId: localEnvironmentId,
      codexThreadId: null,
      projectId,
      title: "Thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      session: previousSession,
      messages: [],
      queuedTurns: [],
      steerEntries: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      archivedAt: null,
      updatedAt: "2026-03-29T00:00:10.000Z",
      latestTurn: previousLatestTurn,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      activities: [],
    });

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: previousLatestTurn,
        session: {
          ...previousSession,
          status: "running",
          orchestrationStatus: "running",
          activeTurnId: undefined,
          updatedAt: "2026-03-29T00:01:00.000Z",
        },
        messages: [],
        queuedTurns: [],
        steerEntries: [],
        activities: [],
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
  });

  it("clears local dispatch once the running latestTurn matches the active session turn", () => {
    const localDispatch = createLocalDispatchSnapshot({
      id: ThreadId.make("thread-1"),
      environmentId: localEnvironmentId,
      codexThreadId: null,
      projectId,
      title: "Thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      session: previousSession,
      messages: [],
      queuedTurns: [],
      steerEntries: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      archivedAt: null,
      updatedAt: "2026-03-29T00:00:10.000Z",
      latestTurn: previousLatestTurn,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      activities: [],
    });

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: {
          ...previousLatestTurn,
          turnId: TurnId.make("turn-2"),
          state: "running",
          requestedAt: "2026-03-29T00:01:00.000Z",
          startedAt: "2026-03-29T00:01:01.000Z",
          completedAt: null,
        },
        session: {
          ...previousSession,
          status: "running",
          orchestrationStatus: "running",
          activeTurnId: TurnId.make("turn-2"),
          updatedAt: "2026-03-29T00:01:01.000Z",
        },
        messages: [],
        queuedTurns: [],
        steerEntries: [],
        activities: [],
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("clears local dispatch when the session changes without an observed running phase", () => {
    const localDispatch = createLocalDispatchSnapshot({
      id: ThreadId.make("thread-1"),
      environmentId: localEnvironmentId,
      codexThreadId: null,
      projectId,
      title: "Thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      session: previousSession,
      messages: [],
      queuedTurns: [],
      steerEntries: [],
      proposedPlans: [],
      error: null,
      createdAt: "2026-03-29T00:00:00.000Z",
      archivedAt: null,
      updatedAt: "2026-03-29T00:00:10.000Z",
      latestTurn: previousLatestTurn,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      activities: [],
    });

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "ready",
        latestTurn: previousLatestTurn,
        session: {
          ...previousSession,
          updatedAt: "2026-03-29T00:00:11.000Z",
        },
        messages: [],
        queuedTurns: [],
        steerEntries: [],
        activities: [],
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("does not clear queued local dispatch before the queued message is reflected", () => {
    const messageId = MessageId.make("message-queued-pending");
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({
        session: previousSession,
        latestTurn: previousLatestTurn,
      }),
      {
        delivery: "queue",
        messageId,
      },
    );

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: previousLatestTurn,
        session: {
          ...previousSession,
          status: "running",
          orchestrationStatus: "running",
          activeTurnId: TurnId.make("turn-2"),
          updatedAt: "2026-03-29T00:01:00.000Z",
        },
        messages: [],
        queuedTurns: [],
        steerEntries: [],
        activities: [],
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(false);
  });

  it("clears queued local dispatch when the queued turn is reflected on the thread", () => {
    const messageId = MessageId.make("message-queued-reflected");
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({
        session: previousSession,
        latestTurn: previousLatestTurn,
      }),
      {
        delivery: "queue",
        messageId,
      },
    );

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: previousLatestTurn,
        session: {
          ...previousSession,
          status: "running",
          orchestrationStatus: "running",
          activeTurnId: TurnId.make("turn-2"),
          updatedAt: "2026-03-29T00:01:00.000Z",
        },
        messages: [],
        queuedTurns: [
          {
            queueItemId: TurnQueueItemId.make("queue-item-1"),
            request: {
              message: {
                messageId,
                role: "user",
                text: "queued follow-up",
                attachments: [],
              },
            },
            status: "pending",
            failureReason: null,
            createdAt: "2026-03-29T00:01:00.000Z",
            updatedAt: "2026-03-29T00:01:00.000Z",
          },
        ],
        steerEntries: [],
        activities: [],
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("clears steer local dispatch when the accepted steer entry is reflected on the thread", () => {
    const messageId = MessageId.make("message-steer-accepted");
    const activeTurnId = TurnId.make("turn-2");
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({
        session: {
          ...previousSession,
          status: "running",
          orchestrationStatus: "running",
          activeTurnId,
        },
        latestTurn: previousLatestTurn,
      }),
      {
        delivery: "steer",
        messageId,
      },
    );

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: previousLatestTurn,
        session: {
          ...previousSession,
          status: "running",
          orchestrationStatus: "running",
          activeTurnId,
          updatedAt: "2026-03-29T00:01:00.000Z",
        },
        messages: [],
        queuedTurns: [],
        steerEntries: [
          {
            steerEntryId: TurnSteerEntryId.make("steer-entry-1"),
            turnId: activeTurnId,
            messageId,
            text: "steer accepted",
            createdAt: "2026-03-29T00:01:00.000Z",
          },
        ],
        activities: [],
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("clears steer local dispatch when fallback reflects the message as a queued turn", () => {
    const messageId = MessageId.make("message-steer-fallback");
    const activeTurnId = TurnId.make("turn-2");
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({
        session: {
          ...previousSession,
          status: "running",
          orchestrationStatus: "running",
          activeTurnId,
        },
        latestTurn: previousLatestTurn,
      }),
      {
        delivery: "steer",
        messageId,
      },
    );

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: previousLatestTurn,
        session: {
          ...previousSession,
          status: "running",
          orchestrationStatus: "running",
          activeTurnId,
          updatedAt: "2026-03-29T00:01:00.000Z",
        },
        messages: [],
        queuedTurns: [
          {
            queueItemId: TurnQueueItemId.make("queue-item-steer-fallback"),
            request: {
              message: {
                messageId,
                role: "user",
                text: "fallback to queue",
                attachments: [],
              },
            },
            status: "pending",
            failureReason: null,
            createdAt: "2026-03-29T00:01:00.000Z",
            updatedAt: "2026-03-29T00:01:00.000Z",
          },
        ],
        steerEntries: [],
        activities: [],
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("clears steer local dispatch when the steer failure activity is reflected on the thread", () => {
    const messageId = MessageId.make("message-steer-failed");
    const activeTurnId = TurnId.make("turn-2");
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({
        session: {
          ...previousSession,
          status: "running",
          orchestrationStatus: "running",
          activeTurnId,
        },
        latestTurn: previousLatestTurn,
      }),
      {
        delivery: "steer",
        messageId,
      },
    );

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: previousLatestTurn,
        session: {
          ...previousSession,
          status: "running",
          orchestrationStatus: "running",
          activeTurnId,
          updatedAt: "2026-03-29T00:01:00.000Z",
        },
        messages: [],
        queuedTurns: [],
        steerEntries: [],
        activities: [
          {
            id: EventId.make("activity-steer-failed"),
            turnId: activeTurnId,
            tone: "error",
            kind: "turn.steer.failed",
            summary: "Steer failed",
            payload: {
              messageId,
              reason: "Provider rejected steering.",
            },
            createdAt: "2026-03-29T00:01:00.000Z",
          },
        ],
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("clears queued local dispatch after the queued message is resolved into server messages", () => {
    const messageId = MessageId.make("message-queued-resolved");
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({
        session: previousSession,
        latestTurn: previousLatestTurn,
      }),
      {
        delivery: "queue",
        messageId,
      },
    );

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: previousLatestTurn,
        session: {
          ...previousSession,
          status: "running",
          orchestrationStatus: "running",
          activeTurnId: TurnId.make("turn-2"),
          updatedAt: "2026-03-29T00:01:00.000Z",
        },
        messages: [
          {
            id: messageId,
            role: "user",
            text: "queued follow-up",
            createdAt: "2026-03-29T00:01:00.000Z",
            streaming: false,
          },
        ],
        queuedTurns: [],
        steerEntries: [],
        activities: [],
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });

  it("clears queued local dispatch when the queued turn fails after admission", () => {
    const messageId = MessageId.make("message-queued-failed");
    const localDispatch = createLocalDispatchSnapshot(
      makeThread({
        session: previousSession,
        latestTurn: previousLatestTurn,
      }),
      {
        delivery: "queue",
        messageId,
      },
    );

    expect(
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: "running",
        latestTurn: previousLatestTurn,
        session: {
          ...previousSession,
          status: "running",
          orchestrationStatus: "running",
          activeTurnId: TurnId.make("turn-2"),
          updatedAt: "2026-03-29T00:01:00.000Z",
        },
        messages: [],
        queuedTurns: [
          {
            queueItemId: TurnQueueItemId.make("queue-item-2"),
            request: {
              message: {
                messageId,
                role: "user",
                text: "queued failure",
                attachments: [],
              },
            },
            status: "failed",
            failureReason: "Provider send failed.",
            createdAt: "2026-03-29T00:01:00.000Z",
            updatedAt: "2026-03-29T00:01:05.000Z",
          },
        ],
        steerEntries: [],
        activities: [],
        hasPendingApproval: false,
        hasPendingUserInput: false,
        threadError: null,
      }),
    ).toBe(true);
  });
});
