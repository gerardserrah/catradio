---
trigger: always_on
---
# Auto-Push to GitHub

Whenever you complete a task that modifies, creates, or deletes files in this repository (`/Users/Gerard/.gemini/antigravity/scratch/catradio`):
1. Stage the changes (`git add`).
2. Commit with a clear, descriptive message (`git commit -m "..."`).
3. Push the changes to `origin main` (`git push origin main`).

Note: On this machine, `/usr/bin/git` may fail due to an `xcrun` architecture mismatch; use `/Library/Developer/CommandLineTools/usr/bin/git` directly, and run `git push` with `BypassSandbox: true` so it has network access.
