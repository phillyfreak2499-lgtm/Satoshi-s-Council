def coinbase_product_for_symbol(symbol=None):
    raw = str(symbol or "").upper()
    if "ETH" in raw:
        return "ETH-USD"
    return "BTC-USD"


def spot_source_from_base(base=None):
    return "binance"
