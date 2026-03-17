# voice-notes-maker

Minimal voice-to-text notes app using Deepgram.

## Prereqs
- Node.js 18+ (Node 20+ recommended)
- A Deepgram API key

## Setup

### 1) Server

```bash
cd server
npm install
```

Create `.env`:

```bash
# copy and edit
copy .env.example .env
```

Set:
- `DEEPGRAM_API_KEY=...`
- (optional) `DEEPGRAM_PROJECT_ID=...`

Run server:

```bash
npm run dev
```

Server runs on `http://localhost:3001`.

### 2) Client

```bash
cd ../client
npm install
npm run dev
```

Client runs on `http://localhost:5173` and proxies `/transcribe` and `/balance` to the server.

## How it works
- Client records audio with the browser `MediaRecorder`
- On stop, it uploads audio as `multipart/form-data` (`audio` field) to `POST /transcribe`
- Server forwards raw audio bytes to Deepgram `POST https://api.deepgram.com/v1/listen...`
- Client fetches wallet balance from `GET /balance` on load

## API
- `POST /transcribe` → `{ text, raw }`
- `GET /balance` → `{ amount, unit, projectId, raw }`

## Notes
- If `/balance` fails, ensure your API key has access to Projects/Billing endpoints.
- If transcription is empty, try speaking louder/closer or use a different browser.
