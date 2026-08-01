from dotenv import load_dotenv
import os, math, json, requests # type: ignore
from anthropic import Anthropic # type: ignore
from pathlib import Path

load_dotenv()
anthropic = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))