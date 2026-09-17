import test from "node:test";
import assert from "node:assert/strict";
import { createTiming, duration } from "../frontend/player/timing.js";
test("timing attributes navigation to each page, accumulates revisits and excludes paused intervals", () => {
  let time = 0;
  const timer = createTiming({ ids: ["a", "b", "c"], now: () => time });
  timer.start();
  time = 1500;
  timer.go("b");
  time = 3800;
  timer.go("a");
  time = 4300;
  timer.pause();
  time = 20000;
  assert.deepEqual(timer.snapshot().rows, {
    a: { ms: 2000, visits: 2 },
    b: { ms: 2300, visits: 1 },
    c: { ms: 0, visits: 0 },
  });
  timer.start();
  timer.start();
  time = 21000;
  timer.go("a");
  timer.pause();
  assert.equal(timer.snapshot().rows.a.ms, 3000);
  assert.equal(timer.snapshot().rows.a.visits, 2);
  timer.go("c");
  time = 40000;
  timer.start();
  time = 41000;
  timer.pause();
  assert.equal(timer.snapshot().total, 6300);
  assert.equal(timer.snapshot().rows.c.visits, 1);
  timer.reset();
  assert.equal(timer.running, false);
  assert.equal(timer.snapshot().total, 0);
});
test("saved timing restores paused by stable slide IDs and ignores invalid records", () => {
  const timer = createTiming({
    ids: ["b", "a", "new"],
    saved: {
      version: 1,
      rows: {
        a: { ms: 5000, visits: 2 },
        b: { ms: -1, visits: 3 },
        removed: { ms: 9000, visits: 1 },
      },
    },
  });
  assert.equal(timer.running, false);
  assert.equal(timer.snapshot().total, 5000);
  assert.equal(timer.snapshot().rows.new.ms, 0);
  assert.equal(timer.snapshot().rows.b.ms, 0);
  assert.equal(duration(3661000), "01:01:01");
  assert.equal(duration(59001), "00:59");
});
