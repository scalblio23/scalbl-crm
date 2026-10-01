import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Libraries in their own files: they rarely change, so after a
        // deploy browsers keep them cached and only re-download the
        // app's own code.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](recharts|d3-|victory-vendor|decimal\.js-light|lodash|eventemitter3|react-smooth|recharts-scale)/.test(id)) return "charts";
          if (/[\\/]node_modules[\\/]@twilio[\\/]/.test(id)) return "twilio";
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return "icons";
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          return "vendor";
        },
      },
    },
  },
});
