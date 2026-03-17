import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { MctError } from "../util/errors.js";

export async function copyFileIfMissing(sourcePath: string, targetPath: string) {
  const content = await readFile(sourcePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content);
}

export async function downloadFile(
  url: string,
  targetPath: string,
  fetchImpl: typeof fetch = fetch
) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new MctError(
      {
        code: "DOWNLOAD_FAILED",
        message: `Failed to download ${url}`,
        details: {
          status: response.status
        }
      },
      2
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, Buffer.from(arrayBuffer));
}
