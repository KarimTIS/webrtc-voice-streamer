# Onboarding Checklist - WebRTC Voice Streaming Backend

## For New Developers

Welcome to the WebRTC Voice Streaming project! This checklist will guide you through setting up your development environment, understanding the codebase, and making your first contribution.

---

## Week 1: Setup & Orientation

### Day 1: Environment Setup

#### ☐ Install Prerequisites

- [ ] Python 3.10+ installed (`python3 --version`)
- [ ] Node.js 20+ installed (`node --version`)
- [ ] Git configured (`git config --global user.email "you@example.com"`)
- [ ] Docker installed (optional, for add-on testing)
- [ ] Home Assistant OS/Supervised (for full integration testing)

#### ☐ Clone Repository

```bash
git clone https://github.com/KarimTIS/webrtc-voice-streamer.git
cd webrtc-voice-streaming
```

#### ☐ Read Documentation

- [ ] Read `00-README-FIRST.md` (elevator pitch)
- [ ] Read `01-SETUP-GUIDE.md` (installation)
- [ ] Skim `02-ARCHITECTURE.md` (system design)
- [ ] Bookmark `04-GOTCHAS.md` (troubleshooting)

#### ☐ Setup Development Environment

```bash
# Backend
python3 -m venv venv
source venv/bin/activate  # Linux/Mac
pip install -r requirements.txt

# Frontend
cd frontend
npm install
npm run build
cd ..
```

---

### Day 2: First Run

#### ☐ Start Backend Server

```bash
# Development mode (no SSL)
python webrtc_server_relay.py

# Verify server started:
# Look for: "✅ Server successfully started on http://0.0.0.0:8080"
```

#### ☐ Test Health Endpoint

```bash
curl http://localhost:8080/health
# Expected: {"status": "healthy", "webrtc_available": true, ...}
```

#### ☐ Test MP3 Stream

```bash
curl http://localhost:8081/stream/status
# Expected: {"active_streams": []}
```

#### ☐ Start Frontend Dev Server

```bash
cd frontend
npm run dev

# Open browser: http://localhost:8080
# Should see CA certificate download page
```

#### ☐ Verify Browser Access

- [ ] Open browser to http://localhost:8080
- [ ] No certificate errors (HTTP, not HTTPS)
- [ ] Browser console shows no errors

---

### Day 3: Code Exploration

#### ☐ Trace Request Flow

**Task:** Follow a WebSocket message from client to server

1. Start at `frontend/src/webrtc-manager.ts` line 180 (`sendWebSocketMessage`)
2. Trace to `webrtc_server_relay.py` line 100 (`websocket_handler`)
3. Follow to `handle_message` line 130
4. See message routing to `setup_sender` or `setup_receiver`

**Deliverable:** Draw a diagram showing the message flow

#### ☐ Understand MediaRelay

**Task:** Trace how audio flows from sender to receiver

1. Start at `webrtc_server_relay.py` line 17 (`self.relay = MediaRelay()`)
2. Find `relay.subscribe(track)` in `setup_sender` (line 180)
3. Find `relay.subscribe(source_track)` in `setup_receiver` (line 115)
4. Understand how one track becomes multiple consumers

**Deliverable:** Write a 3-sentence explanation of MediaRelay pattern

#### ☐ Explore SSL Cascade

**Task:** Understand certificate generation

1. Read `ssl-setup.sh` from top to bottom
2. Identify the three priority levels
3. Find where certificates are generated (OpenSSL commands)
4. Locate where SANs are defined

**Deliverable:** List all SANs included in generated certificate

---

### Day 4: First Code Change

#### ☐ Add Logging Statement

**Task:** Add debug logging to understand message flow

```python
# File: webrtc_server_relay.py
# Location: handle_message method (line 130)

async def handle_message(self, connection_id: str, data: dict):
    message_type = data.get("type")
    logger.debug(f"[{connection_id}] Received message type: {message_type}")  # Add this
    # ... rest of method
```

**Verify:**

```bash
# Restart server with debug logging
export LOG_LEVEL=debug
python webrtc_server_relay.py

# Connect client, see logs:
# [uuid] Received message type: start_sending
```

#### ☐ Change Frontend UI

**Task:** Modify card title color

```typescript
// File: frontend/src/voice-sending-card.ts
// Location: styles section (line 60)

.header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);  // Change this
  color: white;
  padding: 16px;
  border-radius: 8px 8px 0 0;
}
```

**Verify:**

```bash
cd frontend
npm run build
# Refresh browser, see new gradient
```

#### ☐ Submit First PR

