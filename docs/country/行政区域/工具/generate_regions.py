# -*- coding: utf-8 -*-
"""按 特征/ 生成十国行政区划，写入 产出/十国行政区划.xlsx。

全国兵力 = 人口 ×（兵役常备 + 国势加征）。
明星聚集地在同级之间拉开特色指标，倍率不超过特征文件里的上限。
面积倍率单独封顶，避免一个郡吞掉半个国。
随机只用于地形和普通单位的轻微抖动，种子固定，重复运行结果相同。
"""
import json
import random
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parents[1]
FEATURE_PATH = ROOT / "特征" / "国家特征.json"
SCALE_PATH = ROOT / "特征" / "兵役与国势.json"
OUT_PATH = ROOT / "产出" / "十国行政区划.xlsx"

# 策划指数：和人数同量级，不是货币。兵力是人数。
PER_CAPITA = {
    "make": 0.00042,
    "def": 0.00022,
    "cul": 0.00028,
    "eco": 0.0018,
    "grain": 0.0036,
    "build": 0.000028,
    "herd": 0.00032,
    "politics": 0.00016,
    "tech": 0.00018,
}
# 随人口下发的指标。英雄是国级名额，不按人均摊。
VALUE_KEYS = ("make", "def", "cul", "eco", "grain", "build", "herd", "politics", "tech", "hero")
PROFILE_FIELD = {
    "make": "make", "def": "defense", "cul": "culture", "eco": "wealth",
    "grain": "grain", "build": "build", "herd": "herd", "politics": "politics", "tech": "tech",
}
LEVEL_AREA = {"jun": 240000, "xian": 3375, "xiang": 253, "cun": 16}
SEED = 20261016

INK = "1F2A36"
TITLE = "28333E"
ACCENT = "B3402A"
STAR = "F8E6DF"
ALT = "F4F6F8"
LINE = "C7D0D8"
ZH_FONT = "微软雅黑"


