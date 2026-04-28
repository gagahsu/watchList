"""啟動 WatchList 後端伺服器。開啟瀏覽器前往 http://localhost:8000"""
import subprocess, sys, os

os.chdir(os.path.join(os.path.dirname(__file__), "backend"))
subprocess.run([sys.executable, "-m", "uvicorn", "main:app", "--reload", "--host", "0.0.0.0", "--port", "8000"])
