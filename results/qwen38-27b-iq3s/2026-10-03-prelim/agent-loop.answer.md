All context gathered. Here are the two files.

---

### FILE: tests/llmbench.py

```python
#!/usr/bin/env python3
"""llmbench — 共用 LLM API 基準測試模組（取代 tests/bench_llm.py 與 tests/stress_test.py）。

功能：
- LLMClient：共用 HTTP 客戶端（urllib、重試 5xx/429/逾時、timeout、streaming SSE 解析、TTFT 量測）
- BenchmarkResult：每次請求的結果 dataclass
- percentile / summarize：延遲分位數與摘要統計
- export_json / export_csv：結果匯出
- CLI 子命令：latency（原 bench_llm.py）、stress（原 stress_test.py）

用法：
    python3 tests/llmbench.py latency --model qwen38-27b --decode-tok 600
    python3 tests/llmbench.py stress --requests 60 --concurrency 16 --vision-ratio 0.25

作為模組：
    from llmbench import LLMClient, BenchmarkResult, summarize, export_json, export_csv
    client = LLMClient(base_url="http://127.0.0.1:8080", api_key="[redacted]")
    comp = client.chat(model="qwen38-27b", messages=[{"role": "user", "content": "hi"}],
                       max_tokens=100, timeout=60.0)
"""
import argparse
import csv
import io
import itertools
import json
import os
import random
import subprocess
import sys
import time
import urllib.error
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field, fields
from typing import Any, Dict, Iterable, List, Optional, Tuple

DEFAULT_BASE_URL = "http://127.0.0.1:8080"
DEFAULT_API_KEY = "[redacted]"
SERVER_LOG = os.environ.get("LLM_SERVER_LOG", "/home/oliver/llama-api/logs/llama-server.log")
# 粗估英文 1 char ≈ 0.25 token（與原 bench_llm.py 相同）
CHARS_PER_TOKEN = 4.0

_IDX = itertools.count(1)


def next_result_id() -> int:
    """全域遞增 id，latency / stress 共用。"""
    return next(_IDX)


def reset_result_ids() -> None:
    """（測試用）重置 id 計數器。"""
    global _IDX
    _IDX = itertools.count(1)


# ---------------------------------------------------------------- 資料結構

@dataclass
class CompletionResult:
    """chat() / stream_chat() 的回傳：解析後的回應 + 量測。"""
    data: Dict[str, Any]
    wall: float
    ttft: Optional[float] = None

    @property
    def status(self) -> Optional[int]:
        return None  # 成功時無 status code；失敗走例外

    def content(self) -> str:
        try:
            return self.data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            return ""

    def usage(self) -> Dict[str, Any]:
        return self.data.get("usage") or {}

    def prompt_tokens(self) -> int:
        return int(self.usage().get("prompt_tokens", 0) or 0)

    def completion_tokens(self) -> int:
        return int(self.usage().get("completion_tokens", 0) or 0)


@dataclass
class BenchmarkResult:
    """單一請求的完整結果。"""
    idx: int
    mode: str                                   # latency: warmup/decode/prompt; stress: text/vision
    vision: bool = False
    ok: bool = True
    error: Optional[str] = None
    status: Optional[int] = None                # HTTP status 或 0（連線層失敗）
    wall: float = 0.0                           # 端到端秒
    ttft: Optional[float] = None               # 首 token 延遲秒（streaming 時量測）
    prompt_tokens: int = 0
    completion_tokens: int = 0
    meta: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_completion(cls, idx: int, mode: str, comp: CompletionResult,
                        vision: bool = False, meta: Optional[Dict[str, Any]] = None) -> "BenchmarkResult":
        return cls(idx=idx, mode=mode, vision=vision, ok=True, status=200,
                   wall=comp.wall, ttft=comp.ttft,
                   prompt_tokens=comp.prompt_tokens(),
                   completion_tokens=comp.completion_tokens(),
                   meta=dict(meta or {}))

    @classmethod
    def from_error(cls, idx: int, mode: str, exc: "LLMRequestError",
                  vision: bool = False, meta: Optional[Dict[str, Any]] = None) -> "BenchmarkResult":
        return cls(idx=idx, mode=mode, vision=vision, ok=False, error=str(exc),
                   status=exc.status, wall=exc.elapsed, ttft=exc.ttft,
                   prompt_tokens=exc.prompt_tokens, completion_tokens=exc.completion_tokens,
                   meta=dict(meta or {}))

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["wall"] = round(self.wall, 3)
        if self.ttft is not None:
            d["ttft"] = round(self.ttft, 3)
        return d


class LLMRequestError(Exception):
    """客戶端層失敗（HTTP 錯誤 / 逾時 / 重試用盡 / 中途流斷）。"""
    def __init__(self, msg: str, status: Optional[int] = None, elapsed: float = 0.0,
                 ttft: Optional[float] = None, prompt_tokens: int = 0,
                 completion_tokens: int = 0):
        super().__init__(msg)
        self.status = status
        self.elapsed = elapsed
        self.ttft = ttft
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens


# ---------------------------------------------------------------- HTTP 客戶端

class LLMClient:
    """OpenAI 相容 chat completions 客戶端。

    - 重試：5xx / 429 / 逾時 / 連線錯誤，指數 backoff（retry_base 秒起，2x）
    - timeout：urllib 層 timeout；streaming 時同時是 socket 讀取逾時
    - streaming：SSE data: 行解析，回 (CompletionResult, chunks)；首 chunk 時間 = TTFT
    """

    def __init__(self, base_url: str = DEFAULT_BASE_URL, api_key: str = DEFAULT_API_KEY,
                timeout: float = 120.0, retries: int = 3, retry_base: float = 1.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.retries = max(0, int(retries))
        self.retry_base = retry_base

    # ---- 内部 -----------------------------------------------------------

    def _post(self, body: Dict[str, Any]) -> Tuple[int, bytes, float]:
        """POST /v1/chat/completions，回 (status, raw_body, elapsed)。不重試。"""
        url = f"{self.base_url}/v1/chat/completions"
        req = urllib.request.Request(
            url, data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {self.api_key}"})
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return resp.status, resp.read(), time.monotonic() - t0
        except urllib.error.HTTPError as e:
            try:
                raw = e.read()
            except Exception:
                raw = b""
            return e.code, raw, time.monotonic() - t0

    def _should_retry(self, status: int) -> bool:
        return status == 429 or 500 <= status < 600

    def _error_body(self, raw: bytes) -> str:
        txt = raw[:300].decode("utf-8", "replace")
        try:
            j = json.loads(raw)
            if isinstance(j, dict) and "error" in j:
                e = j["error"]
                txt = e.get("message") if isinstance(e, dict) else str(e)
        except Exception:
            pass
        return txt.strip()[:200]

    def _stream_once(self, body: Dict[str, Any]) -> Tuple[CompletionResult, List[Dict[str, Any]]]:
        url = f"{self.base_url}/v1/chat/completions"
        req = urllib.request.Request(
            url, data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {self.api_key}"})
        t0 = time.monotonic()
        ttft: Optional[float] = None
        last = {}
        chunks: List[Dict[str, Any]] = []
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                for raw in resp:
                    line = raw.decode("utf-8", "replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[len("data:"):].strip()
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    chunks.append(chunk)
                    last = chunk
                    if ttft is None:
                        ttft = time.monotonic() - t0
        except urllib.error.HTTPError as e:
            # 流中途的 HTTP 錯誤（urllib 通常只在 header 階段抛，此為防禦）
            raise LLMRequestError(f"HTTP {e.code}: {self._error_body(e.read() or b'')}",
                                  status=e.code, elapsed=time.monotonic() - t0)
        if not chunks:
            raise LLMRequestError("stream ended with no chunks", status=0,
                                  elapsed=time.monotonic() - t0)
        data = dict(last)
        data.setdefault("usage", {})
        return CompletionResult(data=data, wall=time.monotonic() - t0, ttft=ttft), chunks

    # ---- public ----------------------------------------------------------

    def chat(self, *, model: str, messages: List[Dict[str, Any]],
             max_tokens: int = 100, temperature: float = 0.0, stream: bool = False,
             timeout: Optional[float] = None, **extra: Any) -> CompletionResult:
        """非流式 / 流式請求。

        stream=False → 解析 JSON 回 CompletionResult（ttft=None）
        stream=True  → 讀完 SSE 流，回最終 chunk + ttft（逐片消費請用 stream_chat()）
        """
        body: Dict[str, Any] = {"model": model, "messages": messages,
                                "max_tokens": max_tokens, "temperature": temperature}
        if stream:
            body["stream"] = True
        body.update(extra)
        if timeout is not None:
            self.timeout = timeout

        attempt = 0
        while True:
            attempt += 1
            try:
                if stream:
                    comp, _ = self._stream_once(body)
                    return comp
                status, raw, elapsed = self._post(body)
                if status == 200:
                    return CompletionResult(data=json.loads(raw), wall=elapsed)
                if self._should_retry(status) and attempt <= self.retries:
                    time.sleep(self.retry_base * (2 ** (attempt - 1)))
                    continue
                raise LLMRequestError(f"HTTP {status}: {self._error_body(raw)}",
                                      status=status, elapsed=elapsed)
            except urllib.error.HTTPError:
                raise  # 非流式下 _post 已處理；此路徑僅防禦
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                # 逾時 / 連線被拒 / DNS 等 → 可重試
                if attempt <= self.retries:
                    time.sleep(self.retry_base * (2 ** (attempt - 1)))
                    continue
                raise LLMRequestError(f"{type(e).__name__}: {e}", status=0)
            except urllib.error.HTTPError as e:
                raw = e.read() if hasattr(e, "read") else b""
                raise LLMRequestError(f"HTTP {e.code}: {self._error_body(raw)}",
                                      status=e.code) from None
            except LLMRequestError:
                raise
            except Exception as e:  # 解析失敗等不可重試錯誤
                raise LLMRequestError(f"{type(e).__name__}: {e}", status=0)

    def stream_chat(self, *, model: str, messages: List[Dict[str, Any]],
                   max_tokens: int = 100, temperature: float = 0.0,
                   timeout: Optional[float] = None, **extra: Any) -> "Tuple[CompletionResult, List[Dict[str, Any]]]":
        """流式 SSE 逐 chunk 生成器式一次性讀取，回 (CompletionResult, chunks)。

        TTFT = 第一個 chunk 的抵達時間（自請求開始）。
        中途斷流 → LLMRequestError（附 ttft 與已收到的 chunks 數）。
        """
        body: Dict[str, Any] = {"model": model, "messages": messages,
                                "max_tokens": max_tokens, "temperature": temperature,
                                "stream": True}
        body.update(extra)
        if timeout is not None:
            self.timeout = timeout
        attempt = 0
        while True:
            attempt += 1
            try:
                return self._stream_once(body)
            except LLMRequestError as e:
                # 首 chunk 前的失敗可重試；首 chunk 後不重試（已輸出過）
                if e.ttft is None and attempt <= self.retries:
                    time.sleep(self.retry_base * (2 ** (attempt - 1)))
                    continue
                raise
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                if attempt <= self.retries:
                    time.sleep(self.retry_base * (2 ** (attempt - 1)))
                    continue
                raise LLMRequestError(f"{type(e).__name__}: {e}", status=0)


# ---------------------------------------------------------------- 統計

def percentile(values: List[float], p: float) -> float:
    """nearest-rank 分位數（與原 stress_test.py 的 pct() 一致）。"""
    if not values:
        raise ValueError("percentile of empty list")
    s = sorted(values)
    k = int(len(s) * p)
    return s[min(k, len(s) - 1)]


def summarize(results: Iterable[BenchmarkResult], wall: float) -> Dict[str, Any]:
    """回 summary dict：counts / 吞吐 / 延遲分位數 / 錯誤明細。"""
    results = list(results)
    ok = [r for r in results if r.ok]
    fail = [r for r in results if not r.ok]
    lat = [r.wall for r in ok]
    ttft = [r.ttft for r in ok if r.ttft is not None]
    ptok = sum(r.prompt_tokens for r in ok)
    ctok = sum(r.completion_tokens for r in ok)
    s: Dict[str, Any] = {
        "requests": len(results),
        "ok": len(ok),
        "failed": len(fail),
        "wall_s": round(wall, 2),
        "req_per_s": round(len(ok) / wall, 3) if wall > 0 else 0.0,
        "prompt_tokens": ptok,
        "completion_tokens": ctok,
        "completion_tok_per_s": round(ctok / wall, 1) if wall > 0 else 0.0,
        "errors": [f"#{r.idx} {r.mode}: {r.error}" for r in fail],
    }
    if lat:
        s["latency_s"] = {
            "p50": round(percentile(lat, 0.5), 3),
            "p90": round(percentile(lat, 0.9), 3),
            "p95": round(percentile(lat, 0.95), 3),
            "p99": round(percentile(lat, 0.99), 3),
            "max": round(max(lat), 3),
            "min": round(min(lat), 3),
            "mean": round(sum(lat) / len(lat), 3),
        }
    if ttft:
        s["ttft_s"] = {
            "p50": round(percentile(ttft, 0.5), 3),
            "p90": round(percentile(ttft, 0.9), 3),
            "p99": round(percentile(ttft, 0.99), 3),
            "max": round(max(ttft), 3),
        }
    return s


# ---------------------------------------------------------------- 匯出

CSV_COLUMNS = ["idx", "mode", "vision", "ok", "status", "error",
               "wall", "ttft", "prompt_tokens", "completion_tokens"]


def _rows(results: Iterable[BenchmarkResult]) -> List[Dict[str, Any]]:
    return [r.to_dict() for r in results]


def export_json(results: Iterable[BenchmarkResult], path: str,
               summary: Optional[Dict[str, Any]] = None,
               meta: Optional[Dict[str, Any]] = None) -> str:
    """寫 results.json：meta + summary + results 陣列。"""
    doc = {"meta": meta or {}, "summary": summary or {}, "results": _rows(results)}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
    return path


def export_csv(results: Iterable[BenchmarkResult], path: str) -> str:
    """寫 results.csv（UTF-8 BOM，Excel 可直接開）。"""
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        w.writeheader()
        for r in _rows(results):
            w.writerow(r)
    return path


# ---------------------------------------------------------------- 工具

def make_prompt(target_tokens: int) -> str:
    """建構約 target_tokens 長的英文 prompt（與原 bench_llm.py 相同的構造法）。"""
    para = ("The quick brown fox jumps over the lazy dog while the compiler emits warnings "
            "about implicit conversions between signed and unsigned integers in legacy code. ")
    n = int(target_tokens / (len(para) * (1.0 / CHARS_PER_TOKEN)) + 1)
    text = "Summarize the following text in one sentence.\n\n" + para * n
    return text[:int(target_tokens * CHARS_PER_TOKEN)]


def server_timings(n: int = 4, log_path: str = SERVER_LOG) -> List[str]:
    """抓 llama-server log 最後 n 行 eval time（可選，log 不存在時回 []）。"""
    try:
        out = subprocess.run(["grep", "-E", "eval time", log_path],
                             capture_output=True, text=True, timeout=15)
        return out.stdout.strip().splitlines()[-n:]
    except Exception:
        return []


def gpu_snapshot() -> str:
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.total,utilization.gpu",
             "--format=csv,noheader"],
            capture_output=True, text=True, timeout=10)
        return out.stdout.strip()
    except Exception as e:
        return f"(nvidia-smi failed: {e})"


def make_test_image_b64() -> Optional[str]:
    """256x256 PNG（紅方塊+綠圓形）。無 PIL 時回 None（呼叫端跳過視覺 job）。"""
    try:
        import base64
        import io as _io
        from PIL import Image, ImageDraw
    except ImportError:
        return None
    img = Image.new("RGB", (256, 256), (40, 90, 160))
    d = ImageDraw.Draw(img)
    d.rectangle([30, 30, 120, 120], fill=(220, 60, 60))
    d.ellipse([140, 30, 230, 120], fill=(60, 200, 90))
    buf = _io.BytesIO()
    img.save(buf, format="PNG")
    import base64 as _b64
    return _b64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------- benchmark

TEXT_PROMPTS = [
    "用一句話介紹台灣。",
    "1加1等於多少？",
    "請列出三種程式語言。",
    "今天天氣如何？（隨便回答即可）",
    "解釋什麼是遞迴。",
    "寫一句勵志的話。",
    "台灣的首都是哪裡？",
    "請問水的化學式是什麼？",
]


def _result_for(client: LLMClient, idx: int, mode: str, vision: bool,
                body: Dict[str, Any], timeout: Optional[float]) -> BenchmarkResult:
    try:
        comp = client.chat(**body, timeout=timeout)
        r = BenchmarkResult.from_completion(idx, mode, comp, vision=vision)
        if not r.ok and comp.content().strip() == "":
            r.ok = False
            r.error = "empty content"
        return r
    except LLMRequestError as e:
        return BenchmarkResult.from_error(idx, mode, e, vision=vision)


def run_latency(base_url: str, model: str, api_key: str = DEFAULT_API_KEY,
                decode_tokens: int = 600, prompt_tokens: int = 4000,
                max_tokens: int = 8, timeout: float = 900.0,
                skip_warmup: bool = False, stream: bool = False,
                client: Optional[LLMClient] = None,
                print_progress: bool = True) -> Tuple[List[BenchmarkResult], Dict[str, Any]]:
    """原 bench_llm.py：warmup → decode TPS → prompt TPS（+ 可選 stream TTFT）。

    回 (results, extra)；extra 含 decode_tps / prompt_tps / ttfb_s / vram / engine_timings。
    """
    c = client or LLMClient(base_url=base_url, api_key=api_key,
                            timeout=timeout, retries=0)
    results: List[BenchmarkResult] = []
    extra: Dict[str, Any] = {}

    def _add(mode: str, comp: CompletionResult):
        r = BenchmarkResult.from_completion(next_result_id(), mode, comp)
        results.append(r)
        return r

    if not skip_warmup:
        _add("warmup", c.chat(model=model,
                             messages=[{"role": "user",
                                        "content": "Introduce the Linux kernel memory management subsystem in detail."}],
                             max_tokens=300, temperature=0.0))

    dec = c.chat(model=model,
                messages=[{"role": "user",
                           "content": "Explain in extreme detail the design of the TCP congestion control algorithms."}],
                max_tokens=decode_tokens, temperature=0.0,
                ignore_eos=decode_tokens > 300)
    rd = _add("decode", dec)
    decode_tps = rd.completion_tokens / rd.wall if rd.wall > 0 else 0.0
    extra["decode_tps"] = round(decode_tps, 1)
    if print_progress:
        print(f"[latency] decode: {rd.completion_tokens} tok in {rd.wall:.2f}s "
              f"= {decode_tps:.1f} tok/s")

    prompt = make_prompt(prompt_tokens)
    if stream:
        comp, _chunks = c.stream_chat(model=model,
                                     messages=[{"role": "user", "content": prompt}],
                                     max_tokens=max_tokens, temperature=0.0)
        rp = _add("prompt", comp)
    else:
        comp = c.chat(model=model, messages=[{"role": "user", "content": prompt}],
                     max_tokens=max_tokens, temperature=0.0)
        rp = _add("prompt", comp)
    prompt_tps = rp.prompt_tokens / rp.wall if rp.wall > 0 else 0.0
    extra["prompt_tps"] = round(prompt_tps, 0)
    extra["ttfb_s"] = round(rp.wall, 2)
    if print_progress:
        print(f"[latency] prompt: {rp.prompt_tokens} tok in {rp.wall:.2f}s "
              f"= {prompt_tps:.0f} tok/s")

    extra["vram"] = gpu_snapshot()
    extra["engine_timings"] = server_timings(4)
    return results, extra


def run_stress(base_url: str, model: str, api_key: str = DEFAULT_API_KEY,
               concurrency: int = 16, requests: int = 60,
               vision_ratio: float = 0.25, timeout: float = 120.0,
               client: Optional[LLMClient] = None,
               jobs: Optional[List[Tuple[int, bool]]] = None,
               print_progress: bool = True) -> Tuple[List[BenchmarkResult], Dict[str, Any]]:
    """原 stress_test.py：並發 text/vision 混合負載。

    jobs: [(idx, is_vision), ...] 可自訂；None 則依 requests/vision_ratio 產生並 shuffle。
    回 (results, summary)。
    """
    c = client or LLMClient(base_url=base_url, api_key=api_key,
                            timeout=timeout, retries=0)
    if jobs is None:
        n_vision = int(requests * vision_ratio)
        jobs = [(i, i < n_vision) for i in range(requests)]
        random.shuffle(jobs)

    image_b64: Optional[str] = None
    if any(v for _, v in jobs):
        image_b64 = make_test_image_b64()
    if image_b64 is None:
        # 無 PIL：視覺 job 降級為 text
        jobs = [(i, False) for i, v in jobs]

    def one(idx: int, is_vision: bool) -> BenchmarkResult:
        if is_vision:
            content: Any = [
                {"type": "text", "text": "這張圖片裡有哪些顏色的形狀？簡短回答。"},
                {"type": "image_url",
                 "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
            ]
            max_tokens = 100
            mode = "vision"
        else:
            content = TEXT_PROMPTS[idx % len(TEXT_PROMPTS)]
            max_tokens = 80
            mode = "text"
        body = {"model": model,
                "messages": [{"role": "user", "content": content}],
                "max_tokens": max_tokens, "temperature": 0.5}
        return _result_for(c, idx, mode, is_vision, body, timeout)

    t0 = time.monotonic()
    results: List[BenchmarkResult] = []
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futs = [ex.submit(one, idx, vis) for idx, vis in jobs]
        for f in as_completed(futs):
            r = f.result()
            results.append(r)
            if print_progress:
                tag = "V" if r.vision else "T"
                status = "OK" if r.ok else f"FAIL({r.error})"
                print(f"[{len(results)}/{len(jobs)}] {tag} #{r.idx:03d} "
                      f"{r.wall:6.2f}s  {status}")
    wall = time.monotonic() - t0
    return results, summarize(results, wall)


# ---------------------------------------------------------------- CLI

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="llmbench",
        description="LLM API 基準測試（latency / stress），取代 bench_llm.py + stress_test.py")
    ap.add_argument("--base", default=DEFAULT_BASE_URL)
    ap.add_argument("--model", required=True)
    ap.add_argument("--key", default=DEFAULT_API_KEY)
    ap.add_argument("--timeout", type=float, default=900.0)
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--json", dest="out_json", default=None,
                    help="結果匯出 JSON 路徑（.json）")
    ap.add_argument("--csv", dest="out_csv", default=None,
                    help="結果匯出 CSV 路徑（.csv）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_lat = sub.add_parser("latency", help="decode/prompt TPS（原 bench_llm.py）")
    p_lat.add_argument("--decode-tok", type=int, default=600)
    p_lat.add_argument("--prompt-tok", type=int, default=4000)
    p_lat.add_argument("--max-tokens", type=int, default=8)
    p_lat.add_argument("--skip-warmup", action="store_true")
    p_lat.add_argument("--stream", action="store_true",
                       help="prompt 階段用 streaming 量測 TTFT")

    p_stress = sub.add_parser("stress", help="高並發混合負載（原 stress_test.py）")
    p_stress.add_argument("--concurrency", type=int, default=16)
    p_stress.add_argument("--requests", type=int, default=60)
    p_stress.add_argument("--vision-ratio", type=float, default=0.25)
    p_stress.add_argument("--timeout", type=float, default=120.0)
    return ap


def main(argv: Optional[List[str]] = None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)

    if args.cmd == "latency":
        client = LLMClient(base_url=args.base, api_key=args.key,
                           timeout=args.timeout, retries=args.retries)
        results, extra = run_latency(
            args.base, args.model, api_key=args.key,
            decode_tokens=args.decode_tok, prompt_tokens=args.prompt_tok,
            max_tokens=args.max_tokens, skip_warmup=args.skip_warmup,
            stream=args.stream, client=client)
        summary = summarize(results, extra.get("ttfb_s", 0) or 1)
        summary["extra"] = extra
        print(json.dumps({"summary": summary,
                          "results": [r.to_dict() for r in results]},
                         ensure_ascii=False, indent=2))
    else:  # stress
        client = LLMClient(base_url=args.base, api_key=args.key,
                           timeout=args.timeout, retries=args.retries)
        print(f"=== 壓力測試：{args.requests} 個請求、並發 {args.concurrency}、"
              f"視覺比例 {args.vision_ratio} ===")
        results, summary = run_stress(
            args.base, args.model, api_key=args.key,
            concurrency=args.concurrency, requests=args.requests,
            vision_ratio=args.vision_ratio, timeout=args.timeout, client=client)
        print(f"\n=== 摘要 ===")
        print(f"總請求數: {summary['requests']}  成功: {summary['ok']}  失敗: {summary['failed']}")
        print(f"總耗時: {summary['wall_s']}s  整體吞吐: {summary['req_per_s']} req/s, "
              f"{summary['completion_tok_per_s']} completion tok/s (聚合)")
        if "latency_s" in summary:
            L = summary["latency_s"]
            print(f"延遲(秒) p50={L['p50']} p90={L['p90']} p95={L['p95']} "
                  f"p99={L['p99']} max={L['max']}  mean={L['mean']} min={L['min']}")
        if summary["errors"]:
            print("\n失敗明細：")
            for e in summary["errors"]:
                print(f"  {e}")

    if args.out_json:
        export_json(results, args.out_json, summary=summary,
                    meta={"model": args.model, "cmd": args.cmd,
                          "base": args.base, "ts": time.time()})
        print(f"[export] JSON -> {args.out_json}")
    if args.out_csv:
        export_csv(results, args.out_csv)
        print(f"[export] CSV -> {args.out_csv}")
    return 0 if summary.get("failed", 0) == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
```