- [ ] Create branch: `git checkout -b feature/onboarding-change`
- [ ] Commit changes: `git add -A && git commit -m "feat: add debug logging for message handling"`
- [ ] Push branch: `git push origin feature/onboarding-change`
- [ ] Open PR on GitHub
- [ ] Request review from maintainer

---

### Day 5: Testing & Debugging

#### ☐ Test WebRTC Connection

**Task:** Manually test sender → receiver flow

1. Open two browser tabs to http://localhost:8080
2. Tab 1: Add voice-sending-card, click microphone
3. Tab 2: Add voice-receiving-card, click "Auto Listen"
4. Verify audio flows (speak into mic, hear in receiver)
5. Check browser console for errors

**Expected:**

- Tab 1 shows: "connected", audio visualization active
- Tab 2 shows: "connected", audio playing
- Server logs show: "Received audio track", "Sent offer to receiver"

#### ☐ Debug a Problem

**Task:** Intentionally break something, then fix it

```python
# Break: Comment out MediaRelay subscription
# File: webrtc_server_relay.py, line 180
# viz_track = self.relay.subscribe(track)  # Comment this out

# Restart server
# Try to connect receiver
# Observe: No audio plays

# Fix: Uncomment line
# Verify: Audio works again
```

**Learn:** Understanding what breaks teaches you how it works

#### ☐ Run SSL Test Script

```bash
cd tests
bash verify_autossl.sh

# Expected: "ALL TESTS PASSED"
```

---

## Week 2: Deep Dive

### Day 6-7: Architecture Understanding

#### ☐ Draw System Architecture

**Task:** Create your own architecture diagram

Include:

- All major components (VoiceStreamingServer, AudioStreamServer, etc.)
- Data flow paths (sender → server → receiver)
- Protocols used (WebSocket, WebRTC, HTTP/MP3)
- Port numbers

**Compare:** Your diagram to `02-ARCHITECTURE.md`

#### ☐ Read Decision Log

**Task:** Read `03-DECISION-LOG.md` completely

For each ADR:

- [ ] Understand the problem
- [ ] Understand the decision
- [ ] Understand the consequences

**Discussion:** Pick one ADR, write a paragraph arguing for the alternative

#### ☐ Profile Performance

**Task:** Measure server performance

```bash
# Start server with profiling
python -m cProfile -o profile.stats webrtc_server_relay.py

# Connect 5 receivers
# Stop server

# Analyze profile
snakeviz profile.stats

# Identify bottlenecks
```

**Deliverable:** List top 3 CPU-consuming functions

---

### Day 8-9: Feature Implementation

#### ☐ Implement Small Feature

**Task:** Add latency display to receiver card

**Requirements:**

- Show current latency in milliseconds
- Update every second
- Color-code: green (<50ms), yellow (<150ms), red (>150ms)

**Starting Points:**

- `frontend/src/voice-receiving-card.ts` line 280 (latency state)
- `frontend/src/voice-receiving-card.ts` line 350 (render method)
- `frontend/src/webrtc-manager.ts` line 240 (latency calculation)

**Deliverable:** Working feature, submitted as PR

#### ☐ Write Unit Test

**Task:** Add first unit test for the project

```python
# File: tests/test_webrtc_server.py (create this)

import pytest
from webrtc_server_relay import VoiceStreamingServer

def test_server_initialization():
    server = VoiceStreamingServer()
    assert server.connections == {}
    assert server.active_streams == {}
    assert server.relay is not None
```

**Run:**

```bash
pip install pytest
pytest tests/
```

---

### Day 10: Code Review

#### ☐ Review Existing PRs

- [ ] Go to GitHub PRs
- [ ] Read through open PRs
- [ ] Leave constructive comments
- [ ] Ask questions about design decisions

#### ☐ Get Your PR Reviewed

- [ ] Respond to reviewer comments
- [ ] Make requested changes
- [ ] Get PR merged

#### ☐ Reflect

**Task:** Write a short reflection (5 minutes)

Questions:

- What was most surprising about the codebase?
- What was hardest to understand?
- What would you improve?

---

## Week 3: Contribution

### Day 11-14: First Major Task

#### ☐ Pick an Issue

**Options:**

