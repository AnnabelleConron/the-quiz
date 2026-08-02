// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  // Set this to the production URL once the Cloudflare Pages domain exists.
  // It is used for canonical URLs and Open Graph tags.
  site: 'https://the-quizz.pages.dev',
});