Wait — there's a bug in the stress path of `main()`: it references `summary.get("failed")` after export, but `summary` is defined in both branches, that's fine. Also in `latency` branch I used `extra.get("ttfb_s", 0) or 1` as wall for the summarize — acceptable. Let me double-check `_result_for`: it sets `r = BenchmarkResult.from_completion(...)` and then checks `if not r.ok` — but from_completion always sets ok=True, so that branch never fires. The empty-content check should be `if r.ok and comp.content().strip() == ""`. Let me fix that in the final answer.

Also in `make_test_image_b64` I have a redundant `import base64` at end — I import base64, io, PIL inside try, then `import base64 as _b64` at end. Simplify: use the already-imported `base64`. Finalize.

Also `stream_chat` docstring says generator but it's a one-shot — fix wording.

Now the test file:

```python
#!/usr/bin/env python3
"""llmbench 的 pytest 測試：用stdlib ThreadingHTTPServer 造假 OpenAI 伺服器。

跑法：
    ~/llama-api/venv/bin/python3 -m pytest tests/test_llmbench.py -v
"""
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

sys.path.insert(0, os.path.dirname(__file__))  # 讓 tests/ 可 import llmbench

from llmbench import (  # noqa: E402
    LLMClient, LLMRequestError, CompletionResult, BenchmarkResult,
    percentile, summarize, export_json, export_csv,
    make_prompt, run_latency, run_stress, build_parser,
)


class _Handler(BaseHTTPRequestHandler):
    # class-level 配置，由 fixture 設定
    fail_count = 0        # 前 N 個請求回 500
    delay = 0.0           # 回應前 sleep
    stream_delay = 0.0    # SSE 首 chunk 前 sleep
    reply_text = "OK"

    def log_message(self, *a):  # 安靜
        pass

    def _send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _completion(self, model, prompt_tokens, completion_tokens, text):
        return {
            "id": "cmpl-fake", "object": "chat.completion", "created": 0,
            "model": model,
            "choices": [{"index": 0,
                         "message": {"role": "assistant", "content": text},
                         "finish_reason": "stop"}],
            "usage": {"prompt_tokens": prompt_tokens,
                      "completion_tokens": completion_tokens,
                      "total_tokens": prompt_tokens + completion_tokens},
        }

    def _send_sse(self, model, completion_tokens, text):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        if self.server.stream_delay:
            time.sleep(self.server.stream_delay)
        self.wfile.write(b"data: {\"id\":\"cmpl\",\"object\":\"chat.completion.chunk\","
                         b"\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n")
        for ch in text:
            chunk = {"id": "cmpl", "object": "chat.completion.chunk",
                     "choices": [{"delta": {"content": ch}, "finish_reason": None}]}
            self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
            self.wfile.flush()
        last = {"id": "cmpl", "object": "chat.completion.chunk",
                "choices": [{"delta": {}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 5, "completion_tokens": completion_tokens,
                          "total_tokens": completion_tokens + 5}}
        self.wfile.write(("data: " + json.dumps(last) + "\n\n").encode())
        self.wfile.write(b"data: [DONE]\n\n")

    def do_POST(self):
        if self.path == "/v1/chat/completions":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            if self.server.fail_count > 0:
                self.server.fail_count -= 1
                self._send_json(500, {"error": {"message": "fake transient failure"}})
                return
            if self.server.delay:
                time.sleep(self.server.delay)
            model = body.get("model", "fake")
            prompt_tokens = len(json.dumps(body)) // 8 + 1
            completion_tokens = min(body.get("max_tokens", 8), 10)
            if body.get("stream"):
                self._send_sse(model, completion_tokens, self.server.reply_text)
            else:
                self._send_json(200, self._completion(model, prompt_tokens,
                                                     completion_tokens, self.server.reply_text))
            return
        self._send_json(404, {"error": {"message": "not found"}})


class FakeServer:
    def __init__(self, port=0):
        self.server = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
        self.server.fail_count = 0
        self.server.delay = 0.0
        self.server.stream_delay = 0.0
        self.server.reply_text = "OK"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self):
        self.thread.start()
        return self

    @property
    def url(self):
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture()
def fake_server():
    s = FakeServer().start()
    yield s
    s.stop()


@pytest.fixture()
def client(fake_server):
    return LLMClient(base_url=fake_server.url, api_key="test-key",
                     timeout=5.0, retries=3, retry_base=0.01)
```

