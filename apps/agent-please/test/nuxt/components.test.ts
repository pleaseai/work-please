import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import StateBadge from '~/components/StateBadge.vue'

describe('stateBadge', () => {
  it('renders the state text', async () => {
    const wrapper = await mountSuspended(StateBadge, {
      props: { state: 'running' },
    })
    expect(wrapper.text()).toContain('running')
  })
})
