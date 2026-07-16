"use client";

import { useEffect, useState } from "react";

export function useTheme() {
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem("paralog-theme");
    setDark(savedTheme === "dark" || (!savedTheme && matchMedia("(prefers-color-scheme: dark)").matches));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("paralog-theme", dark ? "dark" : "light");
  }, [dark, ready]);

  return { dark, setDark };
}