Wait, `fail_count` lives on both class and instance — I set on instance (`self.server` is an instance). In handler code I read `self.server.fail_count` — but `self.server` in a handler is the HTTPServer instance, and I set instance attrs on it. Good. But `fail_count` is decremented per request from multiple threads — fine for single-threaded tests.

Note: `stream_delay` — for TTFT test.

Tests:

1. test_chat_non_stream_ok
2. test_chat_retries_then_succeeds
3. test_chat_retries_exhausted
4. test_chat_4xx_not_retried
5. test_stream_ttft
6. test_stream_reassembly
7. test_stream_retry_before_first_chunk
8. test_percentile
9. test_summarize
10. test_export_json / test_export_csv
11. test_run_latency
12. test_run_stress
13. test_cli_parser
14. test_make_prompt

For test 4 (4xx not retried): need a way to force 400. Add a server attr `fail_status`? Simpler: add attr `always_status = 0` meaning "if >0, always return that status". Or reuse fail_count with a status: make fail_count a list of statuses. Let me make `failures` = list of status codes, pop from front. E.g. `s.server.failures = [500, 500]`. For 400 test: `s.server.failures = [400]`. Handler: `if self.server.failures: code = self.server.failures.pop(0); send code`. And only retry if 5xx/429 → 400 will raise immediately.

