#!/bin/sh
# Re-creates untracked vendored checkouts at the pinned commits (VENDORED.md).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -d vendor/deepseek-harness ]; then
  git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git vendor/deepseek-harness
  git -C vendor/deepseek-harness checkout 22ddee3792402c3e70ec5f86a63c3e3e895a2f60 2>/dev/null || true
  rm -rf vendor/deepseek-harness/.git
fi

if [ ! -d vendor/dsh-tui/vendor/dsh-std ]; then
  git clone https://github.com/T-Auto/dsh-std.git vendor/dsh-tui/vendor/dsh-std
  git -C vendor/dsh-tui/vendor/dsh-std checkout 614dfa1ac168db79fcf4577cf0ebb34e2e3b944b
  rm -rf vendor/dsh-tui/vendor/dsh-std/.git
fi

echo "vendor checkouts ready."
