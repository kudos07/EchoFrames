
import os, time, torch
from diffusers import AutoPipelineForText2Image

torch.backends.cudnn.benchmark = True

pipe = AutoPipelineForText2Image.from_pretrained(
    "stabilityai/sdxl-turbo",
    torch_dtype=torch.float16,
    variant="fp16"
).to("cuda")

# optional: skip safety checker (tiny speed win)
if hasattr(pipe, "safety_checker"):
    pipe.safety_checker = None

def run(name, steps=1, h=384, w=384, slicing=False):
    if slicing:
        pipe.enable_attention_slicing()
    else:
        pipe.disable_attention_slicing()
    t0 = time.time()
    img = pipe(
        "storyboard sketch of a meeting room, whiteboard, sticky notes",
        num_inference_steps=steps,
        guidance_scale=0.0,
        height=h, width=w,
    ).images[0]
    os.makedirs("outputs", exist_ok=True)
    out = f"outputs/{name}.png"
    img.save(out)
    dt = time.time() - t0
    print(f"{name:>18}: steps={steps} {w}x{h} slicing={slicing}  gen={dt:.2f}s  -> {out}")

# warmup
_ = pipe("warmup", num_inference_steps=1, guidance_scale=0.0, height=384, width=384)

# tests
run("s1_384_noSlice", steps=1, h=384, w=384, slicing=False)
run("s1_320_noSlice", steps=1, h=320, w=320, slicing=False)
run("s2_384_noSlice", steps=2, h=384, w=384, slicing=False)
run("s1_384_slice",   steps=1, h=384, w=384, slicing=True)
