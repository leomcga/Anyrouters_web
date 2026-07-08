#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_image.py —— gpt-image-2 完整画图工具（给 Codex 调用），走 anyrouters 中转

最正规方案：用 OpenAI 官方 SDK（base_url 指向 anyrouters），完整运用 gpt-image-2 的能力：
  1) 文生图        images.generations —— 全参数（尺寸/质量/透明背景/格式/审核/张数）
  2) 图生图/参考图  images.edits       —— 一张或多张参考图，做风格迁移/合成
  3) 局部重绘(inpaint) images.edits + mask —— 只改 mask 透明区域，其余像素不动

用你 Codex 已有的同一个 anyrouters key（环境变量 OPENAI_API_KEY），
计费统一走中转、不暴露上游 key。

安装（一次）：  pip install --upgrade openai

用法示例：
  # 文生图
  python3 gen_image.py "一只圆润可爱的水杯吉祥物，扁平风格" 水杯.png
  # 透明背景贴纸（png/webp 才支持透明）
  python3 gen_image.py "史莱姆怪物精灵图，侧视" slime.png --background transparent --format png
  # 高质量、竖图
  python3 gen_image.py "赛博朋克城市海报" poster.png --size 1024x1536 --quality high
  # 图生图：给一张参考图改风格
  python3 gen_image.py "把这张照片改成水彩画风格" out.png --edit 原图.jpg
  # 多参考图合成
  python3 gen_image.py "把第二张的图案印到第一张的T恤上，保持真实光影" out.png --edit 人物.png 图案.png
  # 局部重绘：只改 mask 透明区域
  python3 gen_image.py "把这块区域改成一个游泳池" out.png --edit 房间.png --mask mask.png

参数：
  位置1 prompt      画什么 / 怎么改
  位置2 outfile     输出文件名（可选，默认时间戳，存到 桌面/AnyRouters图片/）
  --size     1024x1024 | 1024x1536 | 1536x1024 | auto（默认 1024x1024）
  --quality  low | medium | high | auto（默认 high）
  --n        一次生成几张（默认 1）
  --model    默认 gpt-image-2（也可 gemini-3-pro-image，人脸更稳）
  --background auto | transparent | opaque（透明需配 --format png/webp）
  --format   png | webp | jpeg（默认 png）
  --moderation auto | low
  --edit  参考图 [参考图...]   走图生图/编辑端点
  --mask  蒙版.png            局部重绘，透明区=要改处（需配 --edit）

