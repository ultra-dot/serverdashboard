# ULTRADOT's HQ — Server Dashboard 🚀

A lightweight, zero-dependency Node.js server dashboard featuring a striking **Neobrutalism** design system. Built specifically to monitor self-hosted apps running on a VPS, displaying vital host metrics and application uptime statuses in real-time.

## Features ✨

- **Neobrutalism UI**: High-contrast colors, harsh solid shadows, thick borders, and aggressive typography (`Space Grotesk` & `JetBrains Mono`).
- **Zero External Dependencies**: Built entirely with Node.js built-in modules (`http`, `os`, `fs`, `child_process`, `crypto`).
- **Settings & Service Controller (Top-Right)**:
  - Protected with built-in **Authentication Middleware** (session cookies via native `crypto`).
  - Controls VPS services and Docker containers: **Start**, **Stop**, and **Restart** directly from the UI.
  - Automatically queries live service status via `systemctl --user is-active` and `docker inspect`.
- **Live System Metrics**: 
  - Tracks CPU load, Memory usage, Storage capacity, and Power draw (Watts).
  - Automatically reads Intel RAPL / hwmon sensors with smart dynamic VPS power modeling.
  - Generates sparkline history graphs directly on the client side.
  - Updates every 4 seconds.
- **App Status Monitor**: 
  - Built-in ping functionality to check the HTTP status of tracked apps.
  - Live visual heartbeat history badges (`CHK`, `UP`, `DOWN`) updating every 60 seconds.
- **Real-Time Clock & Uptime**: Accurately tracks server time and uptime down to the second.

- **Navidrome & Quick Grab FLAC Downloader**:
  - Integrated Navidrome music server management.
  - Interactive Modal for downloading FLAC lossless music (1411kbps) via `grab-music` and `grab-parallel`.
  - Supports single link and batch multiple links (paste one link per line).
  - Real-time terminal log viewer inside modal and auto-restart/scan for Navidrome.
- **Monitored & Managed Services**:
  - Managed via `services.json`.
  - **Systemd User Services**: `it-tools.service` (port 9000), `stirling-pdf.service` (port 8080), `uptime-kuma.service` (port 3001), `dashboard-web.service` (port 8000), `openclaw-gateway.service`.
  - **Docker Containers**: `metube` (port 8081), `portainer` (port 9000/9443), `navidrome` (port 4533).

## Installation & Usage 💻

Since there are no external dependencies (`package.json`, `npm install`), you can run it instantly on any machine with Node.js installed.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ultra-dot/serverdashboard.git
   cd serverdashboard
   ```

2. **Run the server:**
   ```bash
   node server.js
   ```
   *(Or use PM2 to run it in the background: `pm2 start server.js --name "serverdashboard"`)*

3. **View the dashboard:**
   Open your browser and navigate to `http://localhost:8000` (or your server's IP address on port `8000`).

## Customization 🎨

- **Adding New Apps**: Open `index.html` and duplicate one of the `.card` elements. Ensure you set the `href` and the `data-url` attribute inside `.app-status` so the backend knows where to ping.
- **Styling**: All Neobrutalist design tokens (colors, borders, typography) are completely modular and located in `style.css`.
- **Port Settings**: You can change the port by modifying `const PORT = 8000;` inside `server.js`.

## License 📜

MIT License. Do whatever you want with it!