import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { MctError } from "../util/errors.js";
import { proxyAwareFetch } from "./HttpClient.js";

/** Cached files are trusted by existence, so a reader must never see a partial write. */
export async function writeFileAtomically(
  targetPath: string,
  content: Uint8Array | string,
) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.part`;
  try {
    await writeFile(temporaryPath, content, { flag: "wx" });
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function copyFileIfMissing(
  sourcePath: string,
  targetPath: string,
) {
  await writeFileAtomically(targetPath, await readFile(sourcePath));
}

export async function downloadFile(
  url: string,
  targetPath: string,
  fetchImpl: typeof fetch = proxyAwareFetch,
) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new MctError(
      {
        code: "DOWNLOAD_FAILED",
        message: `Failed to download ${url}`,
        details: {
          status: response.status,
        },
      },
      2,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeFileAtomically(targetPath, Buffer.from(arrayBuffer));
}
