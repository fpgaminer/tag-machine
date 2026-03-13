import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactCompiler from "eslint-plugin-react-compiler";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default tseslint.config(
	{
		ignores: ["dist/**", "node_modules/**", "src/llama3Tokenizer.js", "src/llama3Tokenizer.d.ts"],
	},

	js.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	...tseslint.configs.stylisticTypeChecked,

	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: __dirname,
			},
		},
	},

	reactPlugin.configs.flat.recommended,
	reactPlugin.configs.flat["jsx-runtime"],

	{
		files: [
			"**/*.{js,jsx,mjs,cjs}",
			"eslint.config.mjs",
			"*.config.ts",
			"*.config.mts",
			"*.config.cts",
			"vite.config.ts",
		],
		extends: [tseslint.configs.disableTypeChecked],
	},

	{
		plugins: {
			"react-hooks": reactHooks,
			"react-compiler": reactCompiler,
		},
		rules: {
			...reactHooks.configs.recommended.rules,
		},
		settings: {
			react: {
				version: "detect",
			},
		},
	},

	{
		files: ["src/**/*.{ts,tsx}"],
		rules: {
			"react-compiler/react-compiler": "error",
			"@typescript-eslint/no-misused-promises": [
				"error",
				{
					checksVoidReturn: {
						arguments: false,
						attributes: false,
					},
				},
			],
		},
	},

	eslintPluginPrettierRecommended,
	{
		rules: {
			"prettier/prettier": "warn",
		},
	},
);
