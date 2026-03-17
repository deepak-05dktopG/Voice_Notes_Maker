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
- If the wallet balance shows an error, your Deepgram API key likely lacks billing permissions (often `billing:read`). Create an API key with billing access for the project.
- If transcription is empty, try speaking louder/closer or use a different browser.

## Deploy

### Deploy server on Render
- Create a new **Web Service** from this repo.
- Root directory: `server`
- Build command: `npm install`
- Start command: `npm start`
- Environment variables:
	- `DEEPGRAM_API_KEY` = your key
	- (optional) `DEEPGRAM_PROJECT_ID` = project id
	- `PORT` is provided by Render automatically

### Deploy client on Netlify
- Create a new **Site** from this repo.
- Netlify config is already included at [netlify.toml](netlify.toml).
- Set environment variable in Netlify:
	- `VITE_API_BASE_URL` = your Render service URL (example: `https://your-app.onrender.com`)

After deploy, the client will call `${VITE_API_BASE_URL}/balance` and `${VITE_API_BASE_URL}/transcribe`.