Windows 上把命令里的 python3 换成 python（或 py）。
"""

import os
import sys
import base64
import argparse
import subprocess
import shutil
from datetime import datetime

# Windows 终端默认 GBK，打印 ✓/✗ 等字符会崩，强制用 UTF-8 输出
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

try:
    from openai import OpenAI
except ImportError:
    print("✗ 缺少 openai SDK。先运行：pip install --upgrade openai", file=sys.stderr)
    sys.exit(1)

# 走 anyrouters 中转（OpenAI 兼容），key 复用 Codex 的 OPENAI_API_KEY
BASE_URL = os.environ.get("ANYROUTERS_BASE", "https://api.anyrouters.com/v1")
API_KEY = os.environ.get("ANYROUTERS_KEY") or os.environ.get("OPENAI_API_KEY", "")

OUT_DIR = os.path.join(os.path.expanduser("~"), "Desktop", "AnyRouters图片")


def normalize_size(size):
    """gpt-image-2 / gemini 要求宽高都能被 16 整除。
    传入非法尺寸时就近取合法值并提示；auto 原样放行。"""
    if not size or size.lower() == "auto":
        return size
    try:
        w_str, h_str = size.lower().split("x")
        w, h = int(w_str), int(h_str)
    except ValueError:
        print("! 尺寸格式应为 宽x高（如 1456x592）或 auto，原样发送：" + size,
              file=sys.stderr)
        return size

    def round16(v):
        return max(16, int(round(v / 16.0)) * 16)

    nw, nh = round16(w), round16(h)
    if (nw, nh) != (w, h):
        print("! 尺寸 %dx%d 宽高需能被16整除，已自动改为 %dx%d。"
              % (w, h, nw, nh), file=sys.stderr)
    return "%dx%d" % (nw, nh)


def build_client():
    if not API_KEY:
        print("✗ 没读到 anyrouters key。", file=sys.stderr)
        print('  mac/Linux:  export OPENAI_API_KEY="你的anyrouters密钥"', file=sys.stderr)
        print('  Windows  :  setx OPENAI_API_KEY "你的anyrouters密钥"（重开终端生效）', file=sys.stderr)
        sys.exit(1)
    return OpenAI(base_url=BASE_URL, api_key=API_KEY, timeout=180)


def save_b64(items, out_path, n):
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    saved = []
    for i, item in enumerate(items):
        b64 = getattr(item, "b64_json", None)
        if not b64:
            url = getattr(item, "url", None)
            if url:
                print("  返回了 URL（非 b64）：" + url, file=sys.stderr)
            continue
        if n == 1:
            fp = out_path
        else:
            root, ext = os.path.splitext(out_path)
            fp = root + "_" + str(i + 1) + ext
        with open(fp, "wb") as f:
            f.write(base64.b64decode(b64))
        saved.append(fp)
    for fp in saved:
        print("✓ 已生成：" + fp)
    if not saved:
        print("✗ 返回里没有图片数据。", file=sys.stderr)
        sys.exit(1)
    folder = os.path.dirname(os.path.abspath(saved[0]))
    try:
        if os.name == "nt":
            subprocess.Popen(["explorer", folder])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", folder])
        elif shutil.which("xdg-open"):
            subprocess.Popen(["xdg-open", folder])
    except OSError:
        pass
    return saved


def do_generate(client, args, out_path):
    kw = dict(
        model=args.model,
        prompt=args.prompt,
        size=args.size,
        quality=args.quality,
        n=args.n,
        output_format=args.format,
        moderation=args.moderation,
    )
    if args.background != "auto":
        kw["background"] = args.background
    resp = client.images.generate(**kw)
    return save_b64(resp.data, out_path, args.n)


def do_edit(client, args, out_path):
    images = [open(p, "rb") for p in args.edit]
    mask_f = open(args.mask, "rb") if args.mask else None
    kw = dict(
        model=args.model,
        image=images if len(images) > 1 else images[0],
        prompt=args.prompt,
        size=args.size,
        quality=args.quality,
        n=args.n,
    )
    if mask_f:
        kw["mask"] = mask_f
    try:
        resp = client.images.edit(**kw)
    finally:
        for f in images:
            f.close()
        if mask_f:
            mask_f.close()
    return save_b64(resp.data, out_path, args.n)


def main():
    ap = argparse.ArgumentParser(description="gpt-image-2 完整画图工具（走 anyrouters）")
    ap.add_argument("prompt", help="画什么 / 怎么改")
    ap.add_argument("outfile", nargs="?", default=None, help="输出文件名（默认时间戳）")
    ap.add_argument("--size", default="1024x1024",
                    help="1024x1024 | 1024x1536 | 1536x1024 | auto")
    ap.add_argument("--quality", default="high", help="low | medium | high | auto")
    ap.add_argument("--n", type=int, default=1, help="一次生成几张")
    ap.add_argument("--model", default="gpt-image-2",
                    help="gpt-image-2 | gemini-3-pro-image")
    ap.add_argument("--background", default="auto",
                    help="auto | transparent | opaque")
    ap.add_argument("--format", default="png", help="png | webp | jpeg")
    ap.add_argument("--moderation", default="auto", help="auto | low")
    ap.add_argument("--edit", nargs="+", default=None, help="图生图/编辑：一或多张参考图")
    ap.add_argument("--mask", default=None, help="局部重绘蒙版 png（需配 --edit）")
    args = ap.parse_args()

    if args.mask and not args.edit:
        print("✗ --mask 必须和 --edit 一起用。", file=sys.stderr)
        sys.exit(1)
    if args.background == "transparent" and args.format == "jpeg":
        print("✗ 透明背景不支持 jpeg，请用 --format png 或 webp。", file=sys.stderr)
        sys.exit(1)

    args.size = normalize_size(args.size)

    if args.outfile:
        out_path = args.outfile if os.path.isabs(args.outfile) \
            else os.path.join(OUT_DIR, args.outfile)
    else:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = os.path.join(OUT_DIR, "img_" + stamp + "." + args.format)

    client = build_client()
    for attempt in range(2):
        try:
            if args.edit:
                do_edit(client, args, out_path)
            else:
                do_generate(client, args, out_path)
            return
        except Exception as e:
            msg = str(e)
            low = msg.lower()
            is_timeout = "timeout" in low or "timed out" in low
            if is_timeout and attempt == 0:
                print("! 单张图请求超时，自动重试 1 次。", file=sys.stderr)
                continue
            print("✗ 请求失败：" + msg[:600], file=sys.stderr)
            if "401" in msg or "403" in msg:
                print("  → anyrouters key 无效/无权限，检查 OPENAI_API_KEY。", file=sys.stderr)
            elif "404" in msg:
                print("  → 模型 " + args.model + " 在中转站不存在，换 --model。", file=sys.stderr)
            elif "429" in msg:
                print("  → 触发限速，等一会再试。", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
