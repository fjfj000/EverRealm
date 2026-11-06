# -*- coding: utf-8 -*-
"""生成《行政区域规则表.xlsx》：完整规则 + 自动倍率公式 + 各国面积权重。

领土权重和国名以 特征/国家特征.json 为准，不再读取外部《数据模拟.xlsx》。
兵力比例不在这张表里计算，见 特征/兵役与国势.json 与 产出/十国行政区划.xlsx。
"""
import json
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from settlement import totals as settlement_totals

ROOT = Path(__file__).resolve().parents[1]
FEATURE_PATH = ROOT / "特征" / "国家特征.json"
OUT = ROOT / "产出" / "行政区域规则表.xlsx"

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
ws["A1"].value = "行政区域规则表（国土 960 万 km²；村数按设计，四方约 200、中原略多。蓝底格为可编辑输入，黄底格为公式）"
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

# 窗口按新的单位规模：一国大约 200 村，而不是面积÷16。
# 下限大约是各国均分值的四成，上限大约是均分值的三倍，给明星聚集和切分留空。
# 要塞面积仍是 1700–4000，不随县放大；城防下限高于村县。
rules = [
    ("人数下限", [50000, 250000, 1000000, 2000000, 700000, 40000]),
    ("人数上限", [1000000, 5000000, 20000000, 42000000, 11000000, 400000]),
    ("兵力下限", [5000, 25000, 100000, 250000, 80000, 10000]),
    ("兵力上限", [150000, 800000, 2500000, 6000000, 1500000, 160000]),
    ("面积下限", [1000, 5000, 15000, 80000, 20000, 1700]),
    ("面积上限", [18000, 90000, 350000, 700000, 160000, 4000]),
    ("制造下限", [15, 70, 300, 600, 200, 20]),
    ("制造上限", [600, 3000, 12000, 28000, 8000, 1500]),
    ("城防下限", [15, 70, 300, 800, 400, 2000]),
    ("城防上限", [250, 1200, 5000, 12000, 6000, 40000]),
    ("文化下限", [8, 40, 150, 400, 250, 10]),
    ("文化上限", [350, 1800, 7000, 15000, 8000, 400]),
    ("经济下限", [60, 300, 1200, 2500, 800, 150]),
    ("经济上限", [4000, 20000, 80000, 180000, 45000, 6000]),
    ("产粮下限", [100, 500, 2000, 5000, 1500, 400]),
    ("产粮上限", [7000, 35000, 140000, 300000, 80000, 15000]),
    ("建筑下限", [1, 5, 20, 40, 15, 10]),
    ("建筑上限", [40, 200, 800, 1600, 500, 400]),
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
    "口径：面积单位为 km²。人数、兵力和其他指标都是该单位里的总量。",
    "村数是设计目标，不按面积÷16。四方 180–220 村，中原 240 与 260。每乡 5 村，每县 4 乡，每郡 2 县，京畿另有 1–2 县。",
    "要塞仍是小型防区，面积 1700–4000 km²，城防偏高，产粮和文化偏低。",
    "京畿是首都圈，人口和面积都低于任意一个郡。",
    "倍率区块为公式：京畿倍率相对郡，要塞倍率相对县。改区块一的数值，倍率自动更新。",
]
for i, n in enumerate(notes):
    style_cell(ws.cell(row=r + i, column=1), align="left", wrap=True)
    ws.merge_cells(start_row=r + i, start_column=1, end_row=r + i, end_column=14)
    ws.cell(row=r + i, column=1).value = n
    ws.cell(row=r + i, column=1).alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    ws.cell(row=r + i, column=1).font = Font(name=ZH_FONT, size=9, color="5A6A78")
ws.freeze_panes = "B5"

# ============ Sheet2 兵种强度（参照，不参与分地） ============
features = json.loads(FEATURE_PATH.read_text(encoding="utf-8"))
countries = features["countries"]
weight_sum = sum(item["territoryWeight"] for item in countries)

