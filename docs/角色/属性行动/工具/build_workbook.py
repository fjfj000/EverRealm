# -*- coding: utf-8 -*-
"""把输入目录的属性行动 JSON 写成产出目录的策划表。

列顺序和表顺序都读 JSON，编辑器里后加的列、后加的表也会导出。
不要手改产出的 xlsx，下次生成会盖掉。
"""
import json
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parents[1]
INPUT_PATH = ROOT / "输入" / "属性行动.json"
OUTPUT_PATH = ROOT / "产出" / "属性行动.xlsx"

INK = "1F2A36"
TITLE_FILL = "28333E"
ALT_FILL = "F7F4EE"
LINE = "C7D0D8"
ZH_FONT = "微软雅黑"
WIDE_COLUMNS = {
    "动作限制", "约束与失败", "收益方式", "说明", "备注", "加成内容",
    "练习限制", "进入条件", "掉档", "用在哪里", "每点加成", "规则",
}

thin = Side(style="thin", color=LINE)
border_all = Border(left=thin, right=thin, top=thin, bottom=thin)

# 阶段只是归类。真正缺了名字或编号，才拒绝写出半张表。
REQUIRED_NAME = {
    "行动": "行动名称",
    "技能": "技能名称",
    "阶段": "名称",
}


def load_doc(path=None):
    source = Path(path) if path else INPUT_PATH
    with source.open(encoding="utf-8") as handle:
        return json.load(handle)


def validate(doc):
    """结构不完整就返回错误列表。平衡数字未定不算错误。"""
    errors = []
    if not isinstance(doc, dict):
        return ["根必须是对象"]
    order = doc.get("表顺序")
    tables = doc.get("表")
    if not isinstance(order, list) or not order:
        errors.append("缺少表顺序")
    if not isinstance(tables, dict):
        errors.append("缺少表")
        return errors
    if not isinstance(doc.get("说明"), list):
        errors.append("说明必须是段落列表")
    if not isinstance(doc.get("经验曲线"), dict):
        errors.append("经验曲线必须是对象")
    names = list(order) if isinstance(order, list) else []
    for name in tables:
        if name not in names:
            names.append(name)
    for name in names:
        table = tables.get(name)
        if not isinstance(table, dict):
            errors.append(f"缺少表：{name}")
            continue
        columns = table.get("列")
        rows = table.get("行")
        if not isinstance(columns, list) or not columns or not all(
            isinstance(item, str) and item for item in columns
        ):
            errors.append(f"{name} 的列不正确")
            columns = []
        if not isinstance(rows, list):
            errors.append(f"{name} 的行不正确")
            continue
        id_key = "编号" if "编号" in columns else None
        seen = set()
        name_key = REQUIRED_NAME.get(name)
        for index, row in enumerate(rows, start=1):
            if not isinstance(row, dict):
                errors.append(f"{name} 第 {index} 行不是对象")
                continue
            if name_key and not str(row.get(name_key, "")).strip():
                errors.append(f"{name} 第 {index} 行缺少{name_key}")
            if id_key:
                row_id = str(row.get(id_key, "")).strip()
                if not row_id:
                    errors.append(f"{name} 第 {index} 行缺少编号")
                elif row_id in seen:
                    errors.append(f"{name} 编号重复：{row_id}")
                else:
                    seen.add(row_id)
    return errors


def warn_design(doc):
    """阶段写错、原表条目丢了，只警告，不挡住保存。"""
    tables = doc.get("表") or {}
    stages = {
        str(row.get("编号", "")).strip()
        for row in (tables.get("阶段") or {}).get("行") or []
        if isinstance(row, dict)
    }
    warnings = []
    for index, row in enumerate((tables.get("行动") or {}).get("行") or [], start=1):
        if not isinstance(row, dict):
            continue
        stage = str(row.get("阶段", "")).strip()
        if stage and stage not in stages:
            warnings.append(f"行动第 {index} 行的阶段不在阶段表里：{stage}")
    originals = [
        "种田", "开荒", "跑腿", "走镖", "打劫", "买卖", "经商",
        "桩功", "奔袭", "治学", "观摩", "冥想", "药浴", "求学", "游历",
        "比武", "论道", "宴会", "捐助",
        "吏部", "户部", "礼部", "兵部", "刑部", "工部",
        "剿匪", "攻城", "布防", "宣战",
    ]
    names = {
        str(row.get("行动名称", "")).strip()
        for row in (tables.get("行动") or {}).get("行") or []
        if isinstance(row, dict)
    }
    for name in originals:
        if name not in names:
            warnings.append(f"原表行动缺失：{name}")
    skill_names = {
        str(row.get("技能名称", "")).strip()
        for row in (tables.get("技能") or {}).get("行") or []
        if isinstance(row, dict)
    }
    for name in ["桩功", "跑步", "闪身步", "闪电五连鞭", "射箭", "药浴", "摔跤", "混元太极", "观摩", "冥想", "写生", "锻造"]:
        if name not in skill_names:
            warnings.append(f"原表技能缺失：{name}")
    return warnings


def style_cell(cell, bold=False, size=10, color=INK, fill=None, align="center", wrap=False):
    cell.font = Font(name=ZH_FONT, bold=bold, size=size, color=color)
    if fill:
        cell.fill = PatternFill("solid", fgColor=fill)
    cell.alignment = Alignment(horizontal=align, vertical="center", wrap_text=wrap)
    cell.border = border_all