Let me restructure: server attr `failures: List[int]`.

Retry test: `s.failures = [500, 500]` → expect success with 3 retries. Exhausted: `s.failures = [500]*5` → expect LLMRequestError with status 500.

For the stream retry test: stream failure mid-way is hard to fake with this simple handler. I can add a `stream_fail_once` that sends 500 for first N stream requests. The stream handler path uses the same do_POST → same failures list applies. So `s.failures = [500]` then stream_chat → first attempt 500 (before first chunk → ttft None → retry), second succeeds. Good.

For run_latency test: use client with retries=1, stream=False; decode_tok=10, prompt_tok=200, skip_warmup=True. Fake server returns completion_tokens=min(max_tokens,10)=10. wall>0. Check results[0].mode == "decode", decode_tps > 0, prompt result has prompt_tokens > 0. Also extra keys exist.

Note: `run_latency` uses `next_result_id()` global counter — fine.

`run_latency` with stream=True uses `c.stream_chat` — my client has that. Good.

One caveat: in `run_latency`, `rd.completion_tokens` — if fake server's usage has completion_tokens=10 and max_tokens is 10 → decode_tps = 10/wall, fine.

`summarize` in latency branch of main: `wall = extra.get("ttfb_s", 0) or 1` — ok.

For run_stress test: `run_stress(fake_server.url, model="fake", client=client, concurrency=2, requests=6, vision_ratio=0.0, print_progress=False)`. jobs=None → 6 text jobs, no vision → no PIL needed. results length 6, all ok, summary["ok"]==6, wall>0.

