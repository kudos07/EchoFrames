# cli_storyboard.py
import os, sys, json, subprocess, shlex, time, base64
from pathlib import Path
import requests
import torch
from diffusers import AutoPipelineForText2Image
from PIL import Image

WHISPER_DIR = Path("whispercpp")  # adjust if you placed it elsewhere
WHISPER_EXE = Path(r"C:\Users\saran\Videos\video_project\whispercpp\Release\whisper-cli.exe")
WHISPER_MODEL = Path(r"C:\Users\saran\Videos\video_project\whispercpp\models\ggml-medium.en.bin")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
SD_PROMPT_SUFFIX = " storyboard sketch, clean lines, soft shading, minimal background, high readability"

def run(cmd, cwd=None):
    print(">", cmd)
    p = subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True)
    if p.returncode != 0:
        print(p.stdout)
        print(p.stderr)
        raise RuntimeError(f"Command failed: {cmd}")
    return p.stdout

def ensure_wav(src_path: Path) -> Path:
    # If not wav, convert with ffmpeg
    if src_path.suffix.lower() == ".wav":
        return src_path
    wav = src_path.with_suffix(".wav")
    cmd = f'ffmpeg -y -i "{src_path}" -ar 16000 -ac 1 "{wav}"'
    run(cmd)
    return wav

def transcribe(wav: Path) -> str:
    print("Transcribing...")

    out_txt = wav.with_suffix(".txt")  # same folder as wav file
    cmd = [
        str(WHISPER_EXE),
        "-m", str(WHISPER_MODEL),
        "-f", str(wav),
        "-l", "en",
        "-otxt",  # output in txt format
        "-of", str(wav.with_suffix(""))  # same name without extension
    ]

    run(cmd, cwd=str(WHISPER_DIR))

    # Return the transcribed text
    return out_txt.read_text(encoding="utf-8", errors="ignore")


def summarize_ollama(text: str, model: str = "mistral:latest", max_bullets=(5,8)) -> list[str]:
    prompt = (
    "You are an expert meeting and speech summarizer.\n"
    f"Summarize the transcript into {max_bullets[0]}–{max_bullets[1]} highly concise bullet points.\n"
    "Each bullet should represent a distinct idea or theme, not a sentence from the transcript.\n"
    "Prioritize key arguments, decisions, insights, and implications.\n"
    "Group related points together, merge overlapping ideas, and remove repetition.\n"
    "Avoid filler, side remarks, and irrelevant details.\n"
    "Rephrase into your own words for clarity and brevity — do not copy phrases directly unless they are critical.\n"
    "Maintain a neutral, factual tone.\n"
    "Return ONLY the bullet points, one per line, no numbering, no headings, no extra commentary.\n\n"
    f"Transcript:\n{text[:8000]}"
)

    payload = {"model": model, "prompt": prompt, "stream": False}
    r = requests.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=600)
    r.raise_for_status()
    out = r.json().get("response","").strip()
    bullets = [b.strip("-• ").strip() for b in out.splitlines() if b.strip()]
    # keep 4–6 for visuals
    return bullets[:6] if len(bullets) >= 4 else bullets

def get_pipe(device="cuda"):
    pipe = AutoPipelineForText2Image.from_pretrained(
        "stabilityai/sdxl-turbo",
        torch_dtype=torch.float16,
        variant="fp16",
    ).to(device)
    pipe.enable_attention_slicing()
    return pipe

def gen_images(bullets: list[str], out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    pipe = get_pipe(device)
    paths = []
    for i, b in enumerate(bullets, 1):
        prompt = b + SD_PROMPT_SUFFIX
        img = pipe(prompt, num_inference_steps=12, guidance_scale=7.5,
                   height=768, width=768).images[0]
        p = out_dir / f"img_{i:02d}.png"
        img.save(p)
        print(f"Saved {p}")
        paths.append(p)
    return paths

def write_html(bullets: list[str], images: list[Path], out_html: Path):
    out_html.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for b, p in zip(bullets, images):
        rows.append(f"""
        <div class="card">
          <img src="{p.as_posix()}" alt="frame"/>
          <div class="txt">{b}</div>
        </div>""")
    html = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Meeting → Storyboard</title>
<style>
body{{font-family: ui-sans-serif, system-ui; margin:20px;}}
h1{{margin:0 0 10px 0}}
.grid{{display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:16px}}
.card{{border:1px solid #ddd; border-radius:12px; overflow:hidden; box-shadow:0 2px 6px rgba(0,0,0,0.08)}}
.card img{{width:100%; display:block}}
.card .txt{{padding:10px; font-size:14px; line-height:1.35}}
</style>
</head>
<body>
<h1>Meeting → Storyboard</h1>
<p>{len(bullets)} key points</p>
<div class="grid">
{''.join(rows)}
</div>
</body>
</html>"""
    out_html.write_text(html, encoding="utf-8")
    print(f"Wrote {out_html}")

def main():
    if len(sys.argv) < 2:
        print("Usage: python cli_storyboard.py <audio_or_video_file>")
        sys.exit(1)
    src = Path(sys.argv[1]).resolve()
    assert src.exists(), f"Input not found: {src}"
    t0 = time.time()
    wav = ensure_wav(src)
    print("Transcribing...")
    text = transcribe(wav)
    print("First 200 chars:", text[:200].replace("\n"," "))
    print("Summarizing via Ollama...")
    bullets = summarize_ollama(text)
    print("Bullets:", bullets)
    print("Generating images...")
    out_dir = Path("outputs/demo")
    imgs = gen_images(bullets, out_dir)
    write_html(bullets, imgs, out_dir / "report.html")
    print(f"Done in {time.time()-t0:.1f}s")

if __name__ == "__main__":
    main()
