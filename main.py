"""Entry point for the weclaw WeChat claw bot agent."""

import logging
import os

import yaml

from weclaw import WeclawAgent

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


def load_config(path: str = "config.yaml") -> dict:
    """Load configuration from a YAML file.

    Args:
        path: Path to the configuration file.

    Returns:
        Parsed configuration dictionary, or an empty dict if the file is
        not found.
    """
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


if __name__ == "__main__":
    config = load_config()
    agent = WeclawAgent(config=config)
    agent.run()
