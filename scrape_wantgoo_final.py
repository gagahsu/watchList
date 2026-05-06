import requests
import re
import json

def scrape_wantgoo_dividend(stock_id):
    url = f"https://www.wantgoo.com/stock/{stock_id}/dividend-policy/ex-dividend"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "max-age=0",
        "Connection": "keep-alive",
        "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1"
    }
    
    session = requests.Session()
    response = session.get(url, headers=headers)
    
    if response.status_code != 200:
        return {"error": f"HTTP {response.status_code}"}
        
    html = response.text
    
    # Try to find if data is in a script tag
    # Some WantGoo pages use a specific JSON format inside scripts
    # Let's look for a large array of objects
    data_match = re.search(r'\[\s*\{\s*"year":\s*\d+.*\}\s*\]', html, re.DOTALL)
    if data_match:
        try:
            return json.loads(data_match.group(0))
        except:
            pass
            
    # If not found, it might be the API
    # Testing the astock API again with session and referer
    api_url = f"https://www.wantgoo.com/stock/astock/dividend?stockNo={stock_id}"
    api_headers = headers.copy()
    api_headers["Referer"] = url
    api_headers["X-Requested-With"] = "XMLHttpRequest"
    
    api_response = session.get(api_url, headers=api_headers)
    if api_response.status_code == 200:
        return api_response.json()
        
    return {"error": "Data not found in HTML or API", "html_snippet": html[:500]}

if __name__ == "__main__":
    import sys
    stock_id = sys.argv[1] if len(sys.argv) > 1 else "3481"
    print(json.dumps(scrape_wantgoo_dividend(stock_id), indent=2, ensure_ascii=False))
