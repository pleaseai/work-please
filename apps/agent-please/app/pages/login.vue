<script setup lang="ts">
import { authClient } from '~/lib/auth-client'

definePageMeta({
  layout: false,
})

const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function signInWithGitHub() {
  loading.value = true
  error.value = ''
  try {
    await authClient.signIn.social({
      provider: 'github',
      callbackURL: '/',
    })
  }
  catch (err: any) {
    error.value = err.message || 'GitHub sign-in failed'
    loading.value = false
  }
}

async function signInWithUsername() {
  if (!username.value || !password.value) {
    error.value = 'Username and password are required'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const result = await authClient.signIn.username({
      username: username.value,
      password: password.value,
    })
    if (result.error) {
      error.value = result.error.message || 'Invalid credentials'
      loading.value = false
      return
    }
    await navigateTo('/')
  }
  catch (err: any) {
    error.value = err.message || 'Sign-in failed'
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
    <div class="w-full max-w-sm space-y-6 p-6">
      <div class="text-center">
        <h1 class="text-2xl font-bold">
          Agent Please
        </h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Sign in to access the dashboard
        </p>
      </div>

      <UAlert
        v-if="error"
        color="error"
        :title="error"
      />

      <UButton
        block
        size="lg"
        color="neutral"
        variant="outline"
        icon="i-lucide-github"
        :loading="loading"
        @click="signInWithGitHub"
      >
        Sign in with GitHub
      </UButton>

      <USeparator label="or" />

      <form class="space-y-4" @submit.prevent="signInWithUsername">
        <UFormField label="Username">
          <UInput
            v-model="username"
            placeholder="admin"
            autocomplete="username"
          />
        </UFormField>

        <UFormField label="Password">
          <UInput
            v-model="password"
            type="password"
            placeholder="Password"
            autocomplete="current-password"
          />
        </UFormField>

        <UButton
          block
          size="lg"
          type="submit"
          :loading="loading"
        >
          Sign in
        </UButton>
      </form>
    </div>
  </div>
</template>