ws2 = wb.create_sheet("兵种强度")
headers = ["", "平民", "地民", "轻步", "重步", "枪兵", "轻骑兵", "重骑兵", "特殊骑兵", "步弓兵", "骑射手", "步投", "骑投"]
codes = ["", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12"]
for col, text in enumerate(headers, start=1):
    if text:
        style_cell(ws2.cell(row=2, column=col), bold=True, size=10, color="FFFFFF", fill=HEAD_FILL)
        ws2.cell(row=2, column=col).value = text
for col, text in enumerate(codes, start=1):
    if text:
        style_cell(ws2.cell(row=3, column=col))
        ws2.cell(row=3, column=col).value = text
for idx, country in enumerate(countries):
    row = 4 + idx
    style_cell(ws2.cell(row=row, column=1), bold=True, align="left")
    ws2.cell(row=row, column=1).value = country["id"] + country["name"]
    for col, q in enumerate(country["unitQ"], start=2):
        style_cell(ws2.cell(row=row, column=col), fmt="0")
        ws2.cell(row=row, column=col).value = q
set_widths(ws2, {"A": 14, **{get_column_letter(c): 10 for c in range(2, 14)}})

# ============ Sheet3 城市数据 ============
ws3 = wb.create_sheet("城市数据")
set_widths(ws3, {"A": 12, "B": 11, "C": 11, "D": 11, "E": 11, "F": 11, "G": 11,
                 "H": 13, "I": 11, "J": 20})
ws3.merge_cells("A1:J1")
style_cell(ws3["A1"], bold=True, size=13, color="FFFFFF", fill=ACCENT, align="center")
ws3["A1"].value = "各国面积与区划数量（面积按领土权重分配 960万km²；村数按设计，不按面积除）"
ws3.row_dimensions[1].height = 26

hdr3 = ["国家", "里/村", "乡", "县", "郡/国", "京畿", "要塞", "面积(km²)", "领土权重", "备注"]
for i, v in enumerate(hdr3, start=1):
    style_cell(ws3.cell(row=3, column=i), bold=True, size=10, color="FFFFFF", fill=HEAD_FILL)
    ws3.cell(row=3, column=i).value = v

# 面积 = 960万 × 本国领土权重 / 权重合计。权重来自国家特征，不使用兵种 Q 合计。
ws3["A15"] = "面积=960万×领土权重/权重合计({0})。兵力不在本表。".format(weight_sum)
style_cell(ws3["A15"], align="left", wrap=True)
ws3.merge_cells("A15:J15")

r0 = 4
for idx, country in enumerate(countries):
    row = r0 + idx
    ws3.cell(row=row, column=1).value = country["id"] + " " + country["name"]
    ws3.cell(row=row, column=9).value = country["territoryWeight"]
    ws3.cell(row=row, column=8).value = "=ROUND(9600000*I{0}/SUM($I$4:$I$13),0)".format(row)
    plan = settlement_totals(country)
    ws3.cell(row=row, column=2).value = plan["cun"]
    ws3.cell(row=row, column=3).value = plan["xiang"]
    ws3.cell(row=row, column=4).value = plan["xian"]
    ws3.cell(row=row, column=5).value = plan["jun"]
    ws3.cell(row=row, column=6).value = 1
    ws3.cell(row=row, column=7).value = country["forts"]
    ws3.cell(row=row, column=10).value = country["bloc"] + "·" + country["starTitle"]
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
    ("这是什么", "行政区域规则的可编辑工作簿。各国差异、兵役和明星聚集地不在本表手填，改 特征/ 后运行 generate_regions.py。"),
    ("区块一（可编辑）", "行政区域规则·区块一是窗口输入：改任意下限/上限，区块二倍率自动重算。要塞面积仍是 1700–4000 km²。京畿小于郡。"),
    ("区块二（自动）", "倍率为公式：京畿倍率相对郡、要塞倍率相对县。"),
    ("城市数据（自动）", "面积=960万×领土权重/权重合计。里/村、乡、县、郡来自国家特征的 settlement，不再用面积去除。京畿每国 1 个。要塞座数来自国家特征。"),
    ("兵种强度", "B1–B12 的 Q 值，只供兵种参照。区划面积不使用这张表的合计。"),
    ("兵力", "常备是息民 5%、守成 8%、经武 10%、整军 11%、穷兵 12%。中原取经武，为十国中位数。国势加征随世界变化，不计入常备。"),
    ("联动提醒", "改区块一的面积区间，不会反向改城市数量。数量写在国家特征的 settlement 里。"),
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
