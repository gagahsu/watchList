import requests
import re
import json

url = "https://www.wantgoo.com/stock/3481/dividend-policy/ex-dividend"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

r = requests.get(url, headers=headers)
html = r.text

# Look for JSON-like structures in scripts
# Many sites use window.__INITIAL_STATE__ or similar
matches = re.findall(r'\{.*\}', html)
for m in matches:
    if "2025" in m and "1.00" in m:
        print("Found possible data JSON!")
        print(m[:500])
        break
else:
    print("Not found via regex")
