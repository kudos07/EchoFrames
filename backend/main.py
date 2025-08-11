from fastapi import FastAPI, File, UploadFile, Body
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os, subprocess, requests, uuid
from pathlib import Path
from diffusers import AutoPipelineForText2Image
import torch

WHISPER_EXE   = Path(r"whispercpp/Release/whisper-cli.exe").resolve()
WHISPER_MODEL = Path(r"whispercpp/models/ggml-medium.en.bin").resolve()
OLLAMA_URL    = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
SUM_MIN, SUM_MAX = 5, 8

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173","http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

def run(cmd, cwd=None):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, shell=False)
    if p.returncode != 0:
        raise RuntimeError(f"Command failed: {cmd}\nSTDOUT:\n{p.stdout}\nSTDERR:\n{p.stderr}")
    return p

def summarize(text: str) -> list[str]:
    prompt = (
        "You are an expert meeting and speech summarizer.\n"
        f"Summarize the transcript into {SUM_MIN}–{SUM_MAX} highly concise bullet points.\n"
        "Each bullet should represent a distinct idea or theme, not a sentence.\n"
        "Prioritize key arguments, decisions, insights, and implications.\n"
        "Merge overlapping ideas, remove filler and repetition.\n"
        "Rephrase for clarity and brevity; keep a neutral, factual tone.\n"
        "Return ONLY the bullet points, one per line, no numbering, no headings, no extra commentary.\n\n"
        f"Transcript:\n{text[:8000]}"
    )
    r = requests.post(f"{OLLAMA_URL}/api/generate",
                      json={"model":"mistral:latest","prompt":prompt,"stream":False},
                      timeout=600)
    r.raise_for_status()
    raw = r.json().get("response","")
    bullets = [b.strip().lstrip("-• ").strip() for b in raw.splitlines() if b.strip()]
    return bullets[:SUM_MAX]

@app.get("/health")
def health():
    return {"ok": True, "whisper": WHISPER_EXE.exists(), "model": WHISPER_MODEL.exists()}

@app.post("/process")
async def process(file: UploadFile = File(...)):
    os.makedirs("uploads", exist_ok=True)
    dest = Path("uploads") / file.filename
    with open(dest, "wb") as f:
        f.write(await file.read())

    wav = dest if dest.suffix.lower() == ".wav" else dest.with_suffix(".wav")
    if wav != dest:
        run(["ffmpeg", "-y", "-i", str(dest), "-ar", "16000", "-ac", "1", str(wav)])

    out_prefix = wav.with_suffix("")
    cmd = [str(WHISPER_EXE), "-m", str(WHISPER_MODEL), "-f", str(wav.resolve()), "-l", "en", "-otxt", "-of", str(out_prefix.resolve())]
    run(cmd, cwd=str(WHISPER_EXE.parent))
    txt_path = out_prefix.with_suffix(".txt")
    transcript = txt_path.read_text(encoding="utf-8", errors="ignore") if txt_path.exists() else ""
    bullets = summarize(transcript) if transcript.strip() else []
    return JSONResponse({"ok": True,"filename": file.filename,"bytes": dest.stat().st_size,"transcript_preview": transcript[:500],"bullets": bullets})

_pipe = None
def get_pipe():
    global _pipe
    if _pipe is None:
        dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _pipe = AutoPipelineForText2Image.from_pretrained(
            "stabilityai/sdxl-turbo",
            torch_dtype=dtype,
            variant="fp16" if dtype==torch.float16 else None
        ).to(device)
        _pipe.enable_attention_slicing()
    return _pipe

SD_SUFFIX = " storyboard sketch, clean lines, high readability, minimal background"

@app.post("/generate-images")
def generate_images(payload: dict = Body(...)):
    bullets = payload.get("bullets", [])
    if not bullets:
        return JSONResponse({"ok": False, "error": "No bullets provided"}, status_code=400)
    pipe = get_pipe()
    run_id = uuid.uuid4().hex[:8]
    out_dir = Path("static") / "images" / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    urls = []
    for i, b in enumerate(bullets, 1):
        prompt = f"{b}{SD_SUFFIX}"
        img = pipe(prompt, num_inference_steps=1, guidance_scale=0.0, height=384, width=384).images[0]
        p = out_dir / f"img_{i:02d}.png"
        img.save(p)
        urls.append(f"/static/images/{run_id}/{p.name}")
    return JSONResponse({"ok": True, "images": urls})