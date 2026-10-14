#!/usr/bin/env python3
"""Decode actual MP4 output and check CFR duration, codec, dimensions, colors and no audio."""
import json
import math
import pathlib
import subprocess
import sys

root = pathlib.Path(sys.argv[1])
video = root / "cfr.mp4"
metadata = json.loads(subprocess.check_output([
    "ffprobe", "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", str(video)
]))
streams = metadata["streams"]
assert len(streams) == 1 and streams[0]["codec_type"] == "video", streams
stream = streams[0]
expected_frames, elapsed = (root / "cfr-expected.txt").read_text().splitlines()
assert stream["codec_name"] == "h264" and stream["pix_fmt"] == "yuv420p", stream
assert (stream["width"], stream["height"]) == (32, 24), stream
assert stream["r_frame_rate"] == "30/1" and stream["avg_frame_rate"] == "30/1", stream
assert int(stream["nb_read_frames"]) == int(expected_frames), (stream, expected_frames)
assert abs(float(stream["duration"]) - float(elapsed)) <= 1 / 30 + .001, (stream, elapsed)
decoded = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(video), "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"])
frame_bytes = 32 * 24 * 3
assert len(decoded) == frame_bytes * int(expected_frames), len(decoded)
colors = [tuple(decoded[i:i+3]) for i in range(0, len(decoded), frame_bytes)]
# First capture fills startup delay; last captured color persists through drops.
assert colors[0][0] > 150 and colors[0][0] > 3 * colors[0][1], colors[0]
assert any(g > 150 and g > 3 * r for r, g, b in colors), colors
assert colors[-1][2] > 150 and colors[-1][2] > 3 * colors[-1][0], colors[-1]
native = root / "native1080.mp4"
native_metadata = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(native)]))["streams"]
assert len(native_metadata) == 1
assert (native_metadata[0]["width"], native_metadata[0]["height"], native_metadata[0]["avg_frame_rate"]) == (1920, 1080, "30/1")
first_frame = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(native), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"])
top = tuple(first_frame[:3])
bottom = tuple(first_frame[(1079 * 1920) * 3:(1079 * 1920) * 3+3])
assert top[0] > 180 and top[2] < 50 and bottom[0] < 50 and bottom[2] > 180, (top, bottom)
print("PASS native1920x1080@30 real media preserves top-down RGBA orientation and red/blue channel order")
for candidate in root.rglob("*.mp4"):
    if candidate.name.startswith(".") or candidate.name in {"existing.mp4", "raced.mp4"} or candidate.stat().st_size == 0 or candidate.with_name(candidate.name + ".mct-recording.lock").exists():
        continue
    subprocess.check_call(["ffmpeg", "-v", "error", "-i", str(candidate), "-f", "null", "-"])
print("PASS actual FFmpeg/ffprobe media: H.264, yuv420p, exact CFR frame count, wall-clock duration, RGB capture sequence, complete decode, no audio")
print(json.dumps({"expected_frames": int(expected_frames), "elapsed_seconds": float(elapsed), "video": stream}, indent=2))
