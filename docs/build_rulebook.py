# -*- coding: utf-8 -*-
"""生成《行政区域规则表.xlsx》：完整规则 + 自动倍率公式 + 各国行政数据。"""
import copy
from openpyxl import load_workbook, Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

SRC = "/Users/felix/Downloads/数据模拟.xlsx"
OUT = "/Users/felix/Doubao/chats/2026-10-16/new-chat/行政区域规则表.xlsx"

# ---------- 视觉 token ----------
INK = "1F2A36"
TITLE_FILL = "28333E"     # 深墨蓝 表头
HEAD_FILL = "34495E"      # 次级表头
ALT_FILL = "F4F6F8"       # 斑马（轻）
ACCENT = "B3402A"         # 朱砂（标题底）
LINE = "C7D0D8"
ZH_FONT = "微软雅黑"

thin = Side(style="thin", color=LINE)
border_all = Border(left=thin, right=thin, top=thin, bottom=thin)

def style_cell(c, bold=False, size=10, color=INK, fill=None, align="center",
               fmt=None, wrap=False, border=True):
    c.font = Font(name=ZH_FONT, bold=bold, size=size, color=color)
    if fill:
        c.fill = PatternFill("solid", fgColor=fill)
    c.alignment = Alignment(horizontal=align, vertical="center", wrap_text=wrap)
    if fmt:
        c.number_format = fmt
    if border:
        c.border = border_all
    return c

def set_widths(ws, widths):
    for col, w in widths.items():
        ws.column_dimensions[col].width = w

wb = Workbook()

# ============ Sheet1 行政区域规则 ============
ws = wb.active
ws.title = "行政区域规则"
set_widths(ws, {"A": 12, "B": 11, "C": 11, "D": 11, "E": 12, "F": 11, "G": 11,
                "I": 11, "J": 11, "K": 11, "L": 12, "M": 12, "N": 11})

levels = ["里/村C1", "乡C2", "县C3", "郡/国C4", "京畿C5", "要塞C6"]

# 标题
ws.merge_cells("A1:N1")
style_cell(ws["A1"], bold=True, size=13, color="FFFFFF", fill=ACCENT,
           align="center")
ws["A1"].value = "行政区域规则表（按中国国土960万km²推算；蓝底格为可编辑输入，黄底格为公式自动计算）"
ws.row_dimensions[1].height = 26

# 两个区块的表头
ws.merge_cells("A3:G3")
style_cell(ws["A3"], bold=True, size=10, color="FFFFFF", fill=TITLE_FILL, align="center")
ws["A3"].value = "区块一 · 各级直接上限/下限（编辑输入）"
ws.merge_cells("I3:N3")
style_cell(ws["I3"], bold=True, size=10, color="FFFFFF", fill=TITLE_FILL, align="center")
ws["I3"].value = "区块二 · 前级为后级倍率（=后项/前项，自动算）"

# 列头
hdr = ["指标", "里/村C1", "乡C2", "县C3", "郡/国C4", "京畿C5", "要塞C6",
       "", "里/村C1", "乡C2", "县C3", "郡/国C4", "京畿C5", "要塞C6"]
for i, v in enumerate(hdr, start=1):
    c = ws.cell(row=4, column=i)
    if v:
        style_cell(c, bold=True, size=10, color="FFFFFF", fill=HEAD_FILL)
        c.value = v
ws.row_dimensions[4].height = 20

# 数据：指标行 = (名称, 直接值[6], 基准说明)
rules = [
    ("人数下限", [500, 1000, 3000, 15000, 12000, 3000]),
    ("人数上限", [1000, 4000, 20000, 160000, 80000, 15000]),
    ("兵力下限", [25, 50, 150, 800, 600, 300]),
    ("兵力上限", [100, 400, 2000, 16000, 8000, 8000]),
    ("面积下限", [4, 40, 800, 100000, 10000, 1700]),
    ("面积上限", [40, 1000, 8000, 600000, 50000, 4000]),
    ("制造下限", [2, 8, 60, 2500, 800, 40]),
    ("制造上限", [10, 60, 500, 20000, 5000, 400]),
    ("城防下限", [1, 5, 40, 1500, 2000, 3000]),
    ("城防上限", [5, 40, 300, 12000, 10000, 9000]),
    ("文化下限", [1, 4, 25, 800, 1200, 15]),
    ("文化上限", [5, 30, 200, 8000, 10000, 150]),
    ("经济下限", [10, 50, 400, 15000, 8000, 300]),
    ("经济上限", [50, 400, 3000, 120000, 50000, 2500]),
    ("产粮下限", [20, 100, 800, 30000, 2000, 500]),
    ("产粮上限", [100, 800, 6000, 200000, 15000, 4000]),
    ("建筑下限", [1, 4, 20, 600, 400, 30]),
    ("建筑上限", [5, 30, 200, 8000, 5000, 250]),
]

