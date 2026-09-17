import { parentPort, workerData } from "node:worker_threads";
import { convertPptx } from "./pptx.mjs";
try {
  parentPort.postMessage({
    result: await convertPptx(Buffer.from(workerData.bytes), {
      mode: workerData.mode,
    }),
  });
} catch (error) {
  parentPort.postMessage({ error: error.message, status: error.status || 400 });
}
