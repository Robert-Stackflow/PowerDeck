import { Worker } from "node:worker_threads";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { HttpError, requireValue } from "../content.mjs";
const run = promisify(execFile);
let active = 0;
async function upgradeLegacy(bytes) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "deck-ppt-"));
  try {
    await fs.writeFile(path.join(dir, "input.ppt"), bytes);
    const profile = path.join(dir, "profile");
    await fs.mkdir(profile);
    await fs.writeFile(
      path.join(profile, "registrymodifications.xcu"),
      '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>',
    );
    try {
      await run(
        process.env.SOFFICE_PATH || "soffice",
        [
          "-env:UserInstallation=" + pathToFileURL(profile).href,
          "--headless",
          "--nologo",
          "--nodefault",
          "--norestore",
          "--convert-to",
          "pptx:Impress MS PowerPoint 2007 XML",
          "--outdir",
          dir,
          path.join(dir, "input.ppt"),
        ],
        { timeout: 60000, maxBuffer: 1024 * 1024, cwd: dir },
      );
    } catch (error) {
      throw new HttpError(
        422,
        error.code === "ENOENT"
          ? "旧版 .ppt 需要服务器安装 LibreOffice；也可以在 PowerPoint 中另存为 .pptx 后上传"
          : "旧版 .ppt 转换失败，请在 PowerPoint 中另存为 .pptx 后上传",
      );
    }
    try {
      const result = await fs.readFile(path.join(dir, "input.pptx"));
      requireValue(result.length <= 40 * 1024 * 1024, "转换后的文件超过 40 MB");
      return result;
    } catch (error) {
      if (error.status) throw error;
      throw new HttpError(422, "无法转换此 .ppt，文件可能已加密或损坏");
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
function parse(bytes, mode) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.mjs", import.meta.url), {
      workerData: { bytes, mode },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(
      () => finish(new HttpError(422, "转换超时，请拆分演示稿后重试")),
      60000,
    );
    worker.once("message", (message) =>
      finish(
        message.error ? new HttpError(message.status, message.error) : null,
        message.result,
      ),
    );
    worker.once("error", () =>
      finish(
        new HttpError(
          422,
          "无法转换此 PowerPoint 文件，请检查文件或拆分后重试",
        ),
      ),
    );
    worker.once("exit", (code) => {
      if (!settled) finish(new HttpError(422, "转换进程已结束，请重试"));
    });
  });
}
export async function importPowerPoint(input) {
  requireValue(
    typeof input.name === "string" && /\.(pptx|ppt)$/i.test(input.name),
    "请选择 .pptx 或 .ppt 文件",
  );
  requireValue(
    typeof input.base64 === "string" &&
      input.base64.length < 57 * 1024 * 1024 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(input.base64),
    "上传文件格式不正确或超过 40 MB",
  );
  requireValue(
    ["slides", "masters"].includes(input.mode),
    "请选择导入文稿或提取母版",
  );
  let bytes = Buffer.from(input.base64, "base64");
  requireValue(
    bytes.length > 0 && bytes.length <= 40 * 1024 * 1024,
    "PowerPoint 文件需小于 40 MB",
  );
  if (active >= 2) throw new HttpError(429, "已有文件正在转换，请稍后重试");
  active++;
  try {
    const legacy = bytes
      .subarray(0, 8)
      .equals(Buffer.from("d0cf11e0a1b11ae1", "hex"));
    if (legacy) bytes = await upgradeLegacy(bytes);
    else
      requireValue(
        bytes.subarray(0, 2).toString() === "PK",
        "无法识别 PowerPoint 文件格式",
      );
    const result = await parse(bytes, input.mode);
    if (legacy)
      result.warnings.unshift(
        "此文件由旧版 .ppt 转换，请检查字体与复杂对象的位置。",
      );
    return result;
  } finally {
    active--;
  }
}
