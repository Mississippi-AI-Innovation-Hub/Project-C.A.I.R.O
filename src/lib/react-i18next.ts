import en from '@/i18n/locales/en.ts';

type TranslationTree = Record<string, unknown>;

const translations = en as TranslationTree;

const englishI18n = {
  language: 'en',
  resolvedLanguage: 'en',
  languages: ['en'],
  changeLanguage: async () => 'en',
};

function getTranslationValue(key: string): unknown {
  return key.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, translations);
}

function interpolate(template: string, options?: Record<string, unknown>) {
  if (!options) {
    return template;
  }

  return template.replace(/\{\{(.*?)\}\}/g, (_, rawKey) => {
    const optionKey = String(rawKey).trim();
    const value = options[optionKey];
    return value == null ? '' : String(value);
  });
}

export function useTranslation() {
  const t = (key: string, options?: Record<string, unknown>) => {
    const value = getTranslationValue(key);

    if (typeof value === 'string') {
      return interpolate(value, options);
    }

    if (typeof value === 'number') {
      return String(value);
    }

    return key;
  };

  return {
    t,
    i18n: englishI18n,
    ready: true,
  };
}

export const Trans = ({ i18nKey }: { i18nKey: string }) => useTranslation().t(i18nKey);
