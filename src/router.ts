import { createRouter, createWebHashHistory } from 'vue-router'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: () => import('@/views/LibraryView.vue') },
    { path: '/editor/:id?', component: () => import('@/views/EditorView.vue') },
    { path: '/chat/:id', component: () => import('@/views/ChatView.vue') },
    { path: '/novel-to-worldbook', component: () => import('@/views/NovelView.vue') },
    { path: '/agent/:id', component: () => import('@/views/AgentView.vue') },
    { path: '/settings', component: () => import('@/views/SettingsView.vue') },
  ],
})
