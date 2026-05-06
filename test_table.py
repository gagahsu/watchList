import urllib.request
import re

url = "https://www.wantgoo.com/stock/3481/dividend-policy/ex-dividend"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req) as response:
        html = response.read().decode('utf-8')
        # Find the table part
        match = re.search(r'<table.*?>.*?</table>', html, re.DOTALL | re.IGNORECASE)
        if match:
            print("Found table!")
            # Print a bit of the table to see classes/ids
            print(match.group(0)[:1000])
        else:
            print("Table not found")
except Exception as e:
    print(f"Error: {e}")
