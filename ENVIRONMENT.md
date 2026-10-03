# Environment

| | |
|---|---|
| GPU | NVIDIA GeForce RTX 5070 Ti, 16,303 MiB, compute capability 12.0 (Blackwell, sm_120) |
| Driver | 595.71 (Windows host), CUDA 13.2 driver API |
| CPU | AMD Ryzen 7 9700X, 8C/16T |
| RAM | 62 GB host; **WSL2 VM capped at 24 GB** (`.wslconfig memory=24GB`) |
| OS | Windows 11 Pro 10.0.26200 + WSL 2.7.12.0, kernel 6.18.33.2-microsoft-standard-WSL2, Ubuntu 24.04.4 LTS |
| CUDA toolkits | 13.1.115 (`/usr/local/cuda-13.1`, recipe build), 12.8 (`/usr/local/cuda-12.8`, older builds) |
| Host compiler | g++ 13.3.0 |

## VRAM available to models

The Windows desktop and its applications share the card. Measured on 2026-10-03 with no Linux CUDA process:
3,548 MiB used / 12,448 MiB free (largest users: an Android emulator, NVIDIA overlay, Chrome, dwm). Under
WSL2/WDDM an allocation beyond free VRAM does not fail; it is silently placed in shared system memory, which
cuts decode speed by up to ~20× (Qwen3.8-27B at 128K: 5.9 tok/s). This is why every run checks the spill
(`harness/spill_check.sh`) and why context sizes here are smaller than on a bare-Linux machine with the same GPU.

The 24 GB VM limit matters for MoE models that keep experts in system RAM; raise it in `.wslconfig` if a
candidate needs more and record the change here.

## llama.cpp builds

| Build | Path | Commit | Notes |
|---|---|---|---|
| recipe v3 | `~/llama-api/src/llama.cpp-qwen38-v3` | `4b1a27fa0` + `cuda-kernels.patch` (SHA-256 `06606651…25a94`) | CUDA 13.1, `CMAKE_CUDA_ARCHITECTURES=120a-real`, recipe's exact cmake flags |
| stock (latest) | `~/llama-api/src/llama.cpp-stock` | `99b95488cac0f00ce3f05af113a8c1e287753f87` (master, 2026-10-03) | CUDA 13.1, `120a-real`, recipe cmake flags minus the patch; used for every non-recipe configuration |
| stock (older) | `~/llama-api/src/llama.cpp` | `34af94c` | CUDA 12.8, `120`; not used in the comparison |
