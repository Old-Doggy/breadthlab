from pipeline.sources.akshare_fallback import _rate, _round2, _ts_code


def test_ts_code_suffix():
    assert _ts_code("600519") == "600519.SH"
    assert _ts_code("688981") == "688981.SH"
    assert _ts_code("000001") == "000001.SZ"
    assert _ts_code("300750") == "300750.SZ"
    assert _ts_code("920157") == "920157.BJ"


def test_limit_rate_by_board():
    assert _rate("600519.SH", "贵州茅台") == 0.10
    assert _rate("300750.SZ", "宁德时代") == 0.20
    assert _rate("688981.SH", "中芯国际") == 0.20
    assert _rate("600519.SH", "ST茅台") == 0.05
    assert _rate("920157.BJ", "宇特光电") == 0.30


def test_round_half_up():
    assert _round2(10.005) == 10.01
    assert _round2(9.994) == 9.99
