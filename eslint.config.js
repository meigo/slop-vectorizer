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
    // Components stay covered by svelte-check (npm run check), matching slop-paint.
    ignores: ['dist/', '**/*.svelte', 'docs/', '.claude/', '.superpowers/'],
  }
)