- [ ] Add authentication (ADR-P002)
- [ ] Implement TURN server support (ADR-P001)
- [ ] Add stream access control (ADR-P003)
- [ ] Fix memory leak (Known Bug #15)
- [ ] Improve Safari compatibility (Known Bug #13)

**Or:** Propose your own feature (discuss with maintainer first)

#### ☐ Create Design Doc

**Task:** Write a one-page design

Template:

```markdown
# Feature: [Name]

## Problem

[What problem does this solve?]

## Proposed Solution

[High-level approach]

## Implementation Plan

1. [Step 1]
2. [Step 2]
3. [Step 3]

## Risks

[What could go wrong?]

## Testing

[How will you test it?]
```

#### ☐ Implement Feature

**Process:**

1. Create branch: `git checkout -b feature/your-feature`
2. Implement in small commits
3. Test frequently
4. Update documentation
5. Submit PR

---

## Month 2-3: Ownership

### ☐ Take Ownership of Module

**Pick One:**

- [ ] Backend signaling server
- [ ] Frontend cards
- [ ] SSL/Networking
- [ ] MP3 streaming
- [ ] Testing/CI

**Responsibilities:**

- Review PRs in your module
- Fix bugs in your module
- Improve documentation for your module
- Plan improvements for your module

### ☐ Improve Documentation

**Tasks:**

- [ ] Update outdated sections
- [ ] Add missing examples
- [ ] Create video tutorial
- [ ] Write troubleshooting guide

### ☐ Mentor New Developer

**Tasks:**

- [ ] Help new developer with onboarding
- [ ] Review their first PR
- [ ] Answer questions
- [ ] Share your learnings

---

## Knowledge Checks

### ☐ Can You Answer These Questions?

1. **Architecture:**
   - Q: What happens when a sender connects?
   - A: [You should be able to trace the full flow]

2. **Networking:**
   - Q: Why do we use host_network mode?
   - A: [Three reasons]

3. **WebRTC:**
   - Q: What's the difference between offer and answer?
   - A: [SDP negotiation explanation]

4. **Frontend:**
   - Q: How does the receiver know which stream to play?
   - A: [Stream selection logic]

5. **Security:**
   - Q: What are the security implications of no authentication?
   - A: [LAN isolation assumption]

### ☐ Can You Perform These Tasks?

1. **Debugging:**
   - [ ] Given a bug report, reproduce the issue
   - [ ] Use logging to identify root cause
   - [ ] Implement and test fix

2. **Feature Development:**
   - [ ] Given a feature request, design solution
   - [ ] Implement without breaking existing functionality
   - [ ] Write tests and documentation

3. **Code Review:**
   - [ ] Review another developer's PR
   - [ ] Identify potential issues
   - [ ] Suggest improvements

4. **Operations:**
   - [ ] Deploy new version to test environment
   - [ ] Monitor server health
   - [ ] Troubleshoot production issues

---

## Resources

### Documentation

- [00-README-FIRST.md](./00-README-FIRST.md) - Overview
- [01-SETUP-GUIDE.md](./01-SETUP-GUIDE.md) - Installation
- [02-ARCHITECTURE.md](./02-ARCHITECTURE.md) - Deep dive
- [03-DECISION-LOG.md](./03-DECISION-LOG.md) - Why things are
- [04-GOTCHAS.md](./04-GOTCHAS.md) - Troubleshooting

### External Resources

- [WebRTC Specification](https://www.w3.org/TR/webrtc/)
- [aiortc Documentation](https://aiortc.readthedocs.io/)
- [Lit Framework](https://lit.dev/)
- [Home Assistant Add-on SDK](https://developers.home-assistant.io/docs/add-ons/)

### People

- **Maintainer:** KarimTIS
- **Channel:** GitHub Issues / Home Assistant Community
- **Meeting:** [If applicable, add team meeting info]

---

## Completion Criteria

### ☐ Week 1 Complete When:

- [ ] Environment setup working
- [ ] Can run server locally
- [ ] Understand basic architecture
- [ ] Made first code contribution (even if trivial)

### ☐ Week 2 Complete When:

- [ ] Can trace full request flow
- [ ] Understand all architectural decisions
- [ ] Implemented small feature
- [ ] Wrote first unit test

### ☐ Week 3 Complete When:

- [ ] Working on major feature
- [ ] Comfortable with codebase
- [ ] Can debug issues independently

### ☐ Month 3 Complete When:

- [ ] Own a module
- [ ] Can review others' code
- [ ] Contributing regularly
- [ ] Helping onboard new developers

---

## Notes Section

Use this space for personal notes, questions, and insights:

```
Date: ___________
Note: ___________________________________________________

Date: ___________
Note: ___________________________________________________

Date: ___________
Note: ___________________________________________________
```

---

**Welcome to the team! 🎉**

If you have questions or get stuck, don't hesitate to ask. We all started somewhere, and the WebRTC learning curve is steep but rewarding.

**Last Updated:** 2024-03-17  
**Version:** 1.0
