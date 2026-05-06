import requests
from bs4 import BeautifulSoup
import json
import sys

def scrape_dividend(stock_id):
    url = f"https://www.wantgoo.com/stock/{stock_id}/dividend-policy/ex-dividend"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        table = soup.find('table', id='dividend')
        
        if not table:
            return {"error": "Could not find dividend table"}
        
        # Get headers
        thead = table.find('thead')
        headers = []
        if thead:
            # Handle multi-row headers
            rows = thead.find_all('tr')
            if len(rows) > 1:
                # This is a bit complex due to colspan/rowspan
                # For simplicity, let's use the second row or combine them
                # But looking at the table structure, it's better to just hardcode or map them
                # Let's try to extract them dynamically
                h_row1 = [th.get_text(strip=True) for th in rows[0].find_all('th')]
                h_row2 = [th.get_text(strip=True) for th in rows[1].find_all('th')]
                
                # Manual mapping based on known structure
                headers = [
                    "除權息年度", 
                    "現金股利", "除息日", "發放日", "除息前股價", "填息天數", "年股利", "年殖利率",
                    "股票股利", "除權日", "除權前股價", "填權天數"
                ]
            else:
                headers = [th.get_text(strip=True) for th in rows[0].find_all('th')]
        
        # Get data
        tbody = table.find('tbody')
        data = []
        if tbody:
            for tr in tbody.find_all('tr'):
                cols = tr.find_all(['td', 'th'])
                if len(cols) == len(headers):
                    row_data = {}
                    for i in range(len(headers)):
                        row_data[headers[i]] = cols[i].get_text(strip=True)
                    data.append(row_data)
        
        return data

    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    stock_id = sys.argv[1] if len(sys.argv) > 1 else "3481"
    result = scrape_dividend(stock_id)
    print(json.dumps(result, indent=2, ensure_ascii=False))
