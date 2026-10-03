# Content licence

The repository is split between code and writing, and they are licensed differently.

## Prose, results and hand-written data — CC BY 4.0

Every Markdown document, everything under `results/` and `reports/`, and the hand-written datasets under `data/`
(`code_review.json`, `zh_latency_prompts.json`, `models.tsv`) are licensed under the Creative Commons Attribution
4.0 International licence. You may share and adapt them, including commercially, provided you credit the source:

> Oliver Yu, *Qwen3.8-27B on RTX 5070 Ti — does the fastest recipe also win on quality?*,
> <https://github.com/tc3oliver/qwen3.8-27b-5070ti-eval>, CC BY 4.0.

Full licence deed: <https://creativecommons.org/licenses/by/4.0/>

## Code — Apache 2.0

Everything under `harness/`, the scripts under `data/` and `configs/`, are under the Apache License 2.0
(text in [`LICENSE`](LICENSE)).

## Third-party material

- `data/zh_filler_paragraphs.json`: Chinese Wikipedia text, CC BY-SA 4.0 — see `data/zh_filler_SOURCES.md`.
- `configs/qwen38-27b-iq3s/chat-template-qwen38.jinja` and the short-think variant derived from it: the chat
  template embedded in the Qwen3.8 GGUF, under the model's licence.
- Nothing from [feveromo/recipes-qwen3.8-27b-5070ti](https://github.com/feveromo/recipes-qwen3.8-27b-5070ti)
  (no licence) is redistributed: the CUDA patch and the draft vocabulary are used from a checkout of that
  repository; `launch.sh` is written here and only lists the recipe's command-line settings.
- HumanEval+ is not redistributed; `data/fetch.sh` downloads it.
