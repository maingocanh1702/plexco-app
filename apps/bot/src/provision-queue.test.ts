import { beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import PgBoss from "pg-boss";
import { provisionQueue } from "./provision-queue.js";
import { QUEUE_SCHEMA } from "./queue.js";
import { QUEUES } from "./queues.js";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  start: vi.fn(),
  createQueue: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("pg", () => ({
  default: {
    Client: vi.fn(function () {
      return { connect: mocks.connect, query: mocks.query, end: mocks.end };
    }),
    Pool: vi.fn(() => {
      throw new Error("provisioning must not create an implicit pool");
    }),
  },
}));
vi.mock("pg-boss", () => ({
  default: vi.fn(function () {
    return { start: mocks.start, createQueue: mocks.createQueue, stop: mocks.stop };
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(mocks)) mock.mockReset().mockResolvedValue(undefined);
  mocks.query.mockResolvedValue({ rows: [] });
});

describe("provisionQueue connection ownership", () => {
  it("rejects an empty URL before acquiring resources", async () => {
    await expect(provisionQueue("")).rejects.toThrow("DATABASE_URL_MIGRATION is required");
    expect(pg.Client).not.toHaveBeenCalled();
    expect(PgBoss).not.toHaveBeenCalled();
  });

  it("closes the owned client if PgBoss construction throws", async () => {
    const failure = new Error("constructor failed");
    vi.mocked(PgBoss).mockImplementationOnce(function () {
      throw failure;
    });
    await expect(provisionQueue("postgres://migration/test")).rejects.toBe(failure);
    expect(mocks.end).toHaveBeenCalledTimes(1);
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it.each(["connect", "start", "createQueue", "stop", "query"] as const)(
    "closes the owned client when %s fails",
    async (stage) => {
      const failure = new Error(`${stage} failed`);
      mocks[stage].mockRejectedValueOnce(failure);
      await expect(provisionQueue("postgres://migration/test")).rejects.toBe(failure);
      expect(mocks.end).toHaveBeenCalledTimes(1);
      expect(pg.Pool).not.toHaveBeenCalled();
      if (stage === "connect") expect(PgBoss).not.toHaveBeenCalled();
      else expect(mocks.stop).toHaveBeenCalledExactlyOnceWith({ graceful: true, wait: true });
      if (stage !== "query") expect(mocks.query).not.toHaveBeenCalled();
      if (stage === "createQueue") expect(mocks.createQueue).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps the public adapter, every queue and exact runtime grants on repeated provisioning", async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await provisionQueue("postgres://migration/test");
      const options = vi.mocked(PgBoss).mock.calls[attempt]![0] as PgBoss.ConstructorOptions;
      expect(options).toEqual({
        db: { executeSql: expect.any(Function) },
        schema: QUEUE_SCHEMA,
        schedule: false,
        supervise: false,
      });
      expect(
        mocks.createQueue.mock.calls.slice(attempt * QUEUES.length, (attempt + 1) * QUEUES.length),
      ).toEqual(QUEUES.map((queue) => [queue]));
    }
    expect(mocks.query.mock.calls).toEqual(
      Array.from({ length: 2 }, () => [
        [`GRANT USAGE ON SCHEMA ${QUEUE_SCHEMA} TO app_worker`],
        [
          `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${QUEUE_SCHEMA} TO app_worker`,
        ],
        [`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${QUEUE_SCHEMA} TO app_worker`],
        [
          `ALTER DEFAULT PRIVILEGES IN SCHEMA ${QUEUE_SCHEMA}\n         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_worker`,
        ],
        [
          `ALTER DEFAULT PRIVILEGES IN SCHEMA ${QUEUE_SCHEMA} GRANT USAGE ON SEQUENCES TO app_worker`,
        ],
      ]).flat(),
    );
    expect(mocks.end).toHaveBeenCalledTimes(2);
    expect(pg.Pool).not.toHaveBeenCalled();
    const options = vi.mocked(PgBoss).mock.calls[0]![0] as PgBoss.ConstructorOptions;
    const rows = { rows: [{ ready: true }] };
    mocks.query.mockResolvedValueOnce(rows);
    await expect(options.db!.executeSql("SELECT $1", [true])).resolves.toBe(rows);
    expect(mocks.query).toHaveBeenLastCalledWith("SELECT $1", [true]);
  });
});
