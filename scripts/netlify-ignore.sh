#!/usr/bin/env bash
# Netlify runs this before every build. Exit 0 = skip the build, exit 1 = build.
#
# Production deploys cost 15 credits each. Preview and branch deploys are free.
# So production only builds when main receives an approved pull request
# (or a commit whose message starts with "release:").

# Skip any build where only documentation changed.
# Netlify sets CACHED_COMMIT_REF equal to COMMIT_REF when there is no earlier build
# (like the first production deploy). Comparing a commit with itself shows no changes,
# so only compare when the two differ.
if [ -n "$CACHED_COMMIT_REF" ] && [ -n "$COMMIT_REF" ] && [ "$CACHED_COMMIT_REF" != "$COMMIT_REF" ] && \
   git diff --quiet "$CACHED_COMMIT_REF" "$COMMIT_REF" -- . ':(exclude)*.md' ':(exclude)docs/' ':(exclude).github/' 2>/dev/null; then
  echo "Only docs changed. Skipping build."
  exit 0
fi

if [ "$CONTEXT" != "production" ]; then
  exit 1  # preview and branch deploys are free, always build
fi

msg="$(git log -1 --pretty=%s)"
if echo "$msg" | grep -qE '^Merge pull request #|\(#[0-9]+\)$|^release:'; then
  echo "Approved change on main: building production."
  exit 1
fi

echo "Commit on main did not come from an approved pull request: \"$msg\". Skipping production deploy."
exit 0
