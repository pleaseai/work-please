import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'app',
  typescript: true,
  vue: true,
  stylistic: {
    indent: 2,
    quotes: 'single',
    semi: false,
  },
  ignores: [
    'dist',
    'node_modules',
    'src/components/ui/**',
  ],
})
