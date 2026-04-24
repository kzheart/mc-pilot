import { Command } from "commander";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

import { wrapCommand } from "../util/command.js";
import { MctError } from "../util/errors.js";
import { resolveProjectRelativePath } from "./request-helpers.js";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Pixel {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
}

function parseRect(value: string | undefined, field: string): Rect | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new MctError({ code: "INVALID_PARAMS", message: `${field} must use x,y,w,h format.` }, 4);
  }
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

function parseRgb(value: string | undefined): [number, number, number] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) {
    throw new MctError({ code: "INVALID_PARAMS", message: "--background must use r,g,b format." }, 4);
  }
  return [parts[0], parts[1], parts[2]];
}

function loadPng(file: string) {
  return PNG.sync.read(readFileSync(file));
}

function pixelOffset(image: PNG, x: number, y: number) {
  return (image.width * y + x) << 2;
}

function colorDistance(a: [number, number, number], b: [number, number, number]) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

function clampRect(rect: Rect | undefined, image: PNG): Rect {
  const raw = rect ?? { x: 0, y: 0, width: image.width, height: image.height };
  const x = Math.max(0, Math.min(image.width, Math.floor(raw.x)));
  const y = Math.max(0, Math.min(image.height, Math.floor(raw.y)));
  const right = Math.max(x, Math.min(image.width, Math.floor(raw.x + raw.width)));
  const bottom = Math.max(y, Math.min(image.height, Math.floor(raw.y + raw.height)));
  return { x, y, width: right - x, height: bottom - y };
}

