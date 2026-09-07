import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-constant-condition': 'warn',
      'prefer-const': 'warn',
    },
  },
  prettier,
  {
    // The icon generator is the only Node-side code here; the rest of the project is browser-only,
    // so the globals are declared for tools/ rather than switched on repo-wide.
    files: ['tools/**/*.mjs'],
    languageOptions: { globals: { Buffer: 'readonly', console: 'readonly' } },
  },
  {
    // Components stay covered by svelte-check (npm run check), matching slop-paint.
    ignores: ['dist/', '**/*.svelte', 'docs/', '.claude/', '.superpowers/'],
  },
)
