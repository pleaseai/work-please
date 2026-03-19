export default defineNuxtConfig({
  modules: ['@nuxt/ui'],

  future: {
    compatibilityVersion: 4,
  },

  css: ['~/assets/css/main.css'],

  nitro: {
    preset: 'bun',
  },

  runtimeConfig: {
    workflowPath: process.env.WORKFLOW_PATH || '',
  },

  compatibilityDate: '2026-03-19',
})
