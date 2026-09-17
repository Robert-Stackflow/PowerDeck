// Serialize writes so a slow request cannot overwrite edits made during that request.
export function createAutosave({
  capture,
  write,
  onState,
  isInteracting = () => false,
  delay = 1000,
}) {
  let revision = 0,
    saved = 0,
    timer,
    flight = null,
    paused = false,
    retries = 0,
    lastError = null;
  const state = (name, error) => onState(name, error);
  function schedule(wait = delay) {
    clearTimeout(timer);
    if (!paused) timer = setTimeout(() => run().catch(() => {}), wait);
  }
  function mark() {
    revision++;
    lastError = null;
    state(flight ? "saving" : "pending");
    schedule();
  }
  async function run() {
    if (flight) return flight;
    clearTimeout(timer);
    if (saved === revision) return;
    if (isInteracting()) {
      schedule(300);
      return;
    }
    flight = Promise.resolve().then(async () => {
      try {
        const payload = capture(),
          capturedRevision = revision;
        clearTimeout(timer);
        state("saving");
        await write(payload);
        saved = capturedRevision;
        retries = 0;
        lastError = null;
        state(saved === revision ? "saved" : "pending");
      } catch (error) {
        lastError = error;
        state("error", error);
        // Invalid source or a version conflict needs user correction, not a blind overwrite.
        if (
          !(error instanceof SyntaxError) &&
          error.status !== 409 &&
          (!error.status || error.status >= 500)
        )
          schedule(Math.min(30000, 3000 * 2 ** retries++));
        throw error;
      } finally {
        flight = null;
        if (saved !== revision && !lastError) schedule();
      }
    });
    return flight;
  }
  return {
    mark,
    get dirty() {
      return saved !== revision;
    },
    async flush() {
      clearTimeout(timer);
      if (flight) await flight;
      while (saved !== revision) {
        if (isInteracting()) throw new Error("请先完成当前操作");
        await run();
      }
    },
    pause(value) {
      paused = value;
      clearTimeout(timer);
      if (!paused && saved !== revision) schedule();
    },
    destroy() {
      clearTimeout(timer);
      paused = true;
    },
  };
}
