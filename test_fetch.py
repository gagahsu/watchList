import urllib.request

url = "https://www.wantgoo.com/stock/3481/dividend-policy/ex-dividend"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req) as response:
        html = response.read().decode('utf-8')
        print(html[:2000]) # Print first 2000 chars
        print("..." )
        print(html[-2000:]) # Print last 2000 chars
        if "tbody" in html:
            print("\nFound tbody in HTML")
        else:
            print("\nNo tbody found in HTML")
except Exception as e:
    print(f"Error: {e}")
