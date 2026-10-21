/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves a project site from /<repository>/, so the deploy workflow sets
  // BASE_PATH to that (from actions/configure-pages). Locally the app is served from /.
  base: process.env.BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Randomized tests compare against slow reference implementations (Floyd-Warshall, brute
    // force) and take a few seconds each, so the 5 s default is too tight on slower machines.
    testTimeout: 20_000,
  },
})