Also test vision job when PIL present? The venv has PIL. But to keep test robust without PIL, use a `jobs` param with explicit vision=False. Maybe add a test that vision job builds image_url content — that would need PIL. I could parametrize: skipif no PIL. Let me add:

```python
def test_run_stress_vision_job(fake_server, client):
    pytest.importorskip("PIL")
    results, summary = run_stress(fake_server.url, model="fake", client=client,
                                  concurrency=1, requests=0, vision_ratio=0,
                                  jobs=[(7, True)], print_progress=False)
    assert len(results) == 1
    assert results[0].vision
```

requests=0, jobs explicit → n_vision computed only when jobs None. Good.

test_percentile: `percentile([1,2,3,4,5], 0.5)` → k=2 → 3. Original: sorted, k=int(5*0.5)=2 → index 2 → 3. ok. `percentile([10], 0.99)` → 10.

test_export: build results, export to tmp_path, read back, check keys and columns.

CLI parser test: `build_parser().parse_args(["--model","m","latency"])` → cmd latency; parse_args(["--model","m","stress","--requests","5"]) → requests 5.

make_prompt test: len(prompt) ≈ 400*4=1600 chars, starts with "Summarize".

Also test `CompletionResult` helpers + `BenchmarkResult.from_error`? Add a small test.

