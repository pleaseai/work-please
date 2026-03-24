export default defineNuxtConfig({
  extends: ['docus'],

  modules: [
    '@nuxt/eslint',
  ],

  // Disable Docus modules with h3 v2 RC incompatibilities
  mcp: {
    enabled: false,
  },
  ogImage: {
    enabled: false,
  },

  // Force SQLite database for Nuxt Content (avoids Cloudflare D1 detection)
  content: {
    database: {
      type: 'sqlite',
    },
  },

  routeRules: {
    '/__nuxt_content/**': { prerender: false },
  },

  site: {
    name: 'Agent Please',
  },

  nitro: {
    // Default to bun preset for local dev/build. Set NITRO_PRESET=cloudflare_pages
    // for deployment (requires h3 compatibility fixes — see Decision Log in plan.md).
    // eslint-disable-next-line node/prefer-global/process
    preset: globalThis.process?.env?.NITRO_PRESET || 'bun',
    prerender: {
      // Disable prerendering — h3 v2 RC compatibility issues with Docus
      // dependencies (nuxt-og-image, @nuxtjs/mcp-toolkit).
      routes: [],
      crawlLinks: false,
    },
  },

  // Workaround: Docus ships raw .ts server routes. Nitro's esbuild plugin
  // excludes node_modules, causing Rollup parse failures with Bun's
  // hoisted dependency paths. This hook pre-transpiles them before Rollup.
  hooks: {
    'nitro:init': function (nitro: { options: { rollupConfig: { plugins: unknown[] }, prerender: { routes: string[], crawlLinks: boolean, failOnError: boolean } } }) {
      // Override Docus prerender after all hooks have run
      nitro.options.prerender.routes = nitro.options.prerender.routes
        .filter((r: string) => !r.includes('__nuxt_content'))
      nitro.options.prerender.crawlLinks = false
      nitro.options.prerender.failOnError = false
    },
    'nitro:config': function (nitroConfig) {
      nitroConfig.rollupConfig = nitroConfig.rollupConfig || {}
      nitroConfig.rollupConfig.plugins = nitroConfig.rollupConfig.plugins || []

      const plugins = Array.isArray(nitroConfig.rollupConfig.plugins)
        ? nitroConfig.rollupConfig.plugins
        : [nitroConfig.rollupConfig.plugins]

      plugins.unshift({
        name: 'docus-ts-compat',
        async load(id: string) {
          if (id.includes('node_modules') && id.includes('docus') && id.endsWith('.ts')) {
            const fs = await import('node:fs')
            const esbuild = await import('esbuild')
            const code = fs.readFileSync(id, 'utf-8')
            const result = esbuild.transformSync(code, {
              loader: 'ts',
              target: 'esnext',
              format: 'esm',
            })
            let transformed = result.code
            // Inject Nuxt auto-import polyfills for app.config.ts
            if (id.includes('app.config')) {
              transformed = `const defineAppConfig = (c) => c;\n${transformed}`
            }
            return { code: transformed, map: null }
          }
          return null
        },
      })

      nitroConfig.rollupConfig.plugins = plugins

      // Override Docus layer's prerender settings
      nitroConfig.prerender = nitroConfig.prerender || {}
      nitroConfig.prerender.routes = []
      nitroConfig.prerender.crawlLinks = false
    },
  },

  eslint: {
    config: {
      standalone: false,
    },
  },

  compatibilityDate: '2026-03-24',
})
