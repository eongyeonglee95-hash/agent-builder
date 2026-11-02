"""Read-only display projection. Never exposes account files or holdings."""
from pathlib import Path
from typing import Annotated, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

AssetClass = Literal["stock", "long_bond", "mid_bond", "gold", "commodity", "cash"]
Weight = Annotated[float, Field(ge=0, le=100, allow_inf_nan=False, strict=True)]
RULES_DIR = Path(__file__).resolve().parents[1] / "rules"


class Example(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assetClass: AssetClass
    name: str | None
    ticker: str | None


class StrategyDisplay(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    targets: dict[AssetClass, Weight]
    labels: dict[AssetClass, str]
    threshold: Annotated[float, Field(gt=0, le=100, allow_inf_nan=False)]
    examples: list[Example]

    @model_validator(mode="after")
    def validate_sum(self):
        if self.targets and abs(sum(self.targets.values()) - 100) > 0.001:
            raise ValueError("Strategy weights must total 100")
        return self


def load_strategy_display() -> list[StrategyDisplay]:
    # Explicit allowlist: there is no user-controlled file/path parameter.
    strategies = yaml.safe_load((RULES_DIR / "strategies.yaml").read_text())[
        "strategies"
    ]
    defaults = yaml.safe_load((RULES_DIR / "asset_map.yaml").read_text()).get(
        "class_defaults", {}
    )
    result = []
    for key, strategy in strategies.items():
        if key == "custom":
            continue
        examples = []
        for asset_class in strategy["targets"]:
            instrument = strategy.get("instruments", {}).get(
                asset_class, defaults.get(asset_class, {})
            )
            examples.append(Example(
                assetClass=asset_class,
                name=instrument.get("name"),
                ticker=instrument.get("ticker"),
            ))
        result.append(StrategyDisplay(
            id=key, name=strategy["name"], targets=strategy["targets"],
            labels=strategy.get("labels", {}), threshold=strategy["threshold_pp"],
            examples=examples,
        ))
    return result
