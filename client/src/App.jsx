import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

export default function App() {
  const [walletText, setWalletText] = useState('Loading balance...');
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState('Idle');
  const [error, setError] = useState('');

  const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  const canRecord = useMemo(() => {
    return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${apiBase}/balance`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `Failed to load balance (${res.status})`);

        const balance = data?.balance;
        if (!cancelled) setWalletText(typeof balance === 'undefined' ? 'N/A' : String(balance));
      } catch (e) {
        const message = e?.message || 'Unable to load balance';
        if (!cancelled) setWalletText(`Error: ${message}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function startRecording() {
    setError('');
    setTranscript('');

    if (!canRecord) {
      setError('Recording not supported in this browser.');
      return;
    }

    try {
      setStatus('Requesting microphone…');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const preferredMimeType = pickRecorderMimeType();
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstart = () => setStatus('Recording…');
      recorder.onstop = async () => {
        try {
          setStatus('Processing...');

          const blobType = recorder.mimeType || preferredMimeType || 'audio/webm';
          const blob = new Blob(chunksRef.current, { type: blobType });

          if (!blob || blob.size === 0) {
            setError('No audio recorded.');
            setStatus('Idle');
            return;
          }

          const ext = fileExtensionForMime(blob.type);
          const file = new File([blob], `recording.${ext}`, { type: blob.type });

          const form = new FormData();
          form.append('audio', file);

          const res = await fetch(`${apiBase}/transcribe`, {
            method: 'POST',
            body: form
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data?.error || `Transcription failed (${res.status})`);
          }

          setTranscript(data?.text || '');
          setStatus('Done');
        } catch (e) {
          setError(e?.message || 'Upload/transcription failed');
          setStatus('Idle');
        } finally {
          cleanupStream();
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
    } catch (e) {
      setError(e?.message || 'Microphone permission denied');
      setStatus('Idle');
      cleanupStream();
    }
  }

  function stopRecording() {
    setError('');

    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    if (recorder.state === 'recording') {
      setStatus('Stopping…');
      recorder.stop();
    }
  }

  function cleanupStream() {
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    streamRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }

  const isRecording = mediaRecorderRef.current?.state === 'recording';

  return (
    <div className="app">
      <div className="card">
        <div className="header">
          <h1 className="title">Voice Notes Maker</h1>
          <div className="subtitle">Minimal voice-to-text notes with Deepgram</div>
        </div>

        <div className="row">
          <div className="pill">
            <span className="pillLabel">Wallet</span>
            <span className="pillValue">{walletText}</span>
          </div>
          <div className="pill">
            <span className="pillLabel">Status</span>
            <span className="pillValue">{status}</span>
          </div>
        </div>

        <div className="controls">
          <button className="btn primary" onClick={startRecording} disabled={!canRecord || isRecording}>
            Start Recording
          </button>
          <button className="btn" onClick={stopRecording} disabled={!isRecording}>
            Stop Recording
          </button>
        </div>

        {error ? <div className="error">{error}</div> : null}

        <div className="section">
          <div className="sectionTitle">Transcription</div>
          <div className="box">{transcript || '—'}</div>
        </div>

        <div className="hint">Tip: Chrome has the best MediaRecorder support.</div>

        <div className="footer">
          <div className="footerLabel">Links</div>
          <div className="footerLinks">
            <a
              href="https://www.linkedin.com/in/deepak-05dktopg/"
              target="_blank"
              rel="noreferrer"
            >
              LinkedIn
            </a>
            <a
              href="https://github.com/deepak-05dktopG/"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
            <a
              href="http://deepakdigitalcraft.works"
              target="_blank"
              rel="noreferrer"
            >
              Portfolio
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function pickRecorderMimeType() {
  // Keep it simple: prefer opus in webm/ogg when supported.
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}

function fileExtensionForMime(mimeType) {
  const t = String(mimeType || '').toLowerCase();
  if (t.includes('ogg')) return 'ogg';
  if (t.includes('webm')) return 'webm';
  if (t.includes('wav')) return 'wav';
  if (t.includes('mpeg') || t.includes('mp3')) return 'mp3';
  return 'webm';
}
