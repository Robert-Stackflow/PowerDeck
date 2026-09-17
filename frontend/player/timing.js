// Monotonic elapsed time, independent of rendering frequency and wall-clock changes.
export function createTiming({ ids, now = () => performance.now(), saved }) {
  let visitNeeded = true,
    running = false,
    active = ids[0],
    started = now();
  let rows = Object.fromEntries(ids.map((id) => [id, { ms: 0, visits: 0 }]));
  if (saved?.version === 1)
    for (const id of ids) {
      const row = saved.rows?.[id];
      if (
        row &&
        Number.isFinite(row.ms) &&
        row.ms >= 0 &&
        Number.isInteger(row.visits) &&
        row.visits >= 0
      )
        rows[id] = {
          ms: Math.min(row.ms, 31536000000),
          visits: Math.min(row.visits, 1000000),
        };
    }
  const settle = () => {
    const time = now();
    if (running) rows[active].ms += Math.max(0, time - started);
    started = time;
  };
  return {
    get running() {
      return running;
    },
    start() {
      if (running) return;
      started = now();
      running = true;
      if (visitNeeded) rows[active].visits++;
      visitNeeded = false;
    },
    pause() {
      settle();
      running = false;
    },
    go(id) {
      if (id === active || !rows[id]) return;
      settle();
      active = id;
      if (running) rows[id].visits++;
      visitNeeded = !running;
    },
    reset() {
      visitNeeded = true;
      running = false;
      started = now();
      rows = Object.fromEntries(ids.map((id) => [id, { ms: 0, visits: 0 }]));
    },
    snapshot() {
      const copy = Object.fromEntries(ids.map((id) => [id, { ...rows[id] }]));
      if (running) copy[active].ms += Math.max(0, now() - started);
      return {
        version: 1,
        rows: copy,
        active,
        total: Object.values(copy).reduce((n, r) => n + r.ms, 0),
      };
    },
  };
}
export function duration(ms) {
  const seconds = Math.floor(ms / 1000),
    hours = Math.floor(seconds / 3600);
  return (
    (hours ? String(hours).padStart(2, "0") + ":" : "") +
    String(Math.floor(seconds / 60) % 60).padStart(2, "0") +
    ":" +
    String(seconds % 60).padStart(2, "0")
  );
}
