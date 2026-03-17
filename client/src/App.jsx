import { useEffect, useMemo, useRef, useState } from 'react';

export default function App() {
  const [walletText, setWalletText] = useState('Loading balance...');
  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState('Idle');
  const [error, setError] = useState('');

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
        const res = await fetch('/balance');
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

          const res = await fetch('/transcribe', {
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
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16, maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>Voice Notes Maker</h1>

      <div style={{ marginBottom: 12 }}>
        <strong>Deepgram wallet:</strong> {walletText}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={startRecording} disabled={!canRecord || isRecording}>
          Start Recording
        </button>
        <button onClick={stopRecording} disabled={!isRecording}>
          Stop Recording
        </button>
        <div style={{ marginLeft: 8 }}>
          <strong>Status:</strong> {status}
        </div>
      </div>

      {error ? (
        <div style={{ marginBottom: 12, color: 'crimson' }}>{error}</div>
      ) : null}

      <div>
        <h3>Transcription</h3>
        <div
          style={{
            whiteSpace: 'pre-wrap',
            minHeight: 120,
            padding: 12,
            border: '1px solid #ccc'
          }}
        >
          {transcript || '—'}
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, color: '#555' }}>
        Tip: Use Chrome for best MediaRecorder support.
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
