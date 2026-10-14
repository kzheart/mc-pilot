#!/bin/sh
# Linux native loopback/tee fixture, not live Minecraft soundtrack evidence.
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../../.." && pwd)
SRC=$ROOT/client-mod/version-1.20.1/src/main/java
: "${MCT_TEST_LWJGL_DIR:?Set MCT_TEST_LWJGL_DIR to the four pinned LWJGL 3.3.1 jars}"
JAVA=${JAVA_HOME:+$JAVA_HOME/bin/}java
JAVAC=${JAVA_HOME:+$JAVA_HOME/bin/}javac
CP=$MCT_TEST_LWJGL_DIR/lwjgl-3.3.1.jar:$MCT_TEST_LWJGL_DIR/lwjgl-openal-3.3.1.jar
NATIVE=$MCT_TEST_LWJGL_DIR/lwjgl-3.3.1-natives-linux.jar:$MCT_TEST_LWJGL_DIR/lwjgl-openal-3.3.1-natives-linux.jar
OUT=$(mktemp -d "${TMPDIR:-/tmp}/mct-game-audio.XXXXXX")
trap 'rm -rf "$OUT"' EXIT HUP INT TERM
"$JAVAC" --release 17 -cp "$CP" -d "$OUT" "$HERE/src/com/mct/core/recording/AudioCapture.java" "$SRC/com/mct/audio/"*.java "$HERE/src/AudioSmoke.java" "$HERE/src/AudioTimingSmoke.java"
ALSOFT_DRIVERS=null "$JAVA" -cp "$OUT:$CP:$NATIVE" AudioSmoke
ALSOFT_DRIVERS=null "$JAVA" -cp "$OUT:$CP:$NATIVE" AudioTimingSmoke
