import React, { useState, useEffect, useRef } from "react";

const LANGUAGES = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "hi", name: "हिन्दी (Hindi)", flag: "🇮🇳" },
  { code: "ta", name: "தமிழ் (Tamil)", flag: "🇮🇳" },
  { code: "te", name: "తెలుగు (Telugu)", flag: "🇮🇳" },
  { code: "kn", name: "ಕನ್ನಡ (Kannada)", flag: "🇮🇳" },
  { code: "ml", name: "മലയാളം (Malayalam)", flag: "🇮🇳" },
  { code: "mr", name: "मराठी (Marathi)", flag: "🇮🇳" },
  { code: "bn", name: "বাংলা (Bengali)", flag: "🇮🇳" },
  { code: "gu", name: "ગુજરાતી (Gujarati)", flag: "🇮🇳" },
  { code: "pa", name: "ਪੰਜਾਬੀ (Punjabi)", flag: "🇮🇳" },
  { code: "ur", name: "اردو (Urdu)", flag: "🇵🇰" },
  { code: "es", name: "Español (Spanish)", flag: "🇪🇸" },
  { code: "fr", name: "Français (French)", flag: "🇫🇷" },
  { code: "de", name: "Deutsch (German)", flag: "🇩🇪" },
  { code: "zh-CN", name: "中文 (Chinese)", flag: "🇨🇳" },
  { code: "ja", name: "日本語 (Japanese)", flag: "🇯🇵" },
  { code: "ko", name: "한국어 (Korean)", flag: "🇰🇷" },
  { code: "ar", name: "العربية (Arabic)", flag: "🇸🇦" },
  { code: "pt", name: "Português (Portuguese)", flag: "🇧🇷" },
  { code: "ru", name: "Русский (Russian)", flag: "🇷🇺" },
];

/**
 * Triggers Google Translate to translate the page to the given language code.
 * Works by programmatically setting the googtrans cookie and manipulating
 * the hidden Google Translate select element.
 */
function triggerGoogleTranslate(langCode) {
  // Set the Google Translate cookie
  const domain = window.location.hostname;
  document.cookie = `googtrans=/en/${langCode}; path=/; domain=${domain}`;
  document.cookie = `googtrans=/en/${langCode}; path=/`;

  // Try to find the Google Translate select element and change it
  const gtSelect = document.querySelector(".goog-te-combo");
  if (gtSelect) {
    gtSelect.value = langCode;
    gtSelect.dispatchEvent(new Event("change"));
    return true;
  }
  return false;
}

/**
 * Gets the currently active Google Translate language from the cookie.
 */
function getActiveTranslateLanguage() {
  const match = document.cookie.match(/googtrans=\/en\/([^;]+)/);
  return match ? match[1] : "en";
}

/**
 * Initializes the Google Translate widget.
 * Ensures the script is loaded and the element is created.
 */
