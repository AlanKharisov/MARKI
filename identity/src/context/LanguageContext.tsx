import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type Language = 'en' | 'uk';

const messages = {
  en: {
    home: 'Home', scan: 'Scan', add: 'Add', alerts: 'Alerts', profile: 'Profile', crm: 'CRM',
    myProfile: 'My Profile', editProfile: 'Edit profile', editProfileSub: 'Name, username, bio',
    myNfts: 'My NFTs', myNftsSub: 'Collection and listed items', security: 'Security',
    inDevelopment: 'In development', cryptoWallets: 'Crypto wallets', cryptoWalletsSub: 'Connect Phantom',
    markiWallet: 'Marki Wallet', markiWalletSub: 'Custodial · Verified', companyApproval: 'Company approval',
    qrScanner: 'QR Scanner', qrScannerSub: 'Scan and verify product QR codes', language: 'Language',
    interfacePreference: 'Interface language', brandRating: 'Brand rating', overallByCategory: 'Overall and by category',
    authenticity: 'Authenticity', productQuality: 'Product quality', delivery: 'Delivery', communication: 'Communication',
    ratingsAfterTransactions: 'Ratings appear after verified transactions.', pointCamera: 'Point your camera at a QR code',
    cameraDenied: 'Camera access denied. Please allow access in settings.', cameraNotFound: 'Camera not found on this device.',
    scanAgain: 'Scan Again', issuedByIdenity: 'Issued by Idenity', originNotVerified: 'Origin not fully verified',
    brandWallet: 'Brand wallet', verified: 'Verified', notVerified: 'Not verified', issuer: 'Issuer',
  },
  uk: {
    home: 'Головна', scan: 'Сканер', add: 'Додати', alerts: 'Сповіщення', profile: 'Профіль', crm: 'CRM',
    myProfile: 'Мій профіль', editProfile: 'Редагувати профіль', editProfileSub: "Ім'я, нікнейм, опис",
    myNfts: 'Мої NFT', myNftsSub: 'Колекції та товари у продажу', security: 'Безпека',
    inDevelopment: 'У розробці', cryptoWallets: 'Криптогаманці', cryptoWalletsSub: 'Підключити Phantom',
    markiWallet: 'Гаманець Marki', markiWalletSub: 'Кастодіальний · Перевірений', companyApproval: 'Верифікація компанії',
    qrScanner: 'QR-сканер', qrScannerSub: 'Сканування та перевірка QR-кодів товарів', language: 'Мова',
    interfacePreference: 'Мова інтерфейсу', brandRating: 'Рейтинг бренду', overallByCategory: 'Загальний та за категоріями',
    authenticity: 'Автентичність', productQuality: 'Якість товару', delivery: 'Доставка', communication: 'Комунікація',
    ratingsAfterTransactions: 'Рейтинг з’явиться після підтверджених транзакцій.', pointCamera: 'Наведіть камеру на QR-код',
    cameraDenied: 'Доступ до камери заборонено. Дозвольте його в налаштуваннях.', cameraNotFound: 'На пристрої немає камери.',
    scanAgain: 'Сканувати ще', issuedByIdenity: 'Випущено через Idenity', originNotVerified: 'Походження не підтверджено',
    brandWallet: 'Гаманець бренду', verified: 'Верифікований', notVerified: 'Не верифікований', issuer: 'Емітент',
  },
} as const;

type MessageKey = keyof typeof messages.en;
type LanguageContextValue = { language: Language; setLanguage: (language: Language) => void; t: (key: MessageKey) => string };

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => localStorage.getItem('idenity-language') === 'uk' ? 'uk' : 'en');
  const setLanguage = (next: Language) => { localStorage.setItem('idenity-language', next); setLanguageState(next); };
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const value = useMemo(() => ({ language, setLanguage, t: (key: MessageKey) => messages[language][key] }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage must be used inside LanguageProvider');
  return value;
}
