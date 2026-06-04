"""Run this to serve the app locally: python serve.py"""
import http.server, socketserver, os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

PORT = 8081
handler = http.server.SimpleHTTPRequestHandler
handler.extensions_map.update({'.js': 'application/javascript', '.wav': 'audio/wav'})

with socketserver.TCPServer(("", PORT), handler) as httpd:
    print(f"Serving at http://localhost:{PORT}")
    print("Open that URL in Chrome or Edge (camera + audio required)")
    print("Ctrl+C to stop")
    httpd.serve_forever()
