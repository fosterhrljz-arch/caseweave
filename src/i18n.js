import zh from './zh.json';

let language = 'en';
try { if (globalThis.localStorage?.getItem('caseweave-language') === 'zh') language = 'zh'; } catch { /* Storage can be disabled. */ }

export function setLocale(value) { language = value === 'zh' ? 'zh' : 'en'; }
export function locale() { return language === 'zh' ? 'zh-CN' : 'en-US'; }
export function tr(key, values = {}) {
  const text = language === 'zh' ? zh[key] || key : key;
  return String(text ?? '').replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (token, name) => Object.hasOwn(values, name) ? values[name] : token);
}
