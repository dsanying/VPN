import { defineConfig } from 'eslint/config';
import javascript from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import refresh from 'eslint-plugin-react-refresh';
import environment from 'globals';

const unusedOptions = Object.fromEntries(
  ['args', 'vars', 'caughtErrors', 'destructuredArray'].map((kind) => [`${kind}IgnorePattern`, '^_']),
);
const applicationRules = {
  'no-unused-vars': 'off', // TypeScript's rule also checks type positions.
  '@typescript-eslint/no-unused-vars': ['error', unusedOptions],
  '@typescript-eslint/no-explicit-any': 'off', // Existing runtime payload boundaries validate unknown data.
};

export default defineConfig(
  { ignores: ['dist/**', '.playwright/**', 'node_modules/**'] },
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [javascript.configs.recommended, ts.configs.recommended, hooks.configs.flat.recommended, refresh.configs.vite],
    languageOptions: { globals: environment.browser, ecmaVersion: 2020 },
    rules: applicationRules,
  },
);
