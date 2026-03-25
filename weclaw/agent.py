"""
Agent module for weclaw.
Handles WeChat message receiving/sending and dispatches crawl tasks.
"""

import logging
import re

import itchat
from itchat.content import TEXT

from .crawler import Crawler

logger = logging.getLogger(__name__)

# Commands the bot recognizes (case-insensitive)
CMD_CRAWL = re.compile(r"^/crawl\s+(https?://\S+)$", re.IGNORECASE)
CMD_LINKS = re.compile(r"^/links\s+(https?://\S+)$", re.IGNORECASE)
CMD_HELP = re.compile(r"^/help$", re.IGNORECASE)

HELP_TEXT = (
    "weclaw bot commands:\n"
    "/crawl <url>  - fetch and return the text content of a URL\n"
    "/links <url>  - list all links found on a URL\n"
    "/help         - show this help message"
)


class WeclawAgent:
    """WeChat claw bot agent.

    Logs in to WeChat Web, listens for text messages and responds to
    crawl commands.
    """

    def __init__(self, config: dict | None = None):
        self.config = config or {}
        timeout = self.config.get("crawler", {}).get("timeout", 10)
        self.crawler = Crawler(timeout=timeout)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self) -> None:
        """Start the WeChat bot and block until it exits."""
        itchat.auto_login(hotReload=True, enableCmdQR=2)

        @itchat.msg_register(TEXT)
        def _on_text(msg):
            self._handle_text(msg)

        @itchat.msg_register(TEXT, isGroupChat=True)
        def _on_group_text(msg):
            if msg.isAt:
                self._handle_text(msg)

        logger.info("weclaw agent started.")
        itchat.run(debug=False)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _handle_text(self, msg) -> None:
        """Dispatch incoming text messages to the appropriate handler."""
        text = msg.text.strip()
        reply = self._process_command(text)
        if reply:
            msg.reply(reply)

    def _process_command(self, text: str) -> str | None:
        """Parse a command string and return the reply, or None."""
        if CMD_HELP.match(text):
            return HELP_TEXT

        m = CMD_CRAWL.match(text)
        if m:
            url = m.group(1)
            return self._cmd_crawl(url)

        m = CMD_LINKS.match(text)
        if m:
            url = m.group(1)
            return self._cmd_links(url)

        return None

    def _cmd_crawl(self, url: str) -> str:
        """Handle /crawl command."""
        logger.info("Crawling %s", url)
        text = self.crawler.extract_text(url)
        if text is None:
            return f"Failed to fetch content from {url}"
        max_len = self.config.get("crawler", {}).get("max_text_length", 1000)
        if len(text) > max_len:
            text = text[:max_len] + "\n...(truncated)"
        return text

    def _cmd_links(self, url: str) -> str:
        """Handle /links command."""
        logger.info("Extracting links from %s", url)
        links = self.crawler.extract_links(url)
        if not links:
            return f"No links found on {url}"
        max_links = self.config.get("crawler", {}).get("max_links", 20)
        shown = links[:max_links]
        result = "\n".join(shown)
        if len(links) > max_links:
            result += f"\n...and {len(links) - max_links} more"
        return result
