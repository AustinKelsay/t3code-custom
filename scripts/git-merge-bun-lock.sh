#!/bin/sh
set -eu

ancestor_path=$1
current_path=$2
other_path=$3

# bun.lock is generated from the workspace manifests. Prefer the incoming version
# to clear conflict markers quickly, then regenerate from the resolved manifests.
cat "$other_path" > "$current_path"

