import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en/common.json";
import bn from "./locales/bn/common.json";

// UI language only. Content / voice / subtitle languages are separate settings
// owned by each feature and never read from here.
void i18n.use(initReactI18next).init({
  resources: { en: { common: en }, bn: { common: bn } },
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  interpolation: { escapeValue: false },
});

export default i18n;