Now `run_latency` calls `gpu_snapshot()` and `server_timings()` — those run nvidia-smi/grep subprocess; on CI without nvidia-smi, gpu_snapshot returns "(nvidia-smi failed: ...)" and server_timings returns []. Both are safe. Good.

One issue in `run_latency`: I call `c.chat(...)` for decode with `ignore_eos=decode_tokens > 300` — matches original (mt>300 → ignore_eos).

In original bench, the warmup uses max_tokens=300. Kept.

Also original `chat` only sets ignore_eos if mt>300. Kept.

Double-check `chat()` exception handling flow: in `chat`, inside the while loop I `try` wrapping `self._post` and the retry logic. `_post` only raises URLError/TimeoutError/OSError for connection issues (HTTPError is caught inside _post and converted to status return). Wait — `urllib.request.urlopen` raises `HTTPError` for 4xx/5xx; `_post` catches it and returns (status, raw, elapsed). So in `chat` loop, after `status, raw, elapsed = self._post(body)`:
- status 200 → parse
- retryable → sleep, continue
- else → raise LLMRequestError

The `except` clauses: `except urllib.error.HTTPError: raise` — defensive but note: if `chat` raises LLMRequestError inside try, it's caught by `except LLMRequestError: raise` — order matters: LLMRequestError is a subclass of Exception, so the `except Exception` clause would catch it if listed first. My order: HTTPError, URLError/TimeoutError/OSError, HTTPError (again, redundant), LLMRequestError, Exception. Hmm, the second `except urllib.error.HTTPError` after `except LLMRequestError`? No — order in code:

```
except urllib.error.HTTPError:
    raise  # 非流式下 _post 已處理；此路徑僅防禦
except (urllib.error.URLError, TimeoutError, OSError) as e:
    ...
    raise LLMRequestError(...)
except urllib.error.HTTPError as e:   # ← 永不可達（同類型已列在前）
    ...
except LLMRequestError:
    raise
except Exception as e:
    raise LLMRequestError(...)
```

The second HTTPError is unreachable — remove it. Also note: `raise LLMRequestError` inside the `except ... OSError` block — will it be caught by `except LLMRequestError: raise`? No! An exception raised inside an except block is not caught by sibling except clauses of the same try. Correct — sibling clauses don't catch exceptions raised in other handlers. Good.

But wait: `LLMRequestError` extends Exception. Inside try, `raise LLMRequestError(...)` from the `if status == 200 else` block — that's a raise in try body, caught by `except LLMRequestError: raise` → re-raised. Good.

Simplify final `chat` exception handling:

```python
try:
    ...
except LLMRequestError:
    raise
except (urllib.error.HTTPError,) as e:   # defensive
    raw = e.read()
    raise LLMRequestError(f"HTTP {e.code}: {self._error_body(raw)}", status=e.code) from None
except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
    if attempt <= self.retries:
        time.sleep(...)
        continue
    raise LLMRequestError(f"{type(e).__name__}: {e}", status=0)
except Exception as e:
    raise LLMRequestError(f"{type(e).__name__}: {e}", status=0)
```

Note: `json.loads(raw)` raising → caught by `except Exception` → wrapped. But it's raised in try body → caught by `except Exception` — but `except LLMRequestError: raise` is first — json error is not LLMRequestError → falls to Exception → wrap. Good.

Also `TimeoutError` is a subclass of `OSError` in 3.10+; listing both is harmless.

For the stream path inside `chat` with stream=True: `_stream_once` already raises LLMRequestError; propagates via `except LLMRequestError: raise`. Good — no retry in `chat(stream=True)` after first chunk... actually retries in `chat(stream=True)` won't happen, that's fine; document that stream_chat is the retrying stream API.

Edge: in `chat` when stream=True, I don't retry — acceptable, docstring says use stream_chat for that.

Also in `_stream_once`, exceptions from `resp.read`-like iteration: `json.JSONDecodeError` for malformed chunk — propagates as JSONDecodeError (subclass of ValueError → Exception) → in stream_chat loop `except Exception`? I only catch LLMRequestError and URLError/OSError in stream_chat. JSONDecodeError propagates raw. Hmm — let me wrap the entire `stream_chat` loop with `except Exception as e: raise LLMRequestError(...)`? But then LLMRequestError raised inside try is caught by `except Exception` → re-wrap (fine, or add `except LLMRequestError: raise` before it). Let me restructure stream_chat:

```python
while True:
    attempt += 1
    try:
        return self._stream_once(body)
    except LLMRequestError as e:
        if e.ttft is None and attempt <= self.retries:
            time.sleep(self.retry_base * (2 ** (attempt - 1)))
            continue
        raise
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        if attempt <= self.retries:
            time.sleep(self.retry_base * (2 ** (attempt - 1)))
            continue
        raise LLMRequestError(f"{type(e).__name__}: {e}", status=0)
    except Exception as e:
        raise LLMRequestError(f"{type(e).__name__}: {e}", status=0)
```

Wait, but the URLError retry: if connection fails, attempt 1 → retry... but LLMRequestError from _stream_once with status=0 and ttft None also retried. OK.

Subtlety: `except LLMRequestError` before `except ... OSError` — LLMRequestError is not an OSError, fine.

Also inside `_stream_once`, `time.sleep` between chunks? Not needed for fake server test; TTFT only measures to first chunk.

For fake server streaming: urllib response iteration `for raw in resp` — reads line by line. Handler writes chunks with "\n\n" and flushes. Should work.

