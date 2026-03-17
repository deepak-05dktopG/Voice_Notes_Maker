import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';

dotenv.config();

const PORT = process.env.PORT || 3001;
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

    // Per assessment requirement: use /v1/projects and read projects[0].balance
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

    const firstProject = payload?.projects?.[0];
    if (!firstProject) {
      return res.status(500).json({ error: 'Deepgram response did not include any projects', details: payload });
    }

    // Some accounts may include balance directly on project.
    if (typeof firstProject.balance !== 'undefined') {
      return res.json({ balance: firstProject.balance });
    }

    // Fallback: fetch balances for the first project.
    const projectId = firstProject.project_id;
    if (!projectId) {
      return res.status(500).json({ error: 'Deepgram response missing project_id', details: payload });
    }

    const balancesRes = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/balances`, {
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`
      }
    });

    const balancesPayload = await safeJson(balancesRes);
    if (!balancesRes.ok) {
      return res
        .status(balancesRes.status)
        .json({ error: 'Deepgram balances request failed', details: balancesPayload });
    }

    const first = Array.isArray(balancesPayload?.balances) ? balancesPayload.balances[0] : null;
    const balance = first?.balance ?? first?.amount ?? first?.value;
    if (typeof balance === 'undefined') {
      return res
        .status(500)
        .json({ error: 'Deepgram balances response did not include a balance value', details: balancesPayload });
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

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

async function resolveProjectId() {
  if (DEEPGRAM_PROJECT_ID) return DEEPGRAM_PROJECT_ID;

  const projectsRes = await fetch('https://api.deepgram.com/v1/projects', {
    headers: {
      Authorization: `Token ${DEEPGRAM_API_KEY}`
    }
  });

  const payload = await safeJson(projectsRes);
  if (!projectsRes.ok) return null;

  // Deepgram returns { projects: [{ project_id, name, ... }] }
  const projects = Array.isArray(payload?.projects) ? payload.projects : [];
  return projects[0]?.project_id || null;
}

function extractTranscript(deepgramResponse) {
  // Typical response:
  // { results: { channels: [ { alternatives: [ { transcript: "..." } ] } ] } }
  const channels = deepgramResponse?.results?.channels;
  const firstAlt = channels?.[0]?.alternatives?.[0];
  const transcript = firstAlt?.transcript;
  return typeof transcript === 'string' ? transcript : '';
}

function simplifyBalance(balancePayload) {
  // Shape can vary by account type; keep it defensive.
  // Try common shapes and expose a single numeric-ish field.
  const balances = balancePayload?.balances;
  if (Array.isArray(balances) && balances.length > 0) {
    const first = balances[0];
    const amount = first?.balance ?? first?.amount ?? first?.value ?? null;
    const unit = first?.unit ?? first?.units ?? first?.currency ?? 'unknown';
    const display = amount === null || typeof amount === 'undefined' ? null : `${amount} ${unit}`.trim();
    return { amount, unit, display };
  }

  if (typeof balancePayload?.balance !== 'undefined') {
    const amount = balancePayload.balance;
    const unit = balancePayload.currency ?? balancePayload.unit ?? balancePayload.units ?? 'unknown';
    const display = amount === null || typeof amount === 'undefined' ? null : `${amount} ${unit}`.trim();
    return { amount, unit, display };
  }

  return { amount: null, unit: 'unknown', display: null };
}

async function safeJson(res) {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return await res.json();
  }

  const text = await res.text();
  return { nonJsonBody: text };
}
