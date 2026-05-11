import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Build a single self-contained IIFE that the host page can <script src> in.
// Output goes straight into the Next.js app's public/ so /widget.js is the
// canonical URL — no extra copy step needed.
//
// JSX is wired through tsconfig (jsx: react-jsx, jsxImportSource: preact),
// which both tsc and Vite/esbuild honor automatically.
export default defineConfig({
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    cssMinify: true,
    minify: 'oxc',
    sourcemap: false,
    emptyOutDir: false,
    outDir: resolve(__dirname, '../agent_desk_app/public'),
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'AgentDesk',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
    rollupOptions: {
      output: {
        // Inline CSS into the JS bundle — we mount inside Shadow DOM so we
        // need the styles available to inject as a <style> tag.
        inlineDynamicImports: true,
      },
    },
  },
});
