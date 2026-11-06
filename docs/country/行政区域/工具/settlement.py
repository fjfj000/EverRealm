# -*- coding: utf-8 -*-
"""把国家特征里的 settlement 乘成郡、县、乡、村个数。

村数是玩法规模，不按国土面积除以固定村域。
四方落在 180–220，中原是 240 与 260。
"""


def totals(country):
    """县含京畿下的县，不含要塞。"""
    plan = country["settlement"]
    jun = int(plan["jun"])
    xian_per_jun = int(plan["xianPerJun"])
    capital_xian = int(plan["capitalXian"])
    xiang_per_xian = int(plan["xiangPerXian"])
    cun_per_xiang = int(plan["cunPerXiang"])
    xian = jun * xian_per_jun + capital_xian
    xiang = xian * xiang_per_xian
    cun = xiang * cun_per_xiang
    return {
        "jun": jun,
        "capital_xian": capital_xian,
        "xian_per_jun": xian_per_jun,
        "xiang_per_xian": xiang_per_xian,
        "cun_per_xiang": cun_per_xiang,
        "xian": xian,
        "xiang": xiang,
        "cun": cun,
    }
