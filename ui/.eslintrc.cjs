module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    parserOptions: {
        tsconfigRootDir: __dirname,
        project: ['./tsconfig.json'],
    },
    plugins: ['@typescript-eslint'],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:@typescript-eslint/recommended-requiring-type-checking',
        'plugin:react/recommended',
        'plugin:react/jsx-runtime',
        'plugin:react-hooks/recommended',
        'plugin:prettier/recommended',
    ],
    rules: {
        "@typescript-eslint/no-misused-promises": [
            "error",
            {
                "checksVoidReturn": {
                    "arguments": false,
                    "attributes": false,
                }
            }
        ]
    },
    settings: {
        react: {
            version: 'detect',
        },
    },
};