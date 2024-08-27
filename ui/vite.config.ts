import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [react()],

	clearScreen: false,
	server: {
		port: 3000,
		strictPort: true,
		host: true,
	},
	build: {
		target: ["es2021", "chrome100", "safari13"],
		//minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
		//sourcemap: !!process.env.TAURI_DEBUG,
	},
});
