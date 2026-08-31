import urllib.request
import os

base_dir = "/Users/wangyanan/Projects2/chrome_extensions/job-scraper/libs"
os.makedirs(base_dir, exist_ok=True)

files = {
    "vue.global.js": "https://unpkg.com/vue@3.4.15/dist/vue.global.js",
    "element-plus.js": "https://unpkg.com/element-plus@2.5.3/dist/index.full.min.js",
    "element-plus.css": "https://unpkg.com/element-plus@2.5.3/dist/index.css"
}

for name, url in files.items():
    print(f"Downloading {name} from {url}...")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response, open(os.path.join(base_dir, name), 'wb') as out_file:
            data = response.read()
            out_file.write(data)
            print(f"Success: {name} ({len(data)} bytes)")
    except Exception as e:
        print(f"Failed to download {name}: {e}")
