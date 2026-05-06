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
        if "tbody" in html:
            start = html.find("<tbody")
            end = html.find("</tbody>", start) + 8
            print(html[start:end])
        else:
            print("No tbody found")
except Exception as e:
    print(f"Error: {e}")
