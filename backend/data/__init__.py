"""Live market data package. Do not gitignore this folder — `/data/` is runtime only."""
from backend.data.pipeline import DataPipeline

__all__ = ["DataPipeline"]
