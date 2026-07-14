import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { chromium } from "playwright-core";

const width = 1280;
const height = 720;
const slideDurations = [
  4000, 4000, 4000, 5000, 4500, 11000, 4000, 4500, 6000, 4000, 4000, 4000, 4000,
];
const workspace = resolve(import.meta.dir, "..");
const presentation = join(workspace, "presentation");
const output = resolve(workspace, process.argv[2] ?? "presentation/warden-preview.mp4");
const chromeCandidates = [
  process.env.CHROME_PATH,
  Bun.which("google-chrome"),
  Bun.which("chromium"),
  Bun.which("chromium-browser"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
const chrome = chromeCandidates[0];
const ffmpeg = process.env.FFMPEG_PATH ?? Bun.which("ffmpeg");

if (!chrome)
  throw new Error("Chrome or Chromium was not found. Set CHROME_PATH to its executable.");
if (!ffmpeg)
  throw new Error("ffmpeg was not found. Install it or set FFMPEG_PATH to its executable.");

const temporary = await mkdtemp(join(tmpdir(), "warden-presentation-"));
const frames = join(temporary, "frames");
await mkdir(frames);
await mkdir(dirname(output), { recursive: true });

const server = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = resolve(presentation, `.${pathname}`);
    if (relative(presentation, filePath).startsWith(".."))
      return new Response("Not found", { status: 404 });
    const file = Bun.file(filePath);
    return file
      .exists()
      .then((found) => (found ? new Response(file) : new Response("Not found", { status: 404 })));
  },
});

const browser = await chromium.launch({ executablePath: chrome, headless: true });

try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Reflect.get(globalThis, "Reveal")?.isReady());
  const slideCount = await page.locator(".slides > section").count();
  const durations = Array.from({ length: slideCount }, (_, index) => slideDurations[index] ?? 4000);
  const captureDuration = durations.reduce((total, duration) => total + duration, 0) / 1000;
  const session = await page.context().newCDPSession(page);
  const captured: Array<{ path: string; timestamp: number }> = [];
  const writes: Array<Promise<void>> = [];

  session.on("Page.screencastFrame", (event) => {
    const path = join(frames, `${String(captured.length).padStart(6, "0")}.jpg`);
    captured.push({ path, timestamp: event.metadata.timestamp ?? performance.now() / 1000 });
    writes.push(writeFile(path, event.data, "base64"));
    void session.send("Page.screencastFrameAck", { sessionId: event.sessionId });
  });

  await session.send("Page.startScreencast", {
    format: "jpeg",
    quality: 92,
    maxWidth: width,
    maxHeight: height,
    everyNthFrame: 1,
  });

  for (let index = 0; index < slideCount; index += 1) {
    await page.waitForTimeout(durations[index]);
    if (index < slideCount - 1) await page.evaluate(() => Reflect.get(globalThis, "Reveal").next());
  }

  await session.send("Page.stopScreencast");
  await Promise.all(writes);
  if (captured.length < 2) throw new Error(`Chrome captured only ${captured.length} frame(s).`);

  const timing = captured
    .map((frame, index) => {
      const next = captured[index + 1];
      const elapsed = frame.timestamp - captured[0].timestamp;
      const duration = next
        ? Math.max(0.001, next.timestamp - frame.timestamp)
        : Math.max(0.04, captureDuration - elapsed);
      return `file '${frame.path.replaceAll("'", "'\\''")}'\nduration ${duration.toFixed(6)}`;
    })
    .join("\n");
  const manifest = join(temporary, "frames.txt");
  await writeFile(
    manifest,
    `${timing}\nfile '${captured.at(-1)?.path.replaceAll("'", "'\\''")}'\n`,
  );

  const encoder = Bun.spawn(
    [
      ffmpeg,
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      manifest,
      "-vf",
      `fps=25,scale=${width}:${height}:flags=lanczos:in_range=full:out_range=tv,format=yuv420p`,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "21",
      "-movflags",
      "+faststart",
      output,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  const exitCode = await encoder.exited;
  if (exitCode !== 0) throw new Error(`ffmpeg exited with status ${exitCode}.`);
  console.log(`Recorded ${captured.length} frames to ${output}`);
} finally {
  await browser.close();
  server.stop(true);
  await rm(temporary, { recursive: true, force: true });
}
