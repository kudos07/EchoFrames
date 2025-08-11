# test_sdxl.py
import os
import time
import torch
from diffusers import AutoPipelineForText2Image

def main():
    t0 = time.time()

    # Load SDXL Turbo model for GPU
    pipe = AutoPipelineForText2Image.from_pretrained(
        "stabilityai/sdxl-turbo",
        torch_dtype=torch.float16,
        variant="fp16"
    ).to("cuda")

    prompt = "cinematic storyboard frame of a meeting room with whiteboard and sticky notes"

    # Generate image
    image = pipe(
        prompt,
        num_inference_steps=4,   # Turbo works best at 1–4 steps
        guidance_scale=0.0,      # 0–0.5 typical for Turbo
        height=512,
        width=512
    ).images[0]

    # Save output
    os.makedirs("outputs", exist_ok=True)
    out_path = os.path.join("outputs", "test.png")
    image.save(out_path)

    print(f"✅ Saved {out_path} in {time.time() - t0:.1f}s")

if __name__ == "__main__":
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA GPU is not available. Please check your PyTorch install.")
    main()
