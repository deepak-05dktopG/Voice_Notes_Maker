import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import multer from 'multer';

dotenv.config();
const DEFAULT_PORT = 3001;
const PORT = Number(process.env.PORT || DEFAULT_PORT);
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const DEEPGRAM_PROJECT_ID = process.env.DEEPGRAM_PROJECT_ID; // optional

if (!DEEPGRAM_API_KEY) {
  console.warn('⚠️  Missing DEEPGRAM_API_KEY in server .env');
}

const app = express();
app.use(cors());

// Multer in-memory upload (no DB / no disk persistence)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024 // 25MB
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/balance', async (req, res) => {
  try {
    if (!DEEPGRAM_API_KEY) {
      return res.status(500).json({ error: 'Server misconfigured: missing DEEPGRAM_API_KEY' });
    }

    // 1) Get projects (required by assessment)
    const projectsRes = await fetch('https://api.deepgram.com/v1/projects', {
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`
      }
    });

    const payload = await safeJson(projectsRes);
    if (!projectsRes.ok) {
      return res
        .status(projectsRes.status)
        .json({ error: 'Deepgram projects request failed', details: payload });
    }

    const projects = Array.isArray(payload?.projects) ? payload.projects : [];
    if (projects.length === 0) {
      return res.status(500).json({ error: 'Deepgram response did not include any projects', details: payload });
    }

    // Prefer explicit project id if provided
    const chosenProject =
      (DEEPGRAM_PROJECT_ID && projects.find((p) => p?.project_id === DEEPGRAM_PROJECT_ID)) || projects[0];

    // Some accounts include a balance field on the project itself.
    if (typeof chosenProject?.balance !== 'undefined') {
      return res.json({ balance: chosenProject.balance });
    }

    // 2) Fallback: fetch project balances (requires billing:read scope)
    const projectId = chosenProject?.project_id;
    if (!projectId) {
      return res.status(500).json({ error: 'Deepgram project missing project_id', details: payload });
    }

    const balancesRes = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/balances`, {
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`
      }
    });

    const balancesPayload = await safeJson(balancesRes);
    if (!balancesRes.ok) {
      const message =
        balancesPayload?.details || balancesPayload?.message || 'Deepgram balances request failed';
      return res.status(balancesRes.status).json({
        error: message,
        hint: 'This usually requires an API key with billing:read scope.',
        details: balancesPayload
      });
    }

    const first = Array.isArray(balancesPayload?.balances) ? balancesPayload.balances[0] : null;
    const balance = first?.balance ?? first?.amount ?? first?.value;
    if (typeof balance === 'undefined') {
      return res.status(500).json({
        error: 'Deepgram balances response did not include a balance value',
        details: balancesPayload
      });
    }

    return res.json({ balance });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
});

app.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!DEEPGRAM_API_KEY) {
      return res.status(500).json({ error: 'Server misconfigured: missing DEEPGRAM_API_KEY' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Missing audio file (field name: audio)' });
    }

    const mimeType = req.file.mimetype || 'application/octet-stream';

    const dgRes = await fetch(
      'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${DEEPGRAM_API_KEY}`,
          'Content-Type': mimeType
        },
        body: req.file.buffer
      }
    );

    const payload = await safeJson(dgRes);

    if (!dgRes.ok) {
      return res.status(dgRes.status).json({ error: 'Deepgram transcription failed', details: payload });
    }

    const text = extractTranscript(payload);
    return res.json({ text, raw: payload });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
});

startServer(PORT);

function extractTranscript(deepgramResponse) {
  // Typical response:
  // { results: { channels: [ { alternatives: [ { transcript: "..." } ] } ] } }
  const channels = deepgramResponse?.results?.channels;
  const firstAlt = channels?.[0]?.alternatives?.[0];
  const transcript = firstAlt?.transcript;
  return typeof transcript === 'string' ? transcript : '';
}

function startServer(port, attemptsLeft = 5) {
  const server = http.createServer(app);
  server.on('error', (err) => {
    // Avoid the common dev crash loop when the default port is already in use.
    if (err?.code === 'EADDRINUSE' && !process.env.PORT && attemptsLeft > 0) {
      const nextPort = port + 1;
      console.warn(`⚠️  Port ${port} in use, trying ${nextPort}...`);
      setTimeout(() => startServer(nextPort, attemptsLeft - 1), 100);
      return;
    }

    console.error(err);
    process.exit(1);
  });

  // Attach handlers before listen() to avoid unhandled 'error' in watch mode.
  server.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}

async function safeJson(res) {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return await res.json();
  }

  const text = await res.text();
  return { nonJsonBody: text };
}
