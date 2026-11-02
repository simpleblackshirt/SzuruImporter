import type { App } from "vue";
import { createPinia } from "pinia";

export function setupPinia(app: App) {
  const pinia = createPinia();
  app.use(pinia);
}

export function setupApp(app: App) {
  setupPinia(app);
}
