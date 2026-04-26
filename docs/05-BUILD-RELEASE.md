# Build & Release Guide - WebRTC Voice Streaming

Quick reference for building, versioning, and releasing new versions.

---

## 🏗️ Build Commands

### Frontend

| When                   | Command              | Notes                          |
| ---------------------- | -------------------- | ------------------------------ |
| **After TS changes**   | `npm run build`      | Required before commit         |
| **During development** | `npm run dev`        | Watch mode, auto-rebuild       |
| **Before release**     | `npm run build`      | Always run before version bump |
| **Type checking**      | `npm run type-check` | Optional, catches TS errors    |

**Location:** `frontend/` directory

```bash
cd frontend
npm install          # First time only
npm run build        # Build for production
```

**Output:** `frontend/dist/` (committed to repo)

### Backend

| When                | Command                                                     | Notes                |
| ------------------- | ----------------------------------------------------------- | -------------------- |
| **No build needed** | -                                                           | Python runs directly |
| **Test locally**    | `python webrtc_server_relay.py`                             | Development mode     |
| **With SSL**        | `export SSL_CERT_FILE=... && python webrtc_server_relay.py` | Production-like      |

**Location:** Root directory

```bash
# Install dependencies (first time only)
pip install -r requirements.txt

# Run server
python webrtc_server_relay.py
```

**No build step** - Python files run directly.

---

## 📦 When to Rebuild Frontend

### ✅ Run `npm run build` When:

- Modified any `.ts` files in `frontend/src/`
- Updated `package.json` dependencies
- Changed `rollup.config.js`
- Before every release/PR

### ❌ Don't Run `npm run build` When:

- Only changed Python files (`.py`)
- Only changed configuration (`.yaml`, `.sh`)
- Only changed documentation (`.md`)
- Only changed `Dockerfile` or `.gitignore`

---

## 🔢 Version Bump Procedure

### Files to Update

| File                    | Version Location  | Format                  |
| ----------------------- | ----------------- | ----------------------- |
| `config.yaml`           | Line 2            | `version: "1.1.6"`      |
| `frontend/package.json` | Line 3            | `"version": "1.2.0"`    |
| `build.yaml`            | Line 6            | `CACHE_BUSTER: "1.1.6"` |
| `frontend/src/*.ts`     | Card registration | `version: "1.2.0"`      |

### Step-by-Step

```bash
# 1. Determine new version (SemVer)
# MAJOR.MINOR.PATCH
# - MAJOR: Breaking changes
# - MINOR: New features (backward compatible)
# - PATCH: Bug fixes

# 2. Update config.yaml
# Edit: version: "1.1.6" → "1.1.7"

# 3. Update frontend/package.json
cd frontend
# Edit: "version": "1.2.0" → "1.2.1"

# 4. Update build.yaml
# Edit: CACHE_BUSTER: "1.1.6" → "1.1.7"

# 5. Update frontend card versions
# Edit: frontend/src/voice-sending-card.ts (line ~220)
# Edit: frontend/src/voice-receiving-card.ts (line ~380)

# 6. Build frontend
npm run build
cd ..

# 7. Commit changes
git add -A
git commit -m "chore: bump version to 1.1.7"

# 8. Tag release
git tag -a v1.1.7 -m "Release version 1.1.7"
git push origin v1.1.7
```

---

## 🚀 Release Checklist

### Pre-Release

- [ ] All changes tested locally
- [ ] Frontend built (`npm run build`)
- [ ] Version numbers updated (4 files)
- [ ] CHANGELOG.md updated (if exists)
- [ ] Documentation updated

### Build & Push

```bash
# 1. Ensure clean working directory
git status
git add -A
git commit -m "chore: prepare release v1.1.7"

# 2. Build frontend
cd frontend && npm run build && cd ..

# 3. Tag release
git tag -a v1.1.7 -m "Release version 1.1.7"

# 4. Push everything
git push origin main
git push origin v1.1.7
```

### Post-Release

- [ ] Verify GitHub release created
- [ ] Test add-on installation
- [ ] Update Home Assistant community thread
- [ ] Monitor issues for regression reports

---

## 🐳 Docker Build (Optional)

### Local Testing

```bash
# Build image
docker build -t webrtc-voice-streaming:local .

# Run container
docker run -d \
  --name webrtc-test \
  --network host \
  -v $(pwd)/config:/config:rw \
  webrtc-voice-streaming:local

# Check logs
docker logs -f webrtc-test

# Cleanup
docker stop webrtc-test && docker rm webrtc-test
```

### Multi-Architecture Build (for publishing)

```bash
# Install QEMU (for cross-platform builds)
docker run --privileged --rm tonistiigi/binfmt --install all

# Build for multiple architectures
docker buildx build \
  --platform linux/amd64,linux/arm64,linux/arm/v7 \
  -t ghcr.io/ahmed9190/webrtc-voice-streaming:1.1.7 \
  --push \
  .
```

---

## 📝 Common Scenarios

### Scenario 1: Quick Bug Fix

```bash
# 1. Fix bug in Python file
# 2. Test locally
python webrtc_server_relay.py

# 3. Bump PATCH version
# config.yaml: 1.1.6 → 1.1.7
# build.yaml: 1.1.6 → 1.1.7

# 4. Commit & push
git add -A && git commit -m "fix: [description]"
git tag -a v1.1.7 -m "v1.1.7"
git push origin main v1.1.7
```

### Scenario 2: Frontend Feature

```bash
# 1. Modify frontend/src/*.ts
# 2. Test with dev server
cd frontend && npm run dev

# 3. Build for production
npm run build

# 4. Bump MINOR version (new feature)
# config.yaml: 1.1.6 → 1.2.0
# frontend/package.json: 1.2.0 → 1.3.0
# build.yaml: 1.1.6 → 1.2.0

# 5. Commit & push
git add -A && git commit -m "feat: [description]"
git tag -a v1.2.0 -m "v1.2.0"
git push origin main v1.2.0
```

### Scenario 3: Configuration Only

```bash
# 1. Modify config.yaml or Dockerfile
# 2. NO frontend rebuild needed
# 3. Bump PATCH version
# 4. Commit & push
```

---

## ⚠️ Common Mistakes

### ❌ Forgetting to Build Frontend

**Symptom:** Changes don't appear after deployment

**Fix:**

```bash
cd frontend && npm run build
git add frontend/dist/
```

### ❌ Inconsistent Version Numbers

**Symptom:** Confusing release history, cache issues

**Fix:** Update ALL 4 version locations together

### ❌ Committing node_modules

**Symptom:** Huge PRs, conflicts

**Fix:** `node_modules/` is in `.gitignore` - don't force add

### ❌ Not Testing After Build

**Symptom:** Broken production builds

**Fix:** Always test locally after `npm run build`

---

## 🔍 Quick Reference

```bash
# Frontend build
cd frontend && npm run build

# Backend test
python webrtc_server_relay.py

# Version locations
grep -n "version" config.yaml
grep -n "version" frontend/package.json
grep -n "CACHE_BUSTER" build.yaml
grep -n "version:" frontend/src/*.ts

# Git workflow
git add -A
git commit -m "type: message"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main vX.Y.Z
```

---

**Last Updated:** 2026-03-17  
**Maintainer:** Ahmed9190
