import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Dyktowanie notatki głosowo — wykorzystuje natywne Web Speech API przeglądarki.
 * Zero zależności i kosztów: w MVP bez własnego transkryptora.
 * Jeśli przeglądarka nie wspiera API (np. Firefox), hook zwraca supported=false i UI ukrywa przycisk.
 */
export function useDictation(options: { onText: (chunk: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onTextRef = useRef(options.onText);
  useEffect(() => {
    onTextRef.current = options.onText;
  });

  useEffect(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      return;
    }
    setSupported(true);
    return () => {
      recRef.current?.abort();
      recRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (listening) {
      stop();
      return;
    }
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = 'pl-PL';
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      let text = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res?.isFinal) text += (res[0]?.transcript ?? '') + ' ';
      }
      if (text.trim()) onTextRef.current(text.trim());
    };
    rec.onerror = (event) => {
      const type = (event as Event & { error?: string }).error;
      setError(type === 'not-allowed' ? 'Odmówiono dostępu do mikrofonu.' : 'Nie udało się dyktować. Spróbuj ponownie.');
      setListening(false);
    };
    rec.onend = () => setListening(false);
    setError(null);
    try {
      rec.start();
      setListening(true);
    } catch {
      setError('Nie udało się rozpocząć dyktowania.');
    }
  }, [listening, stop]);

  return { supported, listening, error, toggle };
}
