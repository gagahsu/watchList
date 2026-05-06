import requests

url = "https://www.wantgoo.com/stock/3481/dividend-policy/ex-dividend"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

r = requests.get(url, headers=headers)
html = r.text

if "ex-dividend.min.js" in html:
    print("Found script!")
    # Find the script tag
    start = html.find("ex-dividend.min.js")
    print(html[start-100:start+100])
else:
    print("Script not found")

# Search for any string that looks like an API call
import re
apis = re.findall(r'https?://[^\s"\']+', html)
for api in apis:
    if "dividend" in api:
        print(f"Found dividend related URL: {api}")
