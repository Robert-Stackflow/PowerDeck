import yauzl from "yauzl";
import { HttpError, requireValue } from "./content.mjs";
const MB = 1024 * 1024;

// Read entries in memory, never extract untrusted archive paths to disk.
export async function readZip(
  buffer,
  {
    label = "ZIP",
    maxCompressed = 40 * MB,
    maxTotal = 180 * MB,
    maxEntry = 24 * MB,
    maxEntries = 10000,
  } = {},
) {
  requireValue(
    buffer.length <= maxCompressed,
    `${label} 文件需小于 ${maxCompressed / MB} MB`,
  );
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error)
          return reject(
            new HttpError(
              400,
              `无法读取 ${label} 文件，请检查文件是否完整或加密`,
            ),
          );
        const files = new Map(),
          paths = new Set();
        let size = 0,
          count = 0,
          stopped = false;
        const fail = (error) => {
          if (stopped) return;
          stopped = true;
          zip.close();
          reject(
            error instanceof HttpError
              ? error
              : new HttpError(400, `${label} 压缩包损坏或路径不正确`),
          );
        };
        zip.on("error", fail);
        zip.on("end", () => {
          if (!stopped) resolve(files);
        });
        zip.on("entry", (entry) => {
          if (stopped) return;
          size += entry.uncompressedSize;
          if (
            ++count > maxEntries ||
            size > maxTotal ||
            entry.uncompressedSize > maxEntry
          )
            return fail(new HttpError(413, "文件解压后过大，请拆分后导入"));
          if (entry.generalPurposeBitFlag & 1)
            return fail(new HttpError(400, `请先移除 ${label} 文件密码`));
          const name = entry.fileName,
            key = name.toLowerCase();
          if (
            name.includes("\\") ||
            name.includes("\0") ||
            name.split("/").includes("..") ||
            name.startsWith("/") ||
            paths.has(key) ||
            ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000
          )
            return fail(new HttpError(400, `${label} 文件路径不正确或重复`));
          paths.add(key);
          if (name.endsWith("/")) return zip.readEntry();
          zip.openReadStream(entry, (error, stream) => {
            if (error) return fail(error);
            const chunks = [];
            let actual = 0;
            stream.on("error", fail);
            stream.on("data", (chunk) => {
              actual += chunk.length;
              if (actual > entry.uncompressedSize || actual > maxEntry) {
                stream.destroy();
                fail(new HttpError(413, "文件解压后过大"));
              } else chunks.push(chunk);
            });
            stream.on("end", () => {
              if (stopped) return;
              files.set(name, Buffer.concat(chunks));
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}
