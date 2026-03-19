export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/eslint', '@vueuse/nuxt'],

  eslint: {
    config: {
      standalone: false,
    },
  },

  future: {
    compatibilityVersion: 4,
  },

  css: ['~/assets/css/main.css'],

  nitro: {
    preset: 'bun',
  },

  runtimeConfig: {
    workflowPath: '',
  },

  compatibilityDate: '2026-03-19',
})
