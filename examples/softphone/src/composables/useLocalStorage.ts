import { ref, watch, type Ref } from "vue";

export function useLocalStorage<T>(key: string, defaultValue: T): Ref<T> {
  const state = ref(defaultValue) as Ref<T>;

  try {
    const raw = localStorage.getItem(key);
    if (raw) state.value = JSON.parse(raw) as T;
  } catch {
    state.value = defaultValue;
  }

  watch(
    state,
    value => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {}
    },
    { deep: true }
  );

  return state;
}
