# 构建脚本

`python scripts/package.py`：只用标准库生成一个 Chrome / Edge 通用 ZIP。

`python scripts/build_guide.py`：可选重新生成 PDF，依赖 reportlab、Pillow 和中文 TrueType 字体；非 Windows 系统可通过 COURT_CJK_FONT 指定字体文件。
