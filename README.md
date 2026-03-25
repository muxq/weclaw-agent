# weclaw-agent
自建微信claw bot agent

A self-built WeChat claw (crawler) bot agent. Log in to WeChat Web via QR code and send crawl commands to fetch web content on demand.

## Features

- `/crawl <url>` – fetch and return the text content of any public URL
- `/links <url>` – list all hyperlinks found on a page
- `/help` – display available commands

Works in both private chats and group chats (mention the bot in a group).

## Requirements

- Python 3.10+
- Dependencies listed in `requirements.txt`

## Setup

```bash
pip install -r requirements.txt
```

Copy and edit the configuration file as needed:

```bash
cp config.yaml config.yaml  # already present; edit to taste
```

## Running

```bash
python main.py
```

Scan the QR code displayed in the terminal with WeChat to log in. The bot will start listening for commands.

## Configuration

Edit `config.yaml` to adjust crawler behaviour:

| Key | Default | Description |
|-----|---------|-------------|
| `crawler.timeout` | `10` | HTTP request timeout (seconds) |
| `crawler.max_text_length` | `1000` | Max characters returned by `/crawl` |
| `crawler.max_links` | `20` | Max links returned by `/links` |

## Testing

```bash
pip install pytest
pytest tests/
```