def apply_list_validation(ws, col_idx, options):
    """给阶段、分类等短列加下拉，方便在 Excel 里改。"""
    if not options or ws.max_row < 2:
        return
    formula = '"' + ",".join(options) + '"'
    # Excel 下拉公式有长度限制，过长的列不加。
    if len(formula) > 240:
        return
    letter = get_column_letter(col_idx)
    validation = DataValidation(type="list", formula1=formula, allow_blank=True)
    validation.error = "请从列表里选"
    validation.errorTitle = "不在候选项里"
    ws.add_data_validation(validation)
    validation.add(f"{letter}2:{letter}{ws.max_row}")


def write_table_sheet(wb, title, columns, rows):
    ws = wb.create_sheet(title)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(columns))}{max(1, len(rows) + 1)}"
    ws.sheet_properties.tabColor = "B3402A"
    for col_idx, name in enumerate(columns, start=1):
        cell = ws.cell(1, col_idx, name)
        style_cell(cell, bold=True, size=10, color="FFFFFF", fill=TITLE_FILL, wrap=True)
        width = 42 if name in WIDE_COLUMNS else 16
        if name in ("编号", "阶段", "来源", "重心", "玩家操控", "开启方式"):
            width = 14
        if name in ("行动名称", "技能名称", "名称"):
            width = 18
        ws.column_dimensions[get_column_letter(col_idx)].width = width
    for row_idx, row in enumerate(rows, start=2):
        values = [row.get(name, "") if isinstance(row, dict) else "" for name in columns]
        longest = max((len(str(value)) for value in values), default=0)
        ws.row_dimensions[row_idx].height = 36 if longest > 36 else 22
        fill = ALT_FILL if row_idx % 2 == 0 else None
        for col_idx, value in enumerate(values, start=1):
            cell = ws.cell(row_idx, col_idx, value)
            align = "left" if columns[col_idx - 1] in WIDE_COLUMNS else "center"
            style_cell(cell, fill=fill, align=align, wrap=True)
    # 短枚举列加下拉。句子里带逗号的列会撑破 Excel 列表公式，跳过。
    for col_idx, name in enumerate(columns, start=1):
        if name not in {"阶段", "分类", "重心", "来源", "秘籍类别", "加成方式", "程度"}:
            continue
        options = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            value = str(row.get(name, "")).strip()
            if value and value not in options:
                options.append(value)
        if any("," in item or "，" in item or len(item) > 12 for item in options):
            continue
        apply_list_validation(ws, col_idx, options)
    return ws


def write_notes(wb, paragraphs):
    ws = wb.create_sheet("说明", 0)
    ws.sheet_properties.tabColor = "3F6B52"
    title = ws.cell(1, 1, "说明")
    style_cell(title, bold=True, size=12, color="FFFFFF", fill=TITLE_FILL, align="left")
    ws.column_dimensions["A"].width = 120
    for index, paragraph in enumerate(paragraphs, start=2):
        cell = ws.cell(index, 1, paragraph)
        style_cell(cell, align="left", wrap=True)
        ws.row_dimensions[index].height = 36
    ws.row_dimensions[1].height = 24
    return ws


def write_curve(wb, curve):
    ws = wb.create_sheet("经验曲线", 1)
    ws.sheet_properties.tabColor = "93772F"
    ws.freeze_panes = "A2"
    for col_idx, name in enumerate(("字段", "值"), start=1):
        cell = ws.cell(1, col_idx, name)
        style_cell(cell, bold=True, size=10, color="FFFFFF", fill=TITLE_FILL)
    ws.column_dimensions["A"].width = 18
    ws.column_dimensions["B"].width = 88
    for row_idx, (key, value) in enumerate(curve.items(), start=2):
        key_cell = ws.cell(row_idx, 1, key)
        value_cell = ws.cell(row_idx, 2, value)
        style_cell(key_cell, align="center")
        style_cell(value_cell, align="left", wrap=True)
        ws.row_dimensions[row_idx].height = 32
    return ws


def table_order(doc):
    order = list(doc.get("表顺序") or [])
    for name in doc.get("表") or {}:
        if name not in order:
            order.append(name)
    return order


def build(doc, out_path=None):
    errors = validate(doc)
    if errors:
        raise ValueError("\n".join(errors))
    target = Path(out_path) if out_path else OUTPUT_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    wb = Workbook()
    default = wb.active
    wb.remove(default)
    write_notes(wb, doc.get("说明") or [])
    write_curve(wb, doc.get("经验曲线") or {})
    tables = doc["表"]
    for name in table_order(doc):
        table = tables[name]
        write_table_sheet(wb, name, table["列"], table["行"])
    # 先写临时文件再替换，避免写到一半把旧表盖坏。
    temporary = target.with_suffix(".xlsx.tmp")
    wb.save(temporary)
    temporary.replace(target)
    return target


def main():
    doc = load_doc()
    for warning in warn_design(doc):
        print("警告：", warning)
    target = build(doc)
    tables = doc["表"]
    actions = tables["行动"]["行"]
    print(f"已写出 {target}")
    print(f"行动 {len(actions)} 条，技能 {len(tables['技能']['行'])} 条")
    for stage in tables["阶段"]["行"]:
        count = sum(1 for row in actions if row.get("阶段") == stage["编号"])
        print(f"  {stage['编号']} {stage['名称']} {count}")


if __name__ == "__main__":
    main()
