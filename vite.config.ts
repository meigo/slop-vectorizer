/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  // Project pages serve from /slop-vectorizer/; local dev/preview stay at /.
  base: process.env.GHPAGES ? '/slop-vectorizer/' : '/',
  plugins: [svelte()],
  test: { include: ['tests/**/*.test.ts'] },
})
