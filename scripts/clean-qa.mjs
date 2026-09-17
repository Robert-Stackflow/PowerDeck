import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
import path from "node:path";

// Only disposable test artifacts; never remove source, assets or outputs.
await fs.rm(path.join(projectRoot, "work", "qa"), {
  recursive: true,
  force: true,
});
console.log("已清理临时检查结果。");