function ensureGoogleTranslateLoaded() {
  return new Promise((resolve) => {
    // Check if already initialized
    if (window.google && window.google.translate && window.google.translate.TranslateElement) {
      resolve(true);
      return;
    }

    // Check if script is already loading
    const existing = document.querySelector('script[src*="translate.google.com"]');
    if (existing) {
      // Script exists, wait for it to load
      const checkInterval = setInterval(() => {
        if (window.google && window.google.translate && window.google.translate.TranslateElement) {
          clearInterval(checkInterval);
          resolve(true);
        }
      }, 100);
      // Timeout after 10s
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(false);
      }, 10000);
      return;
    }

    // Define the callback
    window.googleTranslateElementInit = function () {
      // Create a hidden container for Google Translate if it doesn't exist
      let hiddenContainer = document.getElementById("__google_translate_hidden");
      if (!hiddenContainer) {
        hiddenContainer = document.createElement("div");
        hiddenContainer.id = "__google_translate_hidden";
        hiddenContainer.style.cssText = "position:absolute;top:-9999px;left:-9999px;opacity:0;pointer-events:none;";
        document.body.appendChild(hiddenContainer);
      }
      
      try {
        new window.google.translate.TranslateElement(
          {
            pageLanguage: "en",
            layout: window.google.translate.TranslateElement.InlineLayout.SIMPLE,
            autoDisplay: false,
          },
          "__google_translate_hidden"
        );
      } catch (e) {
        // Widget may already be initialized
      }
      resolve(true);
    };

    // Load the script
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

export default function LanguageSelector() {
  const [selectedLang, setSelectedLang] = useState("en");
  const [isTranslating, setIsTranslating] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    // Check current language from cookie
    const currentLang = getActiveTranslateLanguage();
    setSelectedLang(currentLang);

    // Initialize Google Translate
    ensureGoogleTranslateLoaded().then((loaded) => {
      setIsReady(loaded);
      if (!loaded) {
        console.warn("Google Translate failed to load. Language switching may not work.");
      }
    });
  }, []);

  const handleLanguageChange = async (langCode) => {
    if (langCode === selectedLang) return;
    setIsTranslating(true);
    setSelectedLang(langCode);

    if (langCode === "en") {
      // Reset to English - clear the cookie and reload
      const domain = window.location.hostname;
      document.cookie = `googtrans=; path=/; domain=${domain}; expires=Thu, 01 Jan 1970 00:00:00 UTC`;
      document.cookie = `googtrans=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC`;
      
      // Try to use the Google Translate widget to reset
      const gtSelect = document.querySelector(".goog-te-combo");
      if (gtSelect) {
        gtSelect.value = "";
        gtSelect.dispatchEvent(new Event("change"));
      }
      
      // Save preference
      localStorage.setItem("buildconnect_lang", langCode);
      
      // Reload to fully reset translations
      setTimeout(() => {
        window.location.reload();
      }, 300);
      return;
    }

    // Try to trigger the translation
    const success = triggerGoogleTranslate(langCode);
    
    if (!success) {
      // Widget might not be ready, wait and retry
      await new Promise(r => setTimeout(r, 1000));
      const retrySuccess = triggerGoogleTranslate(langCode);
      
      if (!retrySuccess) {
        // Last resort: set cookie and reload
        const domain = window.location.hostname;
        document.cookie = `googtrans=/en/${langCode}; path=/; domain=${domain}`;
        document.cookie = `googtrans=/en/${langCode}; path=/`;
        localStorage.setItem("buildconnect_lang", langCode);
        window.location.reload();
        return;
      }
    }

    // Save preference
    localStorage.setItem("buildconnect_lang", langCode);
    
    setTimeout(() => {
      setIsTranslating(false);
    }, 1500);
  };

  // Restore saved language preference on first load
  useEffect(() => {
    const savedLang = localStorage.getItem("buildconnect_lang");
    if (savedLang && savedLang !== "en" && savedLang !== selectedLang) {
      // Wait for Google Translate to be ready, then apply saved language
      const tryApply = () => {
        const gtSelect = document.querySelector(".goog-te-combo");
        if (gtSelect) {
          setSelectedLang(savedLang);
          triggerGoogleTranslate(savedLang);
        } else {
          setTimeout(tryApply, 500);
        }
      };
      setTimeout(tryApply, 1500);
    }
  }, [isReady]);

  const filteredLanguages = LANGUAGES.filter(
    (lang) =>
      lang.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lang.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const currentLang = LANGUAGES.find((l) => l.code === selectedLang) || LANGUAGES[0];

  return (
    <div className="space-y-4 notranslate" translate="no">
      {/* Current Language Display */}
      <div className="flex items-center gap-3 p-3 bg-accent/10 border border-accent/30 rounded-lg">
        <span className="text-2xl">{currentLang.flag}</span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-accent">Currently Active</p>
          <p className="text-xs text-muted-foreground">{currentLang.name}</p>
        </div>
        {isTranslating && (
          <div className="flex items-center gap-2 text-xs text-accent font-medium">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Translating...
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search languages..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent placeholder:text-muted-foreground pl-9"
        />
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </div>

      {/* Language Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[320px] overflow-y-auto pr-1">
        {filteredLanguages.map((lang) => {
          const isActive = lang.code === selectedLang;
          return (
            <button
              key={lang.code}
              onClick={() => handleLanguageChange(lang.code)}
              disabled={isTranslating}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-left transition-all duration-200 border text-sm ${
                isActive
                  ? "bg-accent/15 border-accent/40 shadow-sm ring-1 ring-accent/20"
                  : "bg-card border-border hover:bg-muted/60 hover:border-accent/20"
              } ${isTranslating ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
            >
              <span className="text-lg shrink-0">{lang.flag}</span>
              <span className={`font-medium truncate ${isActive ? "text-accent" : ""}`}>
                {lang.name}
              </span>
              {isActive && (
                <svg
                  className="ml-auto shrink-0 text-accent"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      {filteredLanguages.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No languages found matching "{searchQuery}"
        </p>
      )}

      {!isReady && (
        <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Translation service is loading. Please wait a moment...
        </p>
      )}
    </div>
  );
}
