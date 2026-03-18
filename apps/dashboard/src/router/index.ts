import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: () => import('@/pages/DashboardPage.vue'),
    },
    {
      path: '/issues/:identifier',
      name: 'issue',
      component: () => import('@/pages/IssuePage.vue'),
    },
    {
      path: '/sessions/:id',
      name: 'session',
      component: () => import('@/pages/SessionPage.vue'),
    },
  ],
})

export default router
