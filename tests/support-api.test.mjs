import { test } from "node:test";
import assert from "node:assert/strict";

import { isDenied, SupportError, supportApi } from "../src/components/support/api.ts";

async function withFetch(fetchImpl, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withOpenLogs(run) {
  const originalInfo = console.info;
  const entries = [];
  console.info = (...args) => entries.push(args);
  try {
    await run(entries);
  } finally {
    console.info = originalInfo;
  }
}

test("opening support succeeds and records only duration and HTTP status", async () => {
  await withOpenLogs(async (entries) => {
    await withFetch(
      async (url, options) => {
        assert.equal(url, "/api/support");
        assert.equal(options.credentials, "include");
        assert.deepEqual(JSON.parse(options.body), { action: "open" });
        return Response.json({ thread: { id: "thread-fixture" } });
      },
      async () => {
        const result = await supportApi.open(100);
        assert.equal(result.thread.id, "thread-fixture");
      },
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0][0], "[support-chat] open");
    assert.equal(entries[0][1].status, 200);
    assert.deepEqual(Object.keys(entries[0][1]).sort(), ["latencyMs", "status"]);
  });
});

test("an expired session remains an authentication error", async () => {
  await withFetch(
    async () => new Response("Please sign in again.", { status: 401 }),
    async () => {
      await assert.rejects(
        supportApi.open(100),
        (error) =>
          error instanceof SupportError &&
          error.status === 401 &&
          error.message === "Your session has ended. Sign in again to continue.",
      );
    },
  );
});

test("an access denial is distinct from an expired session", async () => {
  await withFetch(
    async () => new Response("This conversation is not available to you.", { status: 403 }),
    async () => {
      await assert.rejects(
        supportApi.open(100),
        (error) =>
          error instanceof SupportError &&
          error.status === 403 &&
          error.message === "You do not have access to this conversation." &&
          isDenied(error),
      );
      assert.equal(isDenied(new SupportError(401, "expired")), true);
      assert.equal(isDenied(new SupportError(408, "timeout")), false);
      assert.equal(isDenied(new SupportError(500, "server error")), false);
    },
  );
});

test("server errors do not tell members to sign in again", async () => {
  await withFetch(
    async () => new Response("Chat is unavailable. Please sign in again or retry.", { status: 500 }),
    async () => {
      await assert.rejects(
        supportApi.open(100),
        (error) =>
          error instanceof SupportError &&
          error.status === 500 &&
          error.message === "Support chat is temporarily unavailable. Please retry shortly.",
      );
    },
  );
});

test("a slow open request is aborted at its deadline and can be manually retried", async () => {
  await withOpenLogs(async (entries) => {
    await withFetch(
      (_url, { signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
            once: true,
          });
        }),
      async () => {
        await assert.rejects(
          supportApi.open(10),
          (error) =>
            error instanceof SupportError &&
            error.status === 408 &&
            error.message === "Opening support chat took too long. Please retry.",
        );
      },
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0][1].status, 408);
    assert.deepEqual(Object.keys(entries[0][1]).sort(), ["latencyMs", "status"]);
  });
});

test("network failures get a connection message, not an authentication message", async () => {
  await withFetch(
    async () => {
      throw new TypeError("network unavailable");
    },
    async () => {
      await assert.rejects(
        supportApi.open(100),
        (error) =>
          error instanceof SupportError &&
          error.status === 0 &&
          error.message === "You appear to be offline. Check your connection.",
      );
    },
  );
});
