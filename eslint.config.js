import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Only relevant with React Compiler, which this project doesn't use.
      'react-hooks/incompatible-library': 'off',
    },
  },
);
