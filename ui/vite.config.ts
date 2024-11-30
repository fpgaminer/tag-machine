import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
	return {
		base: mode === "development" ? "/dev/" : "/", // Dynamically set base path based on environment

		plugins: [react()],

		clearScreen: false,
		server: {
			port: 3000,
			strictPort: true,
			host: true,
		},
		build: {
			//target: ["es2021", "chrome100", "safari14"],
			//minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
			//sourcemap: !!process.env.TAURI_DEBUG,
		},
		esbuild: {
			supported: {
				'top-level-await': true,
			}
		},
	};
});
