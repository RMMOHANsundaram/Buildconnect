import React, { createContext, useContext, useEffect, useState } from "react";
import axios from "axios";

const ThemeContext = createContext();

export const useTheme = () => {
  return useContext(ThemeContext);
};

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "light");
  const [colorTheme, setColorTheme] = useState(localStorage.getItem("colorTheme") || "theme-orange");

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark", "theme-blue", "theme-green", "theme-purple", "theme-orange");
    root.classList.add(theme);
    root.classList.add(colorTheme);
    localStorage.setItem("theme", theme);
    localStorage.setItem("colorTheme", colorTheme);
  }, [theme, colorTheme]);

  const toggleTheme = async () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);

    const token = localStorage.getItem("token");
    if (token) {
      try {
        await axios.put(
          `${import.meta.env.VITE_API_URL || 'http://localhost:5000/api'}/users/profile`,
          { theme: newTheme },
          { headers: { Authorization: `Bearer ${token}` } }
        );
      } catch (error) {
        console.error("Failed to sync theme with server", error);
      }
    }
  };

  const setSystemTheme = (newTheme) => {
    setTheme(newTheme);
  };
  
  const changeColorTheme = (newColor) => {
    setColorTheme(newColor);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setSystemTheme, colorTheme, changeColorTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
