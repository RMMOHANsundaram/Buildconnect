import { useEffect, useState } from "react";

// Lightweight, dependency-free "Saved items" store backed by localStorage.
// Items can be services or packages; only the display fields we need are kept.
const STORAGE_KEY = "buildconnect_saved";
const EVENT_NAME = "buildconnect:saved";

const read = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const write = (items) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable (private mode, quota) — fail quietly */
  }
  window.dispatchEvent(new Event(EVENT_NAME));
};

export const getSaved = read;

export const isSaved = (id) => read().some((item) => item.id === id);

export const toggleSaved = (item) => {
  if (!item?.id) return false;
  const list = read();
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index >= 0) {
    list.splice(index, 1);
    write(list);
    return false;
  }
  write([{ ...item, savedAt: Date.now() }, ...list]);
  return true;
};

export const removeSaved = (id) => write(read().filter((entry) => entry.id !== id));

export const clearSaved = () => write([]);

export function useSaved() {
  const [items, setItems] = useState(read);

  useEffect(() => {
    const sync = () => setItems(read());
    window.addEventListener(EVENT_NAME, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT_NAME, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return {
    items,
    count: items.length,
    isSaved: (id) => items.some((entry) => entry.id === id),
    toggle: toggleSaved,
    remove: removeSaved,
    clear: clearSaved,
  };
}