One gotcha: `BaseHTTPRequestHandler` default protocol is HTTP/1.0 → connection closes after response; urllib is fine. For SSE, HTTP/1.0 with no Content-Length → read until close. `for raw in resp` iterates by lines — works.

Also `ThreadingHTTPServer` + daemon threads.

Now, potential issue in fake server: `do_POST` reads body with Content-Length — urllib sends Content-Length. Good.

Also handle `do_GET` for health? Not needed.

Now for `run_stress`, the `jobs` param default None uses `requests` param for count. In stress test with explicit jobs, I still pass requests=... but unused. Fine.

Also fix `_result_for` empty content logic:

```python
def _result_for(...):
    try:
        comp = client.chat(**body, timeout=timeout)
        r = BenchmarkResult.from_completion(idx, mode, comp, vision=vision)
        if comp.content().strip() == "":
            r.ok = False
            r.error = "empty content"
        return r
    except LLMRequestError as e:
        return BenchmarkResult.from_error(idx, mode, e, vision=vision)
```

Also `main()` in stress branch: `summary` from run_stress; in latency branch `summary` dict. Exit code: `return 0 if summary.get("failed", 0) == 0 else 1`. Good.

In latency branch, summary from summarize(results, wall) with wall = extra["ttfb_s"] or 1 — hmm, this is a bit arbitrary. Better: measure total wall for the latency run: t0 before warmup, wall after. Let me add `t0`/`wall` to run_latency and include in extra: `extra["wall_s"] = ...`. And main uses `summarize(results, extra["wall_s"])`.

Also note: `run_latency` returns `(results, extra)`. main's latency branch: `summary = summarize(results, extra["wall_s"])`.

Edge: `summarize` divides by wall; wall>0 always.

`export_csv` uses `extrasaction="ignore"` on DictWriter — row dicts contain vision/ok etc. all in CSV_COLUMNS plus meta/ttft… meta not in columns → ignored. Good.

`to_dict`: `d["wall"] = round(self.wall, 3)`; ttft possibly None → CSV writes empty. Good.

Now `run_latency` signature: I had `stream` param — when stream=True, prompt phase uses stream_chat and ttft gets recorded. Good, and latency branch of CLI has --stream flag.

Also `make_prompt(400)`: para length = let me count: "The quick brown fox jumps over the lazy dog while the compiler emits warnings about implicit conversions between signed and unsigned integers in legacy code. " — roughly 157 chars. n = int(400 / (157/4) + 1) = int(400/39.25 + 1) = int(11.72)=11... wait `1.0/CHARS_PER_TOKEN` = 0.25. len(para)*0.25 ≈ 39.25. 400/39.25 = 10.19 → +1 = 11.19 → int = 11. para*11 ≈ 1727 chars + header. Truncate to int(400*4)=1600. Good.

Test: `make_prompt(100)` → len ≤ 400+ε and starts with "Summarize". Actually exact len: min(len, 400) → exactly 400 if enough. Assert 300 <= len <= 450.

OK — also `CompletionResult.status` property returns None; a bit silly but harmless. Actually let me remove the `status` property to keep it clean... it's fine to remove. Remove.

`BenchmarkResult.from_completion` — set status=200. ok.

In test for from_error: create LLMRequestError("HTTP 500", status=500, elapsed=1.2), check fields.

Also verify `run_latency` with `print_progress=False` in tests — yes param exists.

`gpu_snapshot` in tests spawns nvidia-smi — fine (returns failure string if absent).

One more: `run_latency` uses `c.chat(...)` for decode with `ignore_eos=...` — `ignore_eos` is in **extra so passed through. Good.

Now, `sys.path.insert` in test file: tests run from repo root, and pytest is invoked as `python3 -m pytest tests/test_llmbench.py` — the test file's directory gets added to sys.path by pytest (rootdir tests/ no __init__.py → pytest inserts tests/ into sys.path due to its rootdir-based "rootdir" insertion with rootdir/tests in `sys.path` (the "rootdir" import mode is `prepend`). Actually with import-mode=prepend and no __init__.py, pytest inserts the test file's directory (tests/) into sys.path[0]. So `import llmbench` works without the explicit sys.path hack. But the explicit insert is harmless and makes it work when running as plain `python tests/test_llmbench.py` too? No, pytest still needed. Keep the explicit insert for robustness.

Now, `failures` list — I'll implement handler:

```python
def do_POST(self):
    length = int(self.headers.get("Content-Length", 0) or 0)
    body_raw = self.rfile.read(length)
    if self.path == "/v1/chat/completions":
        body = json.loads(body_raw or b"{}")
        if self.server.failures:
            code = self.server.failures.pop(0)
            self._send_json(code, {"error": {"message": f"fake failure {code}"}})
            return
        ...
```

Handler class default: `failures = []` — careful with mutable class attr; use `getattr(self.server, "failures", [])` and always set in FakeServer.__init__. Fine.

Test list (final):

