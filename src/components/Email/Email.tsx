import { useState } from 'react';
import { Mail, Copy, Check, ExternalLink, Send } from 'lucide-react';

const WEBMAIL_URL = 'https://webmail.ohv.pl';
const EMAIL_ADDRESS = 'kontakt@parkingsobieszewo.pl';

const templates = [
  {
    subject: 'Potwierdzenie rezerwacji miejsca parkingowego',
    body: `Dzień dobry,\n\nDziękuję za kontakt i zainteresowanie parkingiem.\nZ przyjemnością potwierdzam rezerwację miejsca parkingowego.\n\nOpłata za zarezerwowane miejsce wynosi 25 zł (opłata w dniu przyjazdu: gotówka, BLIK, karta).\nParking czynny: piątki, soboty i niedziele w godz. 8:00–19:00.\nAdres: ul. Turystyczna 69, Wyspa Sobieszewska, Gdańsk (wejście na plażę nr 10).\n\nDo zobaczenia!\n\nPozdrawiam,\nMichał Kłos\nParking płatny niestrzeżony "Michał Kłos"\ntel. 784 828 748`,
  },
  {
    subject: 'Brak wolnych miejsc',
    body: `Dzień dobry,\n\nDziękuję za wiadomość.\nNiestety na wybrany termin wszystkie miejsca są już zajęte.\n\nZapraszam do obserwowania naszego profilu na Facebooku – tam na bieżąco informuję o dostępności miejsc:\nhttps://www.facebook.com/profile.php?id=61575778705898\n\nPozdrawiam,\nMichał Kłos\nParking płatny niestrzeżony "Michał Kłos"\ntel. 784 828 748`,
  },
  {
    subject: 'Informacje o parkingu',
    body: `Dzień dobry,\n\nDziękuję za zainteresowanie parkingiem.\n\nPodstawowe informacje:\n• Cena: 20 zł (bez rezerwacji) / 25 zł (z rezerwacją)\n• Godziny otwarcia: piątki, soboty, niedziele 8:00–19:00 (czerwiec–sierpień)\n• Lokalizacja: ul. Turystyczna 69, Wyspa Sobieszewska, Gdańsk (wejście na plażę nr 10)\n• Płatność: gotówka, BLIK, karta, Google Pay, Apple Pay\n• Rezerwacje wyłącznie przez Facebook\n\nW razie dalszych pytań – do dyspozycji.\n\nPozdrawiam,\nMichał Kłos\nParking płatny niestrzeżony "Michał Kłos"\ntel. 784 828 748`,
  },
];

export default function Email() {
  const [copied, setCopied] = useState(false);

  const copyEmail = async () => {
    await navigator.clipboard.writeText(EMAIL_ADDRESS);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openWebmail = async () => {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(WEBMAIL_URL);
    } catch {
      window.open(WEBMAIL_URL, '_blank');
    }
  };

  const composeTemplate = async (tpl: (typeof templates)[0]) => {
    const mailto = `mailto:?subject=${encodeURIComponent(tpl.subject)}&body=${encodeURIComponent(tpl.body)}`;
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(mailto);
    } catch {
      window.location.href = mailto;
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6 overflow-y-auto h-full">
      <h1 className="text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
        <Mail size={24} className="text-teal-400" />
        Skrzynka pocztowa
      </h1>

      {/* Main email card */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-12 h-12 rounded-full bg-teal-500/20 flex items-center justify-center flex-shrink-0">
            <Mail size={24} className="text-teal-400" />
          </div>
          <div>
            <div className="text-lg font-bold text-[var(--color-text)]">{EMAIL_ADDRESS}</div>
            <div className="text-sm text-[var(--color-muted)]">Główna skrzynka parkingu · parkingsobieszewo.pl</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={copyEmail}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text)] hover:bg-[var(--color-bg)] transition"
          >
            {copied ? <Check size={15} className="text-green-500" /> : <Copy size={15} />}
            {copied ? 'Skopiowano!' : 'Kopiuj adres'}
          </button>
          <button
            onClick={openWebmail}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-sm font-semibold transition"
          >
            <ExternalLink size={15} />
            Otwórz webmail
          </button>
        </div>
      </div>

      {/* Quick reply templates */}
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6">
        <h2 className="font-bold text-[var(--color-text)] mb-4 flex items-center gap-2">
          <Send size={16} className="text-amber-400" />
          Szybkie odpowiedzi
        </h2>
        <div className="space-y-3">
          {templates.map((tpl, i) => (
            <button
              key={i}
              onClick={() => composeTemplate(tpl)}
              className="w-full text-left p-4 rounded-lg border border-[var(--color-border)] hover:border-teal-500/50 hover:bg-teal-500/5 transition group"
            >
              <div className="text-sm font-medium text-[var(--color-text)] group-hover:text-teal-400 transition flex items-center justify-between">
                {tpl.subject}
                <ExternalLink size={13} className="flex-shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition" />
              </div>
              <div className="text-xs text-[var(--color-muted)] mt-1 line-clamp-1">
                {tpl.body.replace(/\n/g, ' ').slice(0, 80)}…
              </div>
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--color-muted)] mt-4">
          Kliknięcie otworzy domyślnego klienta pocztowego z wypełnionym szablonem.
        </p>
      </div>
    </div>
  );
}
