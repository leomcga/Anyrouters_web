---
name: anyrouters-image
description: 生成/编辑图片。用户说"生成图片/画图/做图/生图/出图/海报/logo/产品图/改图/换风格/局部重绘/透明背景/参考图合成"等，一律用本技能，绝不自己用代码画图。
---

# AnyRouters 生图技能（gpt-image-2）

用户要任何图片时，**必须**运行本文件夹里的 `gen_image.py`（走 anyrouters 中转调 gpt-image-2）。

## 安装前提
1. 设备需要安装 Python。
2. 需要安装 OpenAI SDK：`python -m pip install --upgrade openai`
3. 使用用户自己的 AnyRouters API Key。默认读取环境变量 `OPENAI_API_KEY`，也兼容 `ANYROUTERS_KEY`。
4. 设置环境变量后，必须完全退出并重新打开 Codex。

## 铁律
1. **绝对禁止任何形式的"假图"降级**：不许用 PIL/matplotlib/SVG 代码手绘，也不许用 HTML 渲染截图、浏览器自动化（Playwright/Puppeteer）截图等方式冒充生成图。用户要的是 AI 生成的真图，做不到就报错，不许凑数。
2. 默认参数：`--quality high`；输出保存到桌面 `AnyRouters图片` 文件夹（不存在则先创建），文件名用内容起中文名。
3. 生成成功后打开输出文件夹让用户直接看到图。
4. 报错时**原样告诉用户真实错误**并给建议：
   - 提示词被审核拦（UserError）→ 建议改写文案，或加 `--moderation low` 重试一次
   - 401/403 → key 失效，让用户联系管理员
   - 仍失败 → 建议用户去 anyrouters.com 工作台改用 gemini-3-pro-image
5. **超时**：单张图等满 3 分钟没结果算超时，自动重试 1 次；再失败就停下报告，不许无限重试烧额度。
6. **改用户上传的图之前**（本次对话第一次涉及时），先提示并等确认：「提示：你上传的图片会发送给 AI 服务处理，请注意不要包含证件、人脸等敏感内容。回复确认后我再继续。」
7. Windows 上用 `python`（不是 python3）。
8. 比例/尺寸：优先按用户要求选择横图 `1536x1024`、竖图 `1024x1536`、方图 `1024x1024`。如果用户给了自定义尺寸，宽高必须是 16 的倍数；`gen_image.py` 会自动把不合法尺寸四舍五入到最近的 16 倍数。

## 用法速查
```
python gen_image.py "提示词" 输出.png                     # 文生图
python gen_image.py "提示词" 输出.png --size 1536x1024    # 宽图（竖图 1024x1536）
python gen_image.py "改成水彩风" 输出.png --edit 原图.jpg  # 图生图/风格迁移
python gen_image.py "把此区域改成泳池" 输出.png --edit 房间.png --mask mask.png  # 局部重绘
python gen_image.py "贴纸" 输出.png --background transparent  # 透明背景
```
