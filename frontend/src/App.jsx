import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useDropzone } from "react-dropzone";
import toast, { Toaster } from "react-hot-toast";

const API = "http://127.0.0.1:8000";

export default function App() {
  // page background (removes right-side white gap)
  useEffect(() => {
    const m = document.body.style.margin;
    const b = document.body.style.background;
    const c = document.body.style.color;
    document.body.style.margin = "0";
    document.body.style.background = "#0b1220";
    document.body.style.color = "#e5e7eb";
    return () => { document.body.style.margin = m; document.body.style.background = b; document.body.style.color = c; };
  }, []);

  // state
  const [file, setFile] = useState(null);
  const [stage, setStage] = useState("idle"); // idle | analyzing | ready | generating | done | error
  const [msg, setMsg] = useState("ready");
  const [transcript, setTranscript] = useState("");
  const [bullets, setBullets] = useState([]);
  const [images, setImages] = useState([]);

  // options
  const [previewMode, setPreviewMode] = useState(true); // faster: top 3 bullets
  const [editable, setEditable] = useState(false);
  const [customBullets, setCustomBullets] = useState("");

  // recorder
  const [recStatus, setRecStatus] = useState("idle");
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

  // lightbox
  const [lightbox, setLightbox] = useState({ open: false, index: 0 });
  const openLightbox = (i) => setLightbox({ open: true, index: i });
  const closeLightbox = () => setLightbox({ open: false, index: 0 });

  // derived
  const canAnalyze = useMemo(() => !!file && stage !== "analyzing", [file, stage]);
  const currentBullets = useMemo(
    () => (editable ? customBullets.split("\n").map(s => s.trim()).filter(Boolean) : bullets),
    [editable, customBullets, bullets]
  );
  const canGenerate = useMemo(() => currentBullets.length > 0 && stage !== "generating", [currentBullets.length, stage]);

  // drag & drop
  const onDrop = (accepted) => {
    if (!accepted?.length) return;
    const f = accepted[0];
    setFile(f);
    setTranscript(""); setBullets([]); setImages([]);
    setEditable(false); setCustomBullets("");
    setStage("idle"); setMsg("ready");
    toast.success(`Added: ${f.name}`);
  };
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: false,
    accept: { "audio/*": [], "video/*": [] },
    onDrop,
  });

  // recorder
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data?.size && chunksRef.current.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const rec = new File([blob], `recording_${Date.now()}.webm`, { type: "audio/webm" });
        setFile(rec);
        toast.success("Recording captured");
      };
      mr.start();
      mediaRef.current = { mr, stream };
      setRecStatus("recording");
    } catch (e) {
      toast.error("Mic access denied or unavailable");
      console.error(e);
    }
  }
  function stopRecording() {
    const m = mediaRef.current;
    if (m?.mr?.state === "recording") m.mr.stop();
    m?.stream?.getTracks()?.forEach((t) => t.stop());
    mediaRef.current = null;
    setRecStatus("idle");
  }

  // pipeline
  async function handleAnalyze() {
    if (!file) return;
    setStage("analyzing"); setMsg("Uploading → Transcribing → Summarizing…");
    setImages([]); setEditable(false); setCustomBullets("");

    try {
      const fd = new FormData();
      fd.append("file", file);
      const r1 = await axios.post(`${API}/process`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      const t = r1?.data?.transcript_preview || "";
      const b = r1?.data?.bullets || [];
      setTranscript(t);
      setBullets(b);
      setCustomBullets(b.join("\n"));
      setStage("ready"); setMsg("analysis ready");
      toast.success("Transcription & summary ready");
    } catch (e) {
      const err = e?.response?.data?.error || e.message || "Unknown error";
      setStage("error"); setMsg(err); toast.error(err);
      console.error(e);
    }
  }

  async function handleGenerate() {
    try {
      setStage("generating"); setMsg("Generating storyboard…");
      let list = [...currentBullets];
      if (previewMode) list = list.slice(0, 3);
      const r2 = await axios.post(`${API}/generate-images`, { bullets: list });
      setImages(r2?.data?.images || []);
      setStage("done"); setMsg("done");
      toast.success("Storyboard generated");
    } catch (e) {
      const err = e?.response?.data?.error || e.message || "Unknown error";
      setStage("error"); setMsg(err); toast.error(err);
      console.error(e);
    }
  }

  // export
  function escapeHtml(s = "") {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function handleDownloadHTML() {
    const list = [...currentBullets];
    const rows = list.map((bullet, i) => {
      const url = images[i] ? `${API}${images[i]}` : "";
      return `
        <figure class="card">
          ${url ? `<div class="ph"><img src="${url}" alt="frame"/></div>` : ""}
          <figcaption class="txt">${escapeHtml(bullet)}</figcaption>
        </figure>`;
    }).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Meeting → Storyboard</title>
<style>
body{font-family:ui-sans-serif,system-ui;margin:20px;background:#fff;color:#111}
.wrap{max-width:1160px;margin:auto}
h1{margin:0 0 10px 0}.meta{color:#555;margin-bottom:16px}
.transcript{white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.card{margin:0;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,.06);background:#fff}
.card .ph{aspect-ratio:16/9;overflow:hidden}
.card img{width:100%;height:100%;display:block;object-fit:cover}
.card .txt{padding:12px 14px;font-size:14px;line-height:1.4}
</style></head><body><div class="wrap">
<h1>Meeting → Storyboard</h1>
<div class="meta">${new Date().toLocaleString()}</div>
<div class="transcript"><strong>Transcript (preview)</strong><br>${escapeHtml(transcript)}</div>
<div><strong>Summary</strong><ul>${list.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul></div>
<h3>Frames</h3><div class="grid">${rows}</div>
</div></body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "report.html"; a.click();
    URL.revokeObjectURL(url);
  }

  // UI
  return (
    <div style={{ minHeight: "100vh" }}>
      <Toaster position="top-right" />

      {/* header */}
      <header style={{ borderBottom: "1px solid #1f2a44", background: "#0b1220", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "14px 20px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 10, height: 10, borderRadius: 999, background: stage === "error" ? "#f87171" : "#22c55e" }} />
          <strong style={{ fontSize: 18 }}>Meeting → Storyboard</strong>
          <div style={{ marginLeft: "auto", fontSize: 13, color: "#93a4c1" }}>{msg}</div>
        </div>
      </header>

      <main style={{ maxWidth: 1160, margin: "0 auto", padding: 20 }}>
        {/* controls */}
        <section style={{ background: "#0f172a", border: "1px solid #1f2a44", borderRadius: 14, padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 260px 220px", gap: 14, alignItems: "center" }}>
            <div
              {...getRootProps()}
              style={{
                padding: 16, borderRadius: 12,
                border: "1px dashed #334155",
                background: isDragActive ? "#0b3a1f" : "#0b1220",
                color: "#e5e7eb", cursor: "pointer", textAlign: "center"
              }}
            >
              <input {...getInputProps()} />
              <div style={{ fontSize: 14 }}>
                {isDragActive ? "Drop the file here…" : "Drag & drop audio/video or click to choose"}
              </div>
              {!!file && (
                <div style={{ fontSize: 12, color: "#93a4c1", marginTop: 8 }}>
                  {file.name} • {(file.size / 1024 / 1024).toFixed(2)} MB
                </div>
              )}
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <button
                onClick={recStatus === "idle" ? startRecording : stopRecording}
                style={{
                  background: recStatus === "idle" ? "#22c55e" : "#ef4444",
                  color: "#00130b", border: "none", padding: "10px 14px", borderRadius: 10
                }}
              >
                {recStatus === "idle" ? "● Record mic" : "■ Stop"}
              </button>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#cbd5e1" }}>
                <input type="checkbox" checked={previewMode} onChange={(e) => setPreviewMode(e.target.checked)} />
                Preview mode (top 3 bullets)
              </label>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <button
                onClick={handleAnalyze}
                disabled={!canAnalyze}
                style={{
                  background: canAnalyze ? "#2563eb" : "#1e3a8a",
                  color: "#fff", border: "none", padding: "10px 14px", borderRadius: 10
                }}
              >
                {stage === "analyzing" ? "Analyzing…" : "Analyze"}
              </button>
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                style={{
                  background: canGenerate ? "#7c3aed" : "#3b2a6b",
                  color: "#fff", border: "none", padding: "10px 14px", borderRadius: 10
                }}
              >
                {stage === "generating" ? "Generating…" : "Generate Images"}
              </button>
            </div>
          </div>
        </section>

        {/* transcript + summary */}
        {(transcript || bullets.length) > 0 && (
          <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            <div style={{ background: "#0f172a", border: "1px solid #1f2a44", borderRadius: 14, padding: 16 }}>
              <h3 style={{ marginTop: 0 }}>Transcript (preview)</h3>
              <div style={{ whiteSpace: "pre-wrap", color: "#cbd5e1", fontSize: 14 }}>{transcript || "—"}</div>
            </div>

            <div style={{ background: "#0f172a", border: "1px solid #1f2a44", borderRadius: 14, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <h3 style={{ margin: 0, flex: 1 }}>Summary</h3>
                <label style={{ fontSize: 13, color: "#cbd5e1" }}>
                  <input
                    type="checkbox"
                    checked={editable}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setEditable(v);
                      if (v) setCustomBullets(bullets.join("\n"));
                    }}
                    style={{ marginRight: 8 }}
                  />
                  Edit bullets
                </label>
              </div>

              {!editable ? (
                <ul style={{ margin: "10px 0 0 0", paddingLeft: 18 }}>
                  {bullets.map((b, i) => <li key={i} style={{ marginBottom: 6 }}>{b}</li>)}
                  {!bullets.length && <li>—</li>}
                </ul>
              ) : (
                <textarea
                  value={customBullets}
                  onChange={(e) => setCustomBullets(e.target.value)}
                  placeholder="One bullet per line"
                  style={{
                    width: "100%", height: 180, marginTop: 10,
                    borderRadius: 10, background: "#0b1220", color: "#e5e7eb",
                    border: "1px solid #1f2a44", padding: 10, fontSize: 14
                  }}
                />
              )}

              <div style={{ marginTop: 12 }}>
                <button
                  onClick={handleDownloadHTML}
                  disabled={!images.length}
                  style={{
                    background: images.length ? "#22c55e" : "#14532d",
                    color: "#00130b", border: "none", padding: "8px 12px",
                    borderRadius: 10, cursor: images.length ? "pointer" : "not-allowed"
                  }}
                >
                  Download HTML report
                </button>
              </div>
            </div>
          </section>
        )}

        {/* storyboard with captions BELOW the image */}
        {!!images.length && (
          <section style={{ background: "#0f172a", border: "1px solid #1f2a44", borderRadius: 14, padding: 16, marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Storyboard</h3>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
              {images.map((url, i) => {
                const caption = currentBullets[i] || "";
                return (
                  <figure
                    key={i}
                    style={{
                      margin: 0,
                      border: "1px solid #1f2a44",
                      borderRadius: 16,
                      overflow: "hidden",
                      background: "#0b1220",
                      boxShadow: "0 3px 14px rgba(0,0,0,0.25)",
                    }}
                  >
                    {/* image box */}
                    <div
                      onClick={() => openLightbox(i)}
                      style={{ aspectRatio: "16/9", overflow: "hidden", cursor: "zoom-in" }}
                      title="Click to enlarge"
                    >
                      <img
                        src={`${API}${url}`}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                    </div>
                    {/* caption BELOW */}
                    <figcaption style={{ padding: "12px 14px", color: "#e5e7eb", fontSize: 14, lineHeight: 1.4, background: "#0f172a" }}>
                      {caption}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </section>
        )}

        {/* lightbox */}
        {lightbox.open && (
          <div
            onClick={closeLightbox}
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 50, cursor: "zoom-out"
            }}
          >
            <img
              src={`${API}${images[lightbox.index]}`}
              alt=""
              style={{ maxWidth: "92vw", maxHeight: "90vh", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.6)" }}
            />
          </div>
        )}
      </main>
    </div>
  );
}