r = 5
for name, vals in rules:
    style_cell(ws.cell(row=r, column=1), bold=True, align="left")
    ws.cell(row=r, column=1).value = name
    for j, v in enumerate(vals):
        col = 2 + j  # B..G
        c = ws.cell(row=r, column=col)
        c.value = v
        fmt = "#,##0" if "面积" in name or "人数" in name or "经济" in name or "产粮" in name else "#,##0"
        style_cell(c, fmt="#,##0", fill=("EAF2FB" if j % 2 == 0 else None))
    # 倍率公式：I=里村基准1；J=乡/里村；K=县/乡；L=郡/县；M=京畿/郡；N=要塞/县
    ws.cell(row=r, column=9).value = 1
    style_cell(ws.cell(row=r, column=9), fmt="0.00", fill="FFF3D9")
    # J(10)=C(3)/B(2)
    ws.cell(row=r, column=10).value = "=C{0}/B{0}".format(r)
    ws.cell(row=r, column=11).value = "=D{0}/C{0}".format(r)
    ws.cell(row=r, column=12).value = "=E{0}/D{0}".format(r)
    ws.cell(row=r, column=13).value = "=F{0}/E{0}".format(r)
    ws.cell(row=r, column=14).value = "=G{0}/D{0}".format(r)
    for col in range(10, 15):
        style_cell(ws.cell(row=r, column=col), fmt="0.00", fill="FFF3D9")
    r += 1

last = r - 1
# 备注
r += 1
notes = [
    "口径：面积单位为 km²；人数/兵力/制造/城防/文化/经济/产粮/建筑均为单位内的总量上下限。",
    "要塞C6 为防御区：面积按 0.5–1.2 个县设定（县区间 800–8000 → 要塞 1700–4000 km²）；兵力/城防偏高、产粮/文化偏低。",
    "京畿C5 为首都圈：面积按 3–15 个县（1万–5万 km²）；城防/文化为全国最高，人口低于单个郡。",
    "倍率区块为公式自动计算：京畿倍率=京畿/郡（相对郡），要塞倍率=要塞/县（相对县）。改区块一数值，倍率自动更新。",
]
for i, n in enumerate(notes):
    style_cell(ws.cell(row=r + i, column=1), align="left", wrap=True)
    ws.merge_cells(start_row=r + i, start_column=1, end_row=r + i, end_column=14)
    ws.cell(row=r + i, column=1).value = n
    ws.cell(row=r + i, column=1).alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    ws.cell(row=r + i, column=1).font = Font(name=ZH_FONT, size=9, color="5A6A78")
ws.freeze_panes = "B5"

# ============ Sheet2 战力（复制源） ============
src = load_workbook(SRC, data_only=True)
src_zl = src["战力"]
ws2 = wb.create_sheet("战力")
for row in src_zl.iter_rows(min_row=1, max_row=13, max_col=13, values_only=True):
    pass
for rr, row in enumerate(src_zl.iter_rows(min_row=1, max_row=13, max_col=13), start=1):
    for cc, cell in enumerate(row, start=1):
        v = cell.value
        if v is not None:
            tgt = ws2.cell(row=rr, column=cc)
            tgt.value = v
            style_cell(tgt, fmt="#,##0" if isinstance(v, (int, float)) else None)
set_widths(ws2, {"A": 12, **{get_column_letter(c): 8 for c in range(2, 14)}})

# ============ Sheet3 城市数据 ============
ws3 = wb.create_sheet("城市数据")
set_widths(ws3, {"A": 12, "B": 11, "C": 11, "D": 11, "E": 11, "F": 11, "G": 11,
                 "H": 13, "I": 11, "J": 20})
ws3.merge_cells("A1:J1")
style_cell(ws3["A1"], bold=True, size=13, color="FFFFFF", fill=ACCENT, align="center")
ws3["A1"].value = "各国行政区划生成数据（面积按战力占比分配 960万km²，各级数量由面积÷平均面积反推，全公式联动）"
ws3.row_dimensions[1].height = 26