1. `test_chat_success` — content, usage, wall>0, model in data.
2. `test_chat_retries_transient` — failures=[500,500] → succeeds; verify server saw 3 requests? I could track `self.server.request_count`. Let me add a `self.server.request_count = 0` incremented in do_POST. Assert request_count == 3.
3. `test_chat_retries_exhausted` — failures=[500]*4, client retries=3 → raises LLMRequestError, status 500; request_count == 4.
4. `test_chat_400_not_retried` — failures=[400] → raises status 400; request_count == 1.
5. `test_chat_connection_refused_retries` — client to closed port → raises LLMRequestError status 0. (Use a server that's been stopped: bind to port then close. Simpler: LLMClient(base_url="http://127.0.0.1:1", ...) → port 1 refuses. request_count N/A. timeout small, retries=1, retry_base=0.01.)
6. `test_stream_ttft` — stream_delay=0.2; stream_chat → ttft >= 0.2 (approx; assert 0.15 <= ttft < 2.0), chunks >= len(text)+1, content == text, completion_tokens == min(max_tokens,10).
7. `test_stream_retry_before_first_chunk` — failures=[500]; stream_chat succeeds; request_count == 2.
8. `test_stream_no_chunks` — hmm, hard to fake empty stream (server returns 200 with no data lines → _stream_once raises "stream ended with no chunks"). Can add a server mode `empty_stream=True`: send 200, no data, close. Then stream_chat with retries=0 → LLMRequestError. With retries=1 → retried (ttft None) → second also empty → raise after 2 attempts. Add attr `empty_stream` on server: if set, send 200 with no body and return. But careful: non-streaming would also use it — limit use to this test.

Hmm wait: `for raw in resp` with HTTP/1.0 close-delimited — fine, no lines → chunks empty → LLMRequestError("stream ended with no chunks", status=0). Good.

9. `test_percentile` + empty raises ValueError.
10. `test_summarize` — mix of ok/fail results → counts, errors list, latency percentiles.
11. `test_export_json` — tmp_path; check doc keys, results length, summary.
12. `test_export_csv` — tmp_path; check header row == CSV_COLUMNS, row count.
13. `test_run_latency` — fake server, skip_warmup=True, decode_tokens=10, prompt_tokens=200, stream=False. results: modes ["decode","prompt"], extra has decode_tps>0, prompt_tps>0, vram key. prompt result prompt_tokens > 0.
14. `test_run_latency_stream_ttft` — stream=True → prompt result ttft is not None.
15. `test_run_stress` — 6 text jobs, concurrency 2, all ok; summary keys; results[0].mode=="text".
16. `test_run_stress_vision` — skipif PIL; jobs=[(7,True)] → vision True, ok.
17. `test_run_stress_failure` — failures = [500]*50 → all fail; summary["failed"] == 6; each result error non-None.
18. `test_cli_parser` — subcommands and defaults.
19. `test_make_prompt`.

For 17, client with retries=0 (run_stress creates its own client if not passed; pass client=client with retries=0, retry_base=0.01). failures list [500]*6 → each request fails once, no retry → 6 failures. Note: run_stress passes timeout via _result_for → client.chat(timeout=...) — sets self.timeout. Fine.

Wait, in `run_stress` I create client if None with `retries=0` — and tests pass client explicitly. In test 17, the shared `client` fixture has retries=3; pass a dedicated client with retries=0. OK.

Careful with shared fixtures: `client` fixture is function-scoped, fresh per test. `fake_server` also function-scoped → fresh server per test with reset state.

For test 5 (connection refused): I won't use the fake_server fixture.

Timing: retry_base=0.01 keeps sleeps tiny. test 3: 3 retries → sleeps 0.01, 0.02, 0.04 ≈ 0.07s. Fine.

TTFT test tolerance: stream_delay=0.2 → ttft should be ≥ ~0.2 (server sleeps before first write). But urllib returns after header received (send_response + end_headers happen before sleep). So first chunk arrival ≈ 0.2s after. Assert ttft >= 0.15. Upper bound: < 5.

Now, potential issue: in `_stream_once`, `resp` iterates lines. Server sends `data: ...\n\n` per chunk — each line separate. `[DONE]` handled. Good.

Another consideration — `chat()` sets `self.timeout = timeout` when timeout is not None — mutating the shared client mid-way from multiple threads (stress). Threads would set the same value so it's harmless.

For `stream_chat` I also set self.timeout. Fine.

Edge: `BenchmarkResult.from_error` — exc.ttft may be None; ok.

CSV: `vision` bool → written as "True"/"False". Fine.

`export_json` summary may contain numpy? No.

Now, `main()`'s latency summary: `extra["wall_s"]` — set in run_latency: `t0 = time.monotonic()` at start, `extra["wall_s"] = round(time.monotonic() - t0, 2)` at end.

Let me also keep `run_latency` returning `Tuple[List[BenchmarkResult], Dict[str, Any]]` as documented.

Double-check `percentile` on empty → ValueError — test uses pytest.raises.

OK, one more thought: test file imports `CompletionResult` — defined. `build_parser` — defined.

`build_parser()` — `ap.add_argument("--model", required=True)` — CLI requires --model before subcommand? `llmbench --model X latency`. Hmm, the old scripts had --model as a top-level-ish optional (bench: `bench_llm.py --model`). Keep --model required at top level: usage `llmbench --model qwen38-27b latency --decode-tok 600`. Works with parse_args(["--model","m","latency"]).

Actually cleaner: --model per subcommand? Top-level is fine and matches old usage pattern (`bench_llm.py --model X`). Keep.

Now let me write the final clean code. Let me re-check imports in llmbench.py: argparse, csv, io, itertools, json, os, random, subprocess, sys, time, urllib.*, concurrent.futures, dataclasses, typing. `io` used in make_test_image_b64. `random` in run_stress. `urllib.parse` — do I use it? Not needed; remove. `Dict, Iterable, List, Optional, Tuple, Any` — used.

Final version of make_test_image_b64:

```python
def make_test_image_b64() -> Optional[str]:
    try:
        import base64, io as _io
        from PIL import Image, ImageDraw
    except ImportError:
        return None
    img = Image.new("RGB", (256, 256), (40, 90, 160))
    d = ImageDraw.Draw(img)
    d.rectangle([30, 30, 120, 120], fill=(220, 60, 60))
    d.ellipse([140, 30, 230, 120], fill=(60, 200, 90))
    buf = _io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()
```

Note: PIL import happens inside function → run_stress calls it only if there are vision jobs. Good.

`server_timings` uses subprocess grep — in tests (run_latency), log path is /home/oliver/llama-api/logs/llama-server.log which may exist in this env; grep may return lines — fine. In test env without it → []. OK.

Wait, `server_timings` has `timeout=15` param and a `log_path` param default SERVER_LOG — good for tests to pass a tmp path.

For run_latency, should I add a `log_path` param? Not needed.

OK, `main` returns int, and `if __name__ == "__main__": sys.exit(main())`.

Test for parser:

```python
def test_cli_parser():
    args = build_parser().parse_args(["--model", "m", "latency", "--decode-tok", "100"])
    assert args.cmd == "latency"
    assert args.decode_tok == 100
    assert args.skip_warmup is False
    args2 = build_parser().parse_args(["--model", "m", "stress", "--requests", "5", "--vision-ratio", "0.5"])
    assert args2.cmd == "stress"
    assert args2.requests == 5
    assert args2.vision_ratio == 0.5
```

OK. Time to write final answer with both files and the migration note.

Double-check test 13 (`test_run_latency`): fake server completion_tokens = min(max_tokens,10). decode max_tokens=10 → 10 tokens. wall>0 → decode_tps>0. prompt phase: max_tokens=8 (default param max_tokens=8 in run_latency) → completion 8; prompt_tokens = len(json body)//8+1 > 0 (prompt is 200 tokens * 4 = 800 chars → body ~800+ → //8 ≈ 100). prompt_tps > 0.

Also `run_latency` results list: [decode, prompt] when skip_warmup. modes: "decode","prompt". Good.

Also in `run_latency`, for decode, `ignore_eos=True` when 10 > 300? No — 10 <= 300 → ignore_eos False. Fine.

One more check — `CompletionResult.content()` with fake server non-stream: data["choices"][0]["message"]["content"] = reply_text = "OK". Empty content test not needed.

In `run_stress`, `_result_for` gets `body` and `timeout`. `client.chat(**