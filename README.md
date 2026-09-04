# ULTRADOT's HQ — Server Dashboard 🚀

A lightweight, zero-dependency Node.js server dashboard featuring a striking **Neobrutalism** design system. Built specifically to monitor self-hosted apps running on a VPS, displaying vital host metrics and application uptime statuses in real-time.

## Features ✨

- **Neobrutalism UI**: High-contrast colors, harsh solid shadows, thick borders, and aggressive typography (`Space Grotesk` & `JetBrains Mono`).
- **Zero External Dependencies**: Built entirely with Node.js built-in modules (`http`, `os`, `fs`, `child_process`).
- **Live System Metrics**: 
  - Tracks CPU load, Memory usage, and Storage capacity.
  - Generates sparkline history graphs directly on the client side.
  - Updates every 4 seconds.
- **App Status Monitor**: 
  - Built-in ping functionality to check the HTTP status of tracked apps.
  - Live "kotak-kotak" visual badges (`CHK`, `UP`, `DOWN`) updating every 60 seconds.
- **Real-Time Clock & Uptime**: Accurately tracks server time and uptime down to the second.

## Monitored Applications 🛠️

Currently configured to track the following services out of the box:
- **OpenClaw** (AI Gateway)
- **9router** (Load Balancer)
- **Uptime Kuma** (Monitoring)
- **Stirling-PDF** (PDF Toolset)

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