hdr3 = ["国家", "里/村", "乡", "县", "郡/国", "京畿", "要塞", "面积(km²)", "战力合计", "备注"]
for i, v in enumerate(hdr3, start=1):
    style_cell(ws3.cell(row=3, column=i), bold=True, size=10, color="FFFFFF", fill=HEAD_FILL)
    ws3.cell(row=3, column=i).value = v

# 面积参数
ws3["J5"] = "面积=960万×该国战力÷全国战力总和(438)"
style_cell(ws3["J5"], align="left", wrap=True)

# 平均面积参考（计算用）
avg_div = {"里村": 16, "乡": 253, "县": 3375, "郡": 282353}

r0 = 4
for idx in range(10):
    row = r0 + idx          # 战力 sheet 行 4..13
    zl_row = 4 + idx
    country = src_zl.cell(row=zl_row, column=1).value or ""
    ws3.cell(row=row, column=1).value = country
    ws3.cell(row=row, column=9).value = "=SUM(战力!B{0}:M{0})".format(zl_row)
    ws3.cell(row=row, column=8).value = "=ROUND(9600000*I{0}/438,0)".format(row)
    ws3.cell(row=row, column=2).value = "=ROUND(H{0}/16,0)".format(row)
    ws3.cell(row=row, column=3).value = "=ROUND(H{0}/253,0)".format(row)
    ws3.cell(row=row, column=4).value = "=ROUND(H{0}/3375,0)".format(row)
    ws3.cell(row=row, column=5).value = "=MAX(1,ROUND(H{0}/282353,0))".format(row)
    ws3.cell(row=row, column=6).value = 1
    ws3.cell(row=row, column=7).value = "=IF(I{0}>=47,3,2)".format(row)
    ws3.cell(row=row, column=10).value = "国力越强→要塞越多"
    for col in range(1, 11):
        style_cell(ws3.cell(row=row, column=col),
                   fmt=("#,##0" if col in (2, 3, 4, 5, 6, 7, 8, 9) else None),
                   fill=ALT_FILL if idx % 2 == 1 else None)
ws3.freeze_panes = "A4"

# ============ Sheet4 说明 ============
ws4 = wb.create_sheet("说明")
set_widths(ws4, {"A": 24, "B": 80})
ws4.merge_cells("A1:B1")
style_cell(ws4["A1"], bold=True, size=13, color="FFFFFF", fill=TITLE_FILL, align="center")
ws4["A1"].value = "使用说明与口径"
notes4 = [
    ("这是什么", "基于你上传的《数据模拟.xlsx》模板，把行政区域规则表补全成可编辑的完整版本，并按战力生成各国行政区数量。"),
    ("区块一（可编辑）", "行政区域规则·区块一是唯一输入：改任意下限/上限，区块二倍率自动重算。要塞已按 0.5–1.2 县、京畿按 3–15 县设定。"),
    ("区块二（自动）", "倍率为公式自动计算：京畿倍率相对郡、要塞倍率相对县。"),
    ("城市数据（自动）", "各国面积=960万×该国战力÷438；里/村=面积÷16、乡=面积÷253、县=面积÷3375、郡/国=面积÷282353（平均面积口径，均四舍五入）。京畿每国1个；要塞按国力 2–3 个。"),
    ("战力 sheet", "从源文件原样复制，作为面积分配的权重依据。"),
    ("数据来源", "中国陆地总面积约960万km²、各级行政区数量参考官方口径（省级34、县级约2844、乡级约3.8万、村级约60万）；平均面积由总数相除推算。"),
    ("联动提醒", "改区块一的面积区间，不会反向影响城市数据的数量（数量由平均面积反推）；如需调整请直接改城市数据里 H 列面积或除数。"),
]
r = 3
for k, v in notes4:
    style_cell(ws4.cell(row=r, column=1), bold=True, align="left")
    ws4.cell(row=r, column=1).value = k
    style_cell(ws4.cell(row=r, column=2), align="left", wrap=True)
    ws4.cell(row=r, column=2).value = v
    ws4.row_dimensions[r].height = max(16, 15 * (len(v) // 40 + 1))
    r += 1

wb.save(OUT)
print("saved:", OUT)
