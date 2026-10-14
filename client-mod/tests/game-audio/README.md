# Native OpenAL adapter regression fixtures

Run `sh client-mod/tests/game-audio/run-tests.sh` on Linux with JDK 17+ and
`MCT_TEST_LWJGL_DIR` pointing to the four LWJGL 3.3.1 core/OpenAL jars (Java and
Linux natives). The regression workflow downloads them from Maven Central and
verifies their SHA-256 hashes.

The tests compile the actual 1.20.1 audio adapter, replacing only its shared
recorder sink with an observable test double. They exercise real OpenAL Soft
loopback and null-output tee contexts, nonzero synthetic source PCM, monotonic
sample timing, short executor-stall resynchronization, explicit long-stall
failure, and bounded close before native device destruction.

The generated tone is a test fixture, never the demonstration soundtrack. These
tests do not establish live Minecraft integration, physical speaker output,
subjective listening quality, or macOS/Windows support. See
[the validation report](../../../docs/recording-validation.md) for separate
real-game sample evidence.
