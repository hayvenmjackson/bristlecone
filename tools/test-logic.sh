#!/usr/bin/env bash
# Runs the plain-Java logic tests (stride model, dead reckoning, cache policy).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=build/test && rm -rf "$OUT" && mkdir -p "$OUT"
javac -nowarn -d "$OUT" app/src/main/java/app/bristlecone/{StrideModel,DeadReckoner,CachePolicy,TrackStats}.java app/src/test/java/app/bristlecone/LogicTest.java
java -cp "$OUT" app.bristlecone.LogicTest
