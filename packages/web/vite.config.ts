import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, proxy API calls to the Fastify server. The API binds API_HOST (the
// Tailscale address in this deployment, loopback by default), so the proxy
// target must match it rather than assuming localhost.
const target = `http://${process.env.API_HOST ?? "127.0.0.1"}:${process.env.API_PORT ?? 3000}`;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": target,
      "/health": target,
    },
  },
});