def load_json(path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def clamp(value, low, high):
    return max(low, min(high, value))


def share(total, weights):
    """按权重切分 total，四舍五入后把余数补回权重最大的一份，保证求和守恒。"""
    weight_sum = sum(weights) or 1
    raw = [total * w / weight_sum for w in weights]
    rounded = [int(round(v)) for v in raw]
    drift = int(round(total)) - sum(rounded)
    if rounded:
        order = sorted(range(len(rounded)), key=lambda i: weights[i], reverse=True)
        step = 1 if drift > 0 else -1
        i = 0
        while drift != 0 and i < 100000:
            idx = order[i % len(order)]
            if rounded[idx] + step >= 0:
                rounded[idx] += step
                drift -= step
            i += 1
    return rounded


class Node(object):
    def __init__(self, kind, node_id, name, area):
        self.kind = kind
        self.node_id = node_id
        self.name = name
        self.area = area
        self.terrain = ""
        self.star = False
        self.star_name = ""
        self.children = []
        self.metrics = {}
        self.xiang_count = 0
        self.cun_count = 0


def metric_value(node, key):
    if key == "area":
        return node.area
    return node.metrics.get(key, 0)


def set_metric(node, key, value):
    if key == "area":
        node.area = value
        node.metrics["area"] = value
    else:
        node.metrics[key] = value


def reweight(parent, key, weight_of):
    kids = parent.children
    if not kids:
        return
    weights = [max(0.2, weight_of(kid)) for kid in kids]
    parts = share(metric_value(parent, key), weights)
    for kid, part in zip(kids, parts):
        set_metric(kid, key, part)


def concentrate_army(nodes, boosts, cap, floor_ratio):
    """在已经按人口摊开的兵力上，把明星单位的兵员上浮，并守住本地占比上下限。"""
    if not nodes:
        return
    pops = [max(1, n.metrics.get("pop", 0)) for n in nodes]
    total_army = sum(n.metrics.get("army", 0) for n in nodes)
    total_pop = sum(pops)
    if total_pop <= 0 or total_army <= 0:
        return
    base = [total_army * p / total_pop for p in pops]
    desired = [a * b for a, b in zip(base, boosts)]
    desired_sum = sum(desired) or 1
    army = [total_army * d / desired_sum for d in desired]
    for _ in range(12):
        excess = 0.0
        free = []
        for i, pop in enumerate(pops):
            hi = pop * cap
            lo = pop * floor_ratio
            if army[i] > hi:
                excess += army[i] - hi
                army[i] = hi
            elif army[i] < lo:
                excess -= lo - army[i]
                army[i] = lo
            else:
                free.append(i)
        if abs(excess) < 1 or not free:
            break
        if excess > 0:
            room = sum(pops[i] * cap - army[i] for i in free)
            if room <= 0:
                break
            for i in free:
                army[i] += excess * (pops[i] * cap - army[i]) / room
        else:
            room = sum(army[i] - pops[i] * floor_ratio for i in free)
            if room <= 0:
                break
            need = -excess
            for i in free:
                army[i] -= need * (army[i] - pops[i] * floor_ratio) / room
    for node, value in zip(nodes, army):
        node.metrics["army"] = int(round(value))
    # 取整后的差额补到人数最多的非封顶节点，保证这一级兵力之和不变。
    drift = int(round(total_army)) - sum(n.metrics["army"] for n in nodes)
    if drift and nodes:
        host = max(nodes, key=lambda n: n.metrics.get("pop", 0))
        host.metrics["army"] = max(0, host.metrics["army"] + drift)


def mark_jun_and_capital(root, profile):
    """郡和京畿在国级就标明星。县要等郡下面拆完再标。"""
    juns = [c for c in root.children if c.kind == "郡"]
    juns.sort(key=lambda n: n.area, reverse=True)
    if juns:
        juns[0].star = True
        juns[0].star_name = profile["starTitle"]
        juns[0].name = profile["starTitle"]
    for kid in root.children:
        if kid.kind == "京畿":
            kid.star = True
            kid.star_name = profile["capitalTitle"]


def mark_star_counties(jun, profile):
    if not jun.star:
        return
    xians = [c for c in jun.children if c.kind == "县"]
    xians.sort(key=lambda n: n.area, reverse=True)
    for xian in xians[:2]:
        xian.star = True
        xian.star_name = profile["starTitle"]
        xian.name = "{0}·{1}县".format(profile["starTitle"], xians.index(xian) + 1)


def apply_peaks(parent, profile, spec):
    """普通单位权重为 1，明星单位为 peak。要塞人少、城防高，不参与面积和人口的明星倍率。"""
    kids = parent.children
    if len(kids) < 2:
        return
    area_peak = min(spec["areaPeakMax"], max(1, profile["popPeak"]))
    metric_peak = min(spec["metricPeakMax"], profile["metricPeak"])

    def area_weight(node):
        if node.kind == "要塞":
            return 0.35
        return area_peak if node.star else 1

    def pop_weight(node):
        if node.kind == "要塞":
            return 0.25
        return profile["popPeak"] if node.star else 1

    def signal_weight(node, key):
        if node.kind == "要塞":
            return metric_peak if key == "def" else 0.3
        return metric_peak if node.star else 1

    reweight(parent, "area", area_weight)
    reweight(parent, "pop", pop_weight)
    for key in VALUE_KEYS:
        if key in profile["starMetrics"]:
            reweight(parent, key, lambda n, k=key: signal_weight(n, k))
        elif key == "def":
            # 要塞城防单独抬高，其余单位仍跟人口，避免湖市也变成 7 倍城墙。
            reweight(parent, key, lambda n, p=metric_peak: max(1, n.metrics.get("pop", 1)) * (p if n.kind == "要塞" else 1))
        else:
            reweight(parent, key, lambda n: max(1, n.metrics.get("pop", 1)))
    boosts = []
    for node in kids:
        if node.kind == "要塞" or (node.star and ("army" in profile["starMetrics"] or "def" in profile["starMetrics"])):
            boosts.append(profile["armyBoost"])
        elif node.star:
            boosts.append(max(1.0, profile["armyBoost"] * 0.85))
        else:
            boosts.append(1.0)
    concentrate_army(kids, boosts, spec["localArmyCap"], spec["localArmyFloor"])


def walk(node):
    yield node
    for child in node.children:
        for item in walk(child):
            yield item


def build_country(profile, spec, grades, states):
    rng = random.Random(SEED + int(profile["id"][1:]))
    weight_sum = spec["weightSum"]
    area = spec["totalAreaKm2"] * profile["territoryWeight"] / weight_sum
    # 表内兵力只含常备。国势加征随世界变化，不写进这张常备表。
    standing = grades[profile["militarization"]]["standing"]
    pop = area * spec["basePersonsPerKm2"] * profile["popDensity"]
    root = Node("国", profile["id"], profile["name"], int(round(area)))
    root.terrain = profile["terrains"][0]
    root.metrics = {
        "area": root.area,
        "pop": int(round(pop)),
        "army": int(round(pop * standing)),
        "hero": int(profile["hero"]),
    }
    for key, coef in PER_CAPITA.items():
        root.metrics[key] = int(round(pop * coef * profile[PROFILE_FIELD[key]]))
    root.rate = standing
    root.profile = profile

    capital_area = int(clamp(rng.uniform(4, 10) * LEVEL_AREA["xian"], 12000, min(area * 0.08, 42000)))
    jun_total = max(1, root.area - capital_area)
    jun_count = int(clamp(round(jun_total / LEVEL_AREA["jun"]), 4, 6))
    jun_weights = [rng.uniform(0.9, 1.1) for _ in range(jun_count)]
    jun_areas = share(jun_total, jun_weights)
    root.children = []
    for i, jun_area in enumerate(jun_areas):
        name = profile["junNames"][i]
        jun = Node("郡", "{0}.{1}".format(profile["id"], i + 1), name, jun_area)
        jun.terrain = rng.choice(profile["terrains"])
        root.children.append(jun)
    capital = Node("京畿", profile["id"] + ".jx", profile["capitalTitle"], capital_area)
    capital.terrain = "平原" if profile["bloc"] == "中原" else rng.choice(profile["terrains"])
    root.children.append(capital)

    # 先按面积把国级指标摊到郡和京畿，再标明星并重分配。
    for key in ("pop", "army") + VALUE_KEYS:
        reweight(root, key, lambda n: n.area)
    mark_jun_and_capital(root, profile)
    apply_peaks(root, profile, spec)

    for jun in [c for c in root.children if c.kind in ("郡", "京畿")]:
        build_counties(jun, profile, spec, rng)
        mark_star_counties(jun, profile)
        apply_peaks(jun, profile, spec)
        for county in [c for c in jun.children if c.kind == "县"]:
            density = profile["popDensity"]
            county.xiang_count = int(clamp(round(county.area / (LEVEL_AREA["xiang"] / max(density, 0.45))), 4, 14))
            county.cun_count = int(clamp(round(county.area / (LEVEL_AREA["cun"] / max(density, 0.45))), 8, 80))
    return root


def build_counties(parent, profile, spec, rng):
    density = max(0.45, profile["popDensity"])
    # 人稀的地方县更大，县数更少。
    divisor = LEVEL_AREA["xian"] / density
    count = int(clamp(round(parent.area / divisor), 4, 16 if parent.kind == "京畿" else 22))
    if parent.kind == "京畿":
        count = int(clamp(count, 4, 12))
    weights = [rng.uniform(0.88, 1.12) for _ in range(count)]
    areas = share(max(count, parent.area - profile["forts"] * 2000), weights)
    parent.children = []
    for i, county_area in enumerate(areas):
        node = Node("县", "{0}.{1}".format(parent.node_id, i + 1), "{0}·{1}县".format(parent.name, i + 1), max(1, county_area))
        node.terrain = rng.choice(profile["terrains"])
        parent.children.append(node)
    for key in ("pop", "army") + VALUE_KEYS:
        reweight(parent, key, lambda n: max(1, n.area))
    # 要塞从本级划出，不另占一套人口总量。
    if parent.kind == "郡" and parent.star:
        carve_forts(parent, profile, rng)


def carve_forts(jun, profile, rng):
    """要塞面积和兵员从明星郡的首县划出，全国总量不增加。"""
    counties = [c for c in jun.children if c.kind == "县"]
    if not counties:
        return
    host = counties[0]
    made = []
    for i in range(profile["forts"]):
        fort_area = int(clamp(rng.uniform(0.5, 1.1) * LEVEL_AREA["xian"], 1700, 4000))
        fort_area = min(fort_area, max(1, host.area // 3))
        host.area -= fort_area
        host.metrics["area"] = host.area
        fort = Node("要塞", "{0}.ys{1}".format(host.node_id, i + 1), "{0}要塞".format(profile["starTitle"]), fort_area)
        fort.terrain = rng.choice(["山林", "丘陵", "平原"])
        fort.star = True
        fort.star_name = profile["starTitle"] + "·要塞"
        jun.children.append(fort)
        made.append(fort)
    # 首县让出人口的一小部分给要塞，兵员稍后由 apply_peaks 按 armyBoost 集中。
    give_pop = max(profile["forts"], int(host.metrics.get("pop", 0) * 0.04 * profile["forts"]))
    give_pop = min(give_pop, host.metrics.get("pop", 0) // 5)
    host.metrics["pop"] = max(1, host.metrics.get("pop", 0) - give_pop)
    pops = share(give_pop, [1] * len(made))
    for fort, pop in zip(made, pops):
        fort.metrics["pop"] = max(1, pop)
        for key in VALUE_KEYS + ("army",):
            moved = int(host.metrics.get(key, 0) * 0.02)
            host.metrics[key] = max(0, host.metrics.get(key, 0) - moved)
            fort.metrics[key] = fort.metrics.get(key, 0) + moved


def sibling_ratio(node, key):
    parent_kids = node._siblings
    values = [metric_value(k, key) for k in parent_kids if metric_value(k, key) > 0]
    if not values:
        return 1
    base = min(values)
    return metric_value(node, key) / base if base else 1


def attach_siblings(root):
    root._siblings = [root]
    for node in walk(root):
        for child in node.children:
            child._siblings = node.children


def style_header(cell):
    cell.font = Font(name=ZH_FONT, bold=True, size=10, color="FFFFFF")
    cell.fill = PatternFill("solid", fgColor=TITLE)
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)


def write_sheet(wb, title, headers, rows, widths):
    ws = wb.create_sheet(title)
    thin = Side(style="thin", color=LINE)
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    ws.append(headers)
    for cell in ws[1]:
        style_header(cell)
        cell.border = border
    for r, row in enumerate(rows, start=2):
        ws.append(row)
        star = row[headers.index("明星")] == "是" if "明星" in headers else False
        for c, cell in enumerate(ws[r], start=1):
            cell.font = Font(name=ZH_FONT, size=10, color=INK)
            cell.border = border
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=c <= 6)
            if star:
                cell.fill = PatternFill("solid", fgColor=STAR)
            elif r % 2 == 0:
                cell.fill = PatternFill("solid", fgColor=ALT)
            if isinstance(cell.value, (int, float)) and c > 6:
                cell.number_format = "0.00" if isinstance(cell.value, float) else "#,##0"
    for i, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    ws.row_dimensions[1].height = 22
    return ws


def quality_factor(country):
    """B3–B12 合计。四方都是 35，中原是 38。"""
    return sum(country["unitQ"][2:]) / 35.0


def combat_score(node, country):
    """兵力按兵种强度加权，其余指标把方位特长算进综合，避免只比人数。"""
    m = node.metrics
    # 兵力是综合的主体。特长指标只提供有限加成，避免人口最多的南方把战力乘成两倍。
    return (
        m.get("army", 0) * quality_factor(country)
        + m.get("def", 0) * 48
        + m.get("grain", 0) * 2
        + m.get("eco", 0) * 2
        + m.get("make", 0) * 16
        + m.get("cul", 0) * 8
        + m.get("herd", 0) * 12
        + m.get("politics", 0) * 18
        + m.get("tech", 0) * 16
        + m.get("hero", 0) * 22000
    )


def row_of(country, node, grade, bloc_note):
    pop = node.metrics.get("pop", 0) or 1
    army = node.metrics.get("army", 0)
    ratio_key = country["starMetrics"][0]
    return [
        country["id"] + " " + country["name"],
        country["bloc"],
        grade["name"],
        "随世界",
        node.kind,
        node.node_id,
        node.name,
        "是" if node.star else "",
        node.star_name,
        node.terrain,
        node.area,
        pop,
        army,
        army / pop,
        node.metrics.get("make", 0),
        node.metrics.get("def", 0),
        node.metrics.get("cul", 0),
        node.metrics.get("eco", 0),
        node.metrics.get("grain", 0),
        node.metrics.get("build", 0),
        node.metrics.get("herd", 0),
        node.metrics.get("politics", 0),
        node.metrics.get("tech", 0),
        node.metrics.get("hero", 0),
        int(round(combat_score(node, country))),
        round(sibling_ratio(node, "pop"), 2),
        round(sibling_ratio(node, ratio_key), 2),
        getattr(node, "xiang_count", 0) or "",
        getattr(node, "cun_count", 0) or "",
        bloc_note if node.kind == "国" else country["trait"] if node.kind in ("郡", "京畿") and node.star else "",
    ]


HEADERS = [
    "国家", "方位", "兵役", "国势", "级别", "编号", "名称", "明星", "明星名", "地形",
    "面积km2", "人口", "兵力", "兵力占人口", "制造", "城防", "文化", "经济", "产粮", "建筑",
    "畜牧", "政治", "科技", "英雄", "综合战力",
    "人口倍率", "特色倍率", "乡数量", "里村数量", "特征",
]
WIDTHS = [14, 8, 8, 10, 8, 16, 16, 8, 14, 8, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 10, 14, 10, 10, 10, 10, 36]


def main():
    spec = load_json(FEATURE_PATH)
    scales = load_json(SCALE_PATH)
    grades = {item["id"]: item for item in scales["militarization"]}
    states = {item["id"]: item for item in scales["states"]}
    countries = spec["countries"]
    spec["weightSum"] = sum(c["territoryWeight"] for c in countries)
    if spec["weightSum"] != 438:
        raise SystemExit("领土权重合计是 {0}，应为 438".format(spec["weightSum"]))

    roots = [build_country(c, spec, grades, states) for c in countries]
    for root in roots:
        attach_siblings(root)

    wb = Workbook()
    intro = wb.active
    intro.title = "口径"
    intro["A1"] = "十国行政区划口径"
    intro["A1"].font = Font(name=ZH_FONT, bold=True, size=16, color="FFFFFF")
    intro["A1"].fill = PatternFill("solid", fgColor=ACCENT)
    intro.merge_cells("A1:B1")
    lines = [
        ("数据从哪来", "特征/国家特征.json 与 特征/兵役与国势.json。改特征后重跑 工具/generate_regions.py。"),
        ("兵力", "表内兵力是常备：人口 × 兵役。息民 5%、守成 8%、经武 10%、整军 11%、穷兵 12%。中原为经武，是十国常备比例的中位数。"),
        ("国势", "生聚 0%、务本 2%、整备 4%、戒严 6%、征伐 8%。国势随世界发展变化，加征不写进常备人数。"),
        ("人口", "从多到少：南方、中原、东方、北方、西方。南方约为西方的 2 倍。"),
        ("面积", "从多到少：西方、北方、中原、东方、南方。"),
        ("特长", "南方经济与粮食；东方政治与制造；中原科技、粮食与文化；西方城防、兵员比例与粮食；北方英雄、城防、兵员与畜牧。"),
        ("综合", "综合战力 = 常备兵力 ×（B3–B12 合计 / 35）+ 城防、粮食、经济、制造、文化、畜牧、政治、科技、英雄。四方接近，中原稍高。"),
        ("明星聚集地", "各国 1 个明星郡、其下 2 个明星县，京畿和要塞另计。特色指标同级倍率不超过 8，面积不超过 3。中原明星倍率停在 4。"),
        ("南方", spec["blocs"]["南方"]),
        ("中原", spec["blocs"]["中原"]),
        ("东方", spec["blocs"]["东方"]),
        ("北方", spec["blocs"]["北方"]),
        ("西方", spec["blocs"]["西方"]),
        ("乡与里村", "写在县一行的数量上，不把每个村子展开成行。明星单位用朱色底标出。"),
    ]
    for i, (k, v) in enumerate(lines, start=3):
        intro.cell(i, 1, k).font = Font(name=ZH_FONT, bold=True, size=11, color=INK)
        intro.cell(i, 2, v).font = Font(name=ZH_FONT, size=10, color=INK)
        intro.cell(i, 2).alignment = Alignment(wrap_text=True, vertical="center")
        intro.row_dimensions[i].height = 32
    intro.column_dimensions["A"].width = 16
    intro.column_dimensions["B"].width = 88

    scale_rows = []
    for item in scales["militarization"]:
        scale_rows.append(["兵役", item["name"], item["standing"], "", item["summary"]])
    for item in scales["states"]:
        scale_rows.append(["国势", item["name"], "", item["levy"], item["summary"]])
    write_sheet(wb, "兵役与国势", ["类别", "名称", "常备占人口", "加征占人口", "说明"], scale_rows, [10, 10, 14, 14, 40])

    overview = []
    jun_rows = []
    xian_rows = []
    star_rows = []
    for country, root in zip(countries, roots):
        grade = grades[country["militarization"]]
        note = spec["blocs"][country["bloc"]]
        overview.append(row_of(country, root, grade, note))
        for node in walk(root):
            if node.kind == "国":
                continue
            record = row_of(country, node, grade, note)
            if node.kind in ("郡", "京畿"):
                jun_rows.append(record)
            else:
                xian_rows.append(record)
            if node.star:
                star_rows.append(record)
    write_sheet(wb, "国家总览", HEADERS, overview, WIDTHS)
    write_sheet(wb, "郡与京畿", HEADERS, jun_rows, WIDTHS)
    write_sheet(wb, "县与要塞", HEADERS, xian_rows, WIDTHS)
    write_sheet(wb, "明星聚集地", HEADERS, star_rows, WIDTHS)

    # 国家特征一览，方便对着表改 json。
    feat_headers = ["国家", "方位", "特征", "兵役", "常备", "国势", "人口密度系数", "富裕", "明星", "明星倍率", "要塞", "英雄"]
    feat_rows = []
    for country in countries:
        grade = grades[country["militarization"]]
        feat_rows.append([
            country["id"] + " " + country["name"], country["bloc"], country["trait"],
            grade["name"], grade["standing"], "随世界", country["popDensity"], country["wealth"],
            country["starTitle"], country["metricPeak"], country["forts"], country["hero"],
        ])
    write_sheet(wb, "国家特征", feat_headers, feat_rows, [14, 8, 42, 8, 10, 10, 16, 10, 12, 12, 8, 8])

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT_PATH)
    check(countries, roots, grades, states, spec)
    print("saved", OUT_PATH)


def sum_bloc(pairs, bloc, key):
    return sum(root.metrics[key] if key != "area" else root.area for country, root in pairs if country["bloc"] == bloc)


def check(countries, roots, grades, states, spec):
    pairs = list(zip(countries, roots))
    rates = []
    for country, root in pairs:
        pop = root.metrics["pop"]
        army = root.metrics["army"]
        rate = grades[country["militarization"]]["standing"]
        rates.append(rate)
        if abs(army / pop - rate) > 0.015:
            raise SystemExit("{0} 常备占比 {1:.3f}，应为 {2:.3f}".format(country["name"], army / pop, rate))
        if country["bloc"] == "中原" and abs(rate - 0.10) > 0.001:
            raise SystemExit("{0} 常备应为 10%".format(country["name"]))
        for node in walk(root):
            same = [k for k in getattr(node, "_siblings", []) if k.kind == node.kind]
            if len(same) < 2:
                continue
            metric = country["starMetrics"][0]
            values = [metric_value(k, metric) for k in same if metric_value(k, metric) > 0]
            areas = [k.area for k in same if k.area > 0]
            if values and max(values) / min(values) > spec["metricPeakMax"] + 0.35:
                raise SystemExit("{0} {1} 特色倍率超过 8".format(country["name"], node.name))
            if areas and max(areas) / min(areas) > spec["areaPeakMax"] + 0.4:
                raise SystemExit("{0} {1} 面积倍率超过 3".format(country["name"], node.name))
    ordered = sorted(rates)
    median = (ordered[4] + ordered[5]) / 2
    if abs(median - 0.10) > 0.001:
        raise SystemExit("常备中位数是 {0:.3f}，应为 0.10".format(median))

    pop_order = ["南方", "中原", "东方", "北方", "西方"]
    area_order = ["西方", "北方", "中原", "东方", "南方"]
    pops = [sum_bloc(pairs, name, "pop") for name in pop_order]
    areas = [sum_bloc(pairs, name, "area") for name in area_order]
    if pops != sorted(pops, reverse=True):
        raise SystemExit("人口顺序应为南方>中原>东方>北方>西方，现在 {0}".format(list(zip(pop_order, pops))))
    if areas != sorted(areas, reverse=True):
        raise SystemExit("面积顺序应为西方>北方>中原>东方>南方，现在 {0}".format(list(zip(area_order, areas))))
    if not 1.9 <= pops[0] / pops[-1] <= 2.1:
        raise SystemExit("南方人口 / 西方人口 = {0:.2f}，应约等于 2".format(pops[0] / pops[-1]))

    def bloc_total(name, key):
        return sum_bloc(pairs, name, key)

    if not (bloc_total("南方", "eco") > bloc_total("中原", "eco") > max(bloc_total(n, "eco") for n in ("东方", "北方", "西方"))):
        raise SystemExit("经济应为南方最高")
    if not (bloc_total("南方", "grain") > bloc_total("中原", "grain") > bloc_total("西方", "grain")):
        raise SystemExit("粮食应为南方多于中原，中原多于西方")
    if not (bloc_total("东方", "politics") > max(bloc_total(n, "politics") for n in ("南方", "中原", "北方", "西方"))):
        raise SystemExit("政治应为东方最高")
    if not (bloc_total("东方", "make") > max(bloc_total(n, "make") for n in ("南方", "中原", "北方", "西方"))):
        raise SystemExit("制造应为东方最高")
    if not (bloc_total("中原", "tech") > max(bloc_total(n, "tech") for n in ("南方", "东方", "北方", "西方"))):
        raise SystemExit("科技应为中原最高")
    if not (bloc_total("中原", "cul") > max(bloc_total(n, "cul") for n in ("南方", "东方", "北方", "西方"))):
        raise SystemExit("文化应为中原最高")
    if not (bloc_total("西方", "def") > bloc_total("北方", "def") > max(bloc_total(n, "def") for n in ("南方", "中原", "东方"))):
        raise SystemExit("城防应为西方最强，北方次之")
    if not (bloc_total("北方", "herd") > max(bloc_total(n, "herd") for n in ("南方", "中原", "东方", "西方"))):
        raise SystemExit("畜牧应为北方最高")
    if not (bloc_total("北方", "hero") > max(bloc_total(n, "hero") for n in ("南方", "中原", "东方", "西方"))):
        raise SystemExit("英雄应为北方最多")

    scores = {}
    for name in pop_order:
        scores[name] = sum(combat_score(root, country) for country, root in pairs if country["bloc"] == name)
    four = [scores[name] for name in ("南方", "东方", "北方", "西方")]
    # 四方允许约 18% 的起伏：人口和特长不同，综合仍算同一档。中原高出四方均值不超过约两成。
    if max(four) / min(four) > 1.18:
        raise SystemExit("四方综合战力差距过大：{0}".format({k: int(scores[k]) for k in ("南方", "东方", "北方", "西方")}))
    if not (scores["中原"] > max(four) and scores["中原"] / (sum(four) / 4) <= 1.22):
        raise SystemExit("中原综合应稍高于四方：{0}".format({k: int(v) for k, v in scores.items()}))
    print("check ok")
    for name in ("南方", "中原", "东方", "北方", "西方"):
        print("{0} 人口 {1:.2f}亿 面积 {2:.0f}万km2 综合 {3}".format(
            name, bloc_total(name, "pop") / 1e8, bloc_total(name, "area") / 1e4, int(scores[name])))


if __name__ == "__main__":
    main()