function findForegroundBounds(image: PNG, options: { background?: [number, number, number]; threshold: number; alphaThreshold: number; region?: Rect }) {
  const region = clampRect(options.region, image);
  const background = options.background ?? [
    image.data[pixelOffset(image, 0, 0)],
    image.data[pixelOffset(image, 0, 0) + 1],
    image.data[pixelOffset(image, 0, 0) + 2]
  ] as [number, number, number];

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  let pixels = 0;

  for (let y = region.y; y < region.y + region.height; y++) {
    for (let x = region.x; x < region.x + region.width; x++) {
      const offset = pixelOffset(image, x, y);
      const a = image.data[offset + 3];
      const rgb: [number, number, number] = [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
      if (a > options.alphaThreshold && colorDistance(rgb, background) > options.threshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        pixels++;
      }
    }
  }

  if (pixels === 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, pixels };
}

function collectTemplatePixels(template: PNG, alphaThreshold: number, maxSamples: number): Pixel[] {
  const pixels: Pixel[] = [];
  for (let y = 0; y < template.height; y++) {
    for (let x = 0; x < template.width; x++) {
      const offset = pixelOffset(template, x, y);
      if (template.data[offset + 3] > alphaThreshold) {
        pixels.push({ x, y, r: template.data[offset], g: template.data[offset + 1], b: template.data[offset + 2] });
      }
    }
  }
  if (pixels.length <= maxSamples) return pixels;

  const stride = pixels.length / maxSamples;
  const sampled: Pixel[] = [];
  for (let i = 0; i < maxSamples; i++) {
    sampled.push(pixels[Math.floor(i * stride)]);
  }
  return sampled;
}

function scoreTemplateAt(screenshot: PNG, samples: Pixel[], x: number, y: number, scale: number) {
  let score = 0;
  let compared = 0;
  for (const sample of samples) {
    const sx = Math.round(x + sample.x * scale);
    const sy = Math.round(y + sample.y * scale);
    if (sx < 0 || sy < 0 || sx >= screenshot.width || sy >= screenshot.height) continue;
    const offset = pixelOffset(screenshot, sx, sy);
    score += Math.abs(screenshot.data[offset] - sample.r) +
      Math.abs(screenshot.data[offset + 1] - sample.g) +
      Math.abs(screenshot.data[offset + 2] - sample.b);
    compared++;
  }
  return compared === 0 ? Number.POSITIVE_INFINITY : score / compared;
}

export function createImageCommand() {
  const command = new Command("image").description("Image analysis helpers for screenshots and UI offset tuning");

  command
    .command("bbox")
    .description("Find the foreground bounding box in a PNG image")
    .argument("<image>", "PNG image path")
    .option("--background <rgb>", "Background color to ignore, format r,g,b. Defaults to top-left pixel.")
    .option("--threshold <value>", "RGB distance threshold", (value) => Number(value), 24)
    .option("--alpha-threshold <value>", "Alpha threshold", (value) => Number(value), 8)
    .option("--region <rect>", "Optional scan region x,y,w,h")
    .action(
      wrapCommand(async (context, { args, options }: { args: (string | undefined)[]; options: { background?: string; threshold: number; alphaThreshold: number; region?: string } }) => {
        const imagePath = resolveProjectRelativePath(context, args[0] ?? "");
        const image = loadPng(imagePath);
        const bbox = findForegroundBounds(image, {
          background: parseRgb(options.background),
          threshold: Number(options.threshold),
          alphaThreshold: Number(options.alphaThreshold),
          region: parseRect(options.region, "--region")
        });
        return {
          image: path.resolve(imagePath),
          size: { width: image.width, height: image.height },
          bbox,
          center: bbox ? { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 } : null
        };
      })
    );

  command
    .command("locate-template")
    .description("Locate a transparent PNG template inside a screenshot, useful for tuning GUI title offsets")
    .argument("<screenshot>", "Screenshot PNG path")
    .argument("<template>", "Template PNG path")
    .option("--region <rect>", "Screenshot search region x,y,w,h")
    .option("--expected <rect>", "Expected rectangle x,y,w,h; output includes delta from it")
    .option("--scale <value>", "Single scale to test", (value) => Number(value))
    .option("--min-scale <value>", "Minimum scale", (value) => Number(value), 0.5)
    .option("--max-scale <value>", "Maximum scale", (value) => Number(value), 3)
    .option("--scale-step <value>", "Scale step", (value) => Number(value), 0.1)
    .option("--stride <pixels>", "Search stride in screenshot pixels", (value) => Number(value), 2)
    .option("--alpha-threshold <value>", "Template alpha threshold", (value) => Number(value), 16)
    .option("--max-samples <count>", "Maximum template pixels to sample", (value) => Number(value), 4000)
    .action(
      wrapCommand(async (context, { args, options }: {
        args: (string | undefined)[];
        options: {
          region?: string;
          expected?: string;
          scale?: number;
          minScale: number;
          maxScale: number;
          scaleStep: number;
          stride: number;
          alphaThreshold: number;
          maxSamples: number;
        };
      }) => {
        const screenshotPath = resolveProjectRelativePath(context, args[0] ?? "");
        const templatePath = resolveProjectRelativePath(context, args[1] ?? "");
        const screenshot = loadPng(screenshotPath);
        const template = loadPng(templatePath);
        const region = clampRect(parseRect(options.region, "--region"), screenshot);
        const expected = parseRect(options.expected, "--expected");
        const samples = collectTemplatePixels(template, Number(options.alphaThreshold), Number(options.maxSamples));
        if (samples.length === 0) {
          throw new MctError({ code: "INVALID_PARAMS", message: "Template has no visible pixels after alpha filtering." }, 4);
        }

        const scales = options.scale
          ? [Number(options.scale)]
          : Array.from(
            { length: Math.max(1, Math.floor((Number(options.maxScale) - Number(options.minScale)) / Number(options.scaleStep)) + 1) },
            (_, index) => Number((Number(options.minScale) + index * Number(options.scaleStep)).toFixed(4))
          );

        let best: { x: number; y: number; scale: number; score: number; compared: number } | undefined;
        for (const scale of scales) {
          const width = Math.round(template.width * scale);
          const height = Math.round(template.height * scale);
          for (let y = region.y - height; y <= region.y + region.height; y += Number(options.stride)) {
            for (let x = region.x - width; x <= region.x + region.width; x += Number(options.stride)) {
              const score = scoreTemplateAt(screenshot, samples, x, y, scale);
              if (!best || score < best.score) {
                best = { x, y, scale, score, compared: samples.length };
              }
            }
          }
        }

        if (!best) {
          throw new MctError({ code: "INVALID_STATE", message: "No template match candidate found." }, 3);
        }

        const bbox = {
          x: best.x,
          y: best.y,
          width: Math.round(template.width * best.scale),
          height: Math.round(template.height * best.scale)
        };
        const center = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
        const expectedCenter = expected ? { x: expected.x + expected.width / 2, y: expected.y + expected.height / 2 } : undefined;

        return {
          screenshot: path.resolve(screenshotPath),
          template: path.resolve(templatePath),
          screenshotSize: { width: screenshot.width, height: screenshot.height },
          templateSize: { width: template.width, height: template.height },
          samples: samples.length,
          match: {
            bbox,
            center,
            scale: best.scale,
            score: Number(best.score.toFixed(3))
          },
          expected: expected
            ? {
              bbox: expected,
              center: expectedCenter,
              delta: {
                x: Number((center.x - expectedCenter!.x).toFixed(3)),
                y: Number((center.y - expectedCenter!.y).toFixed(3))
              }
            }
            : undefined
        };
      })
    );

  return command;
}
