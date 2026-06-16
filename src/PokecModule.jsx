import React, { useEffect, useMemo, useState } from 'react';

const STARTER_QUESTIONS = [
  'Co umíš a k jakým datům máš přístup?',
  'Jaké nejdůležitější znalosti o našem businessu si teď neseš ke schválení?',
  'Kolik jsme vybrali na poštovném a doběrečném?',
  'Proč se mi v tomto období mění AOV?',
  'Co nejvíc táhne nebo kazí marži?',
  'Kolik se prodalo balíčků a jakou mají marži?',
  'Které kampaně a landing pages stojí za kontrolu?',
];

const toneClasses = {
  info: 'border-blue-200 bg-blue-50 text-blue-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
};

const MAX_STORED_MESSAGES = 24;

function buildHistoryKey(userEmail) {
  const normalizedEmail = (userEmail || 'unknown').toLowerCase().trim();
  return `rm-pokec-history:${normalizedEmail}`;
}

function readableErrorMessage(errorLike, fallback) {
  if (!errorLike) return fallback;
  if (typeof errorLike === 'string') return errorLike;
  if (typeof errorLike?.message === 'string' && errorLike.message.trim()) return errorLike.message;
  try {
    return JSON.stringify(errorLike);
  } catch {
    return fallback;
  }
}

function EvidenceList({ evidence }) {
  const toolCalls = evidence?.toolCalls || [];
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
      <div className="mb-2 font-semibold text-slate-800">Evidence</div>
      <div className="flex flex-wrap gap-2">
        <span className="rounded-md bg-white px-2 py-1">Období: {evidence?.dateFrom} až {evidence?.dateTo}</span>
        {evidence?.previousPeriod && (
          <span className="rounded-md bg-white px-2 py-1">
            Srovnání: {evidence.previousPeriod.dateFrom} až {evidence.previousPeriod.dateTo}
          </span>
        )}
        <span className="rounded-md bg-white px-2 py-1">Země: {evidence?.market}</span>
        <span className="rounded-md bg-white px-2 py-1">Intent: {evidence?.intent}</span>
        {evidence?.playbook?.title && (
          <span className="rounded-md bg-white px-2 py-1">Playbook: {evidence.playbook.title}</span>
        )}
        {evidence?.knowledge && (
          <span className="rounded-md bg-white px-2 py-1">
            Paměť: {evidence.knowledge.contexts} kontextů · {evidence.knowledge.memories} pamětí
          </span>
        )}
        {evidence?.catalog && (
          <span className="rounded-md bg-white px-2 py-1">
            Katalog: {evidence.catalog.sources?.length || 0} zdrojů · {evidence.catalog.tools?.length || 0} toolů
          </span>
        )}
        {evidence?.ai && (
          <span className="rounded-md bg-white px-2 py-1">
            AI: {evidence.ai.mode}{evidence.ai.model ? ` · ${evidence.ai.model}` : ''}
          </span>
        )}
      </div>
      {!!toolCalls.length && (
        <div className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {toolCalls.map((call, index) => (
            <div
              key={`${call.tool}-${index}`}
              className={`rounded-md border px-2 py-1 ${
                call.status === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              <span className="font-semibold">{call.tool}</span>: {call.status}
              {call.rows != null ? ` · ${call.rows} ř.` : ''}
              {call.message ? ` · ${call.message}` : ''}
            </div>
          ))}
        </div>
      )}
      {evidence?.note && <div className="mt-3 text-slate-500">{evidence.note}</div>}
    </div>
  );
}

function DataTable({ table }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
        {table.title}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-white text-slate-500">
            <tr>
              {table.columns.map((column) => (
                <th key={column} className="px-3 py-2 text-left font-semibold">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="max-w-[420px] truncate px-3 py-2 text-slate-700" title={String(cell)}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AiInterpretation({ interpretation }) {
  if (!interpretation) return null;

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-950">
      <div className="text-xs font-semibold uppercase tracking-wide opacity-70">AI interpretace nad evidencí</div>
      <div className="mt-1 text-sm font-bold">{interpretation.verdict}</div>
      <p className="mt-2 whitespace-pre-line text-sm opacity-90">{interpretation.interpretation}</p>
      {!!interpretation.questionsToAsk?.length && (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Co bych se ještě zeptal</div>
          <ul className="mt-1 space-y-1 text-sm">
            {interpretation.questionsToAsk.map((item, index) => <li key={index}>• {item}</li>)}
          </ul>
        </div>
      )}
      {!!interpretation.guardrailNotes?.length && (
        <div className="mt-3 text-xs opacity-75">
          {interpretation.guardrailNotes.slice(0, 2).join(' · ')}
        </div>
      )}
    </div>
  );
}

function MemoryCandidateCard({ candidate, saveState, onSave }) {
  if (!candidate) return null;
  const isSaving = saveState?.status === 'saving';
  const isSaved = saveState?.status === 'saved';

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-violet-950">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Návrh do týmové paměti</h3>
          <div className="mt-1 text-sm font-bold">{candidate.title}</div>
          <div className="mt-2 line-clamp-4 whitespace-pre-line text-xs opacity-80">{candidate.body}</div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded-md bg-white/70 px-2 py-1">Typ: {candidate.memory_type}</span>
            <span className="rounded-md bg-white/70 px-2 py-1">Téma: {candidate.topic}</span>
            <span className="rounded-md bg-white/70 px-2 py-1">Review: pending</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onSave(candidate)}
          disabled={isSaving || isSaved}
          className="shrink-0 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-300"
        >
          {isSaving ? 'Ukládám…' : isSaved ? 'Uloženo' : 'Uložit návrh'}
        </button>
      </div>
      {saveState?.message && <div className="mt-2 text-xs opacity-80">{saveState.message}</div>}
    </div>
  );
}

function BriefingCard({ briefing }) {
  if (!briefing) return null;

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Denní briefing</div>
          <h3 className="mt-1 text-lg font-bold">{briefing.title}</h3>
          <p className="mt-2 text-sm opacity-90">{briefing.summary}</p>
        </div>
        <div className="rounded-lg bg-white/70 px-3 py-2 text-xs font-semibold">
          {briefing.generatedFor?.dateFrom} až {briefing.generatedFor?.dateTo}
        </div>
      </div>

      {!!briefing.highlights?.length && (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Hlavní pohyby</div>
          <ul className="mt-2 space-y-1 text-sm">
            {briefing.highlights.map((item, index) => <li key={index}>• {item}</li>)}
          </ul>
        </div>
      )}

      {!!briefing.watchouts?.length && (
        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Watchout</div>
          <ul className="mt-2 space-y-1 text-sm">
            {briefing.watchouts.map((item, index) => <li key={index}>• {item}</li>)}
          </ul>
        </div>
      )}

      {briefing.focusQuestion && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-white/70 p-3 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Co bych řešil jako první</div>
          <div className="mt-1 font-medium">{briefing.focusQuestion}</div>
        </div>
      )}
    </div>
  );
}

function ResponseCard({ response, saveState, onSaveMemory }) {
  if (!response) return null;
  const isCompact = response.detailLevel !== 'full' && response.responseMode !== 'daily_briefing';
  const answer = response.answer || response.verdict;

  const detailSections = (
    <div className="space-y-4">
      <AiInterpretation interpretation={response.aiInterpretation} />

      {!!response.facts?.length && (
        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Fakta</h3>
          <ul className="space-y-1 text-sm text-slate-700">
            {response.facts.map((item, index) => <li key={index}>• {item}</li>)}
          </ul>
        </div>
      )}

      {!!response.hypotheses?.length && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <h3 className="mb-2 text-sm font-semibold text-blue-900">Hypotézy</h3>
          <ul className="space-y-1 text-sm text-blue-900">
            {response.hypotheses.map((item, index) => <li key={index}>• {item}</li>)}
          </ul>
        </div>
      )}

      {!!response.missingData?.length && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="mb-2 text-sm font-semibold text-amber-900">Co chybí / limity</h3>
          <ul className="space-y-1 text-sm text-amber-900">
            {response.missingData.map((item, index) => <li key={index}>• {item}</li>)}
          </ul>
        </div>
      )}

      {!!response.tables?.length && (
        <div className="space-y-4">
          {response.tables.map((table, index) => <DataTable key={`${table.title}-${index}`} table={table} />)}
        </div>
      )}

      {!!response.nextSteps?.length && (
        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Další krok</h3>
          <ul className="space-y-1 text-sm text-slate-700">
            {response.nextSteps.map((item, index) => <li key={index}>• {item}</li>)}
          </ul>
        </div>
      )}

      {!isCompact && (
        <MemoryCandidateCard candidate={response.memoryCandidate} saveState={saveState} onSave={onSaveMemory} />
      )}

      <EvidenceList evidence={response.evidence} />
    </div>
  );

  return (
    <div className="space-y-3">
      <div className={`rounded-xl border p-4 ${response.missingData?.length ? toneClasses.warning : toneClasses.good}`}>
        <div className="text-xs font-semibold uppercase tracking-wide opacity-70">Pokec</div>
        <p className="mt-1 whitespace-pre-line text-base font-semibold leading-relaxed">{answer}</p>
        <div className="mt-2 text-xs opacity-75">Jistota: {response.confidence || 'neuvedena'}</div>
      </div>

      {isCompact ? (
        <details className="rounded-xl border border-slate-200 bg-slate-50">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">
            Detail, tabulky a evidence
          </summary>
          <div className="border-t border-slate-200 bg-white p-4">
            {detailSections}
          </div>
        </details>
      ) : detailSections}
    </div>
  );
}

export default function PokecModule({ supabaseClient, dateFrom, dateTo, country, userEmail }) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [memorySaveState, setMemorySaveState] = useState({});
  const [exampleForm, setExampleForm] = useState({
    title: '',
    trigger: '',
    expectedBehavior: '',
    requiredChecks: '',
    badShortcut: '',
  });
  const [exampleSaveState, setExampleSaveState] = useState({ status: 'idle', message: '' });
  const [loading, setLoading] = useState(false);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [error, setError] = useState('');
  const [historyState, setHistoryState] = useState({ status: 'idle', message: '' });

  const contextLabel = useMemo(() => {
    const market = country === 'all' ? 'všechny země' : country.toUpperCase();
    return `${dateFrom} až ${dateTo} · ${market}`;
  }, [dateFrom, dateTo, country]);

  const historyKey = useMemo(() => buildHistoryKey(userEmail), [userEmail]);
  const latestBriefing = useMemo(() => {
    const assistantMessages = messages
      .filter((message) => message.role === 'assistant' && message.response?.briefing)
      .map((message) => message.response.briefing);
    return assistantMessages.length ? assistantMessages[assistantMessages.length - 1] : null;
  }, [messages]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const raw = window.localStorage.getItem(historyKey);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      const storedMessages = Array.isArray(parsed?.messages) ? parsed.messages : [];
      const storedQuestion = typeof parsed?.draftQuestion === 'string' ? parsed.draftQuestion : '';
      if (!storedMessages.length && !storedQuestion) return;

      setMessages(storedMessages);
      setQuestion(storedQuestion);
      setHistoryState({
        status: 'restored',
        message: `Obnovena lokální historie pro ${userEmail || 'tohoto uživatele'} v tomto browseru.`,
      });
    } catch (restoreError) {
      setHistoryState({
        status: 'error',
        message: 'Lokální historii Pokecu se nepodařilo načíst.',
      });
    }
  }, [historyKey, userEmail]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const persistedMessages = messages.slice(-MAX_STORED_MESSAGES);
      const payload = JSON.stringify({
        messages: persistedMessages,
        draftQuestion: question,
        savedAt: new Date().toISOString(),
      });
      window.localStorage.setItem(historyKey, payload);
    } catch {
      setHistoryState((prev) => {
        if (prev.status === 'error') return prev;
        return {
          status: 'error',
          message: 'Lokální historii Pokecu se nepodařilo uložit.',
        };
      });
    }
  }, [historyKey, messages, question]);

  const clearHistory = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(historyKey);
    }
    setMessages([]);
    setQuestion('');
    setMemorySaveState({});
    setError('');
    setHistoryState({
      status: 'cleared',
      message: 'Lokální historie byla smazaná jen v tomto browseru.',
    });
  };

  const askBriefing = async () => {
    if (briefingLoading || loading) return;

    setError('');
    setBriefingLoading(true);
    const briefingPrompt = `Denní briefing pro ${contextLabel}`;
    setMessages((prev) => [...prev, { role: 'user', text: briefingPrompt }]);

    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session?.access_token) throw new Error('Nejste přihlášený.');

      const response = await fetch('/api/pokec', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'daily_briefing',
          dateFrom,
          dateTo,
          market: country,
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(readableErrorMessage(payload.error, `HTTP ${response.status}`));

      setMessages((prev) => [...prev, { role: 'assistant', response: payload }]);
    } catch (err) {
      setError(readableErrorMessage(err, 'Denní briefing se nepodařilo načíst.'));
    } finally {
      setBriefingLoading(false);
    }
  };

  const ask = async (text = question) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setQuestion('');
    setError('');
    setLoading(true);
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);

    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session?.access_token) throw new Error('Nejste přihlášený.');

      const response = await fetch('/api/pokec', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          question: trimmed,
          dateFrom,
          dateTo,
          market: country,
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(readableErrorMessage(payload.error, `HTTP ${response.status}`));

      setMessages((prev) => [...prev, { role: 'assistant', response: payload }]);
    } catch (err) {
      setError(readableErrorMessage(err, 'Pokec se nepodařilo načíst.'));
    } finally {
      setLoading(false);
    }
  };

  const saveMemoryCandidate = async (messageIndex, candidate) => {
    setMemorySaveState((prev) => ({
      ...prev,
      [messageIndex]: { status: 'saving', message: 'Ukládám jako návrh, čeká na lidské schválení.' },
    }));

    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session?.access_token) throw new Error('Nejste přihlášený.');

      const response = await fetch('/api/pokec', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'save_memory_candidate',
          candidate,
          market: country,
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(readableErrorMessage(payload.error, `HTTP ${response.status}`));

      setMemorySaveState((prev) => ({
        ...prev,
        [messageIndex]: {
          status: 'saved',
          message: `Uloženo jako návrh paměti (${payload.reviewStatus || 'pending'}).`,
          candidateId: payload.candidateId,
        },
      }));
    } catch (err) {
      setMemorySaveState((prev) => ({
        ...prev,
        [messageIndex]: { status: 'error', message: readableErrorMessage(err, 'Návrh paměti se nepodařilo uložit.') },
      }));
    }
  };

  const saveExampleCandidate = async () => {
    if (!exampleForm.title.trim() || !exampleForm.trigger.trim() || !exampleForm.expectedBehavior.trim()) {
      setExampleSaveState({
        status: 'error',
        message: 'Vyplň název, trigger a očekávané chování.',
      });
      return;
    }

    setExampleSaveState({
      status: 'saving',
      message: 'Ukládám příklad jako pending candidate ke schválení.',
    });

    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session?.access_token) throw new Error('Nejste přihlášený.');

      const response = await fetch('/api/pokec', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'save_example_candidate',
          market: country,
          example: {
            title: exampleForm.title,
            trigger: exampleForm.trigger,
            expected_behavior: exampleForm.expectedBehavior,
            required_checks: exampleForm.requiredChecks,
            bad_shortcut: exampleForm.badShortcut,
          },
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(readableErrorMessage(payload.error, `HTTP ${response.status}`));

      setExampleSaveState({
        status: 'saved',
        message: `Příklad uložen jako candidate (${payload.reviewStatus || 'pending'}).`,
      });
      setExampleForm({
        title: '',
        trigger: '',
        expectedBehavior: '',
        requiredChecks: '',
        badShortcut: '',
      });
    } catch (err) {
      setExampleSaveState({
        status: 'error',
        message: readableErrorMessage(err, 'Příklad se nepodařilo uložit.'),
      });
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-bold">Pokec: AI kolega pro Regal Master</h2>
            <p className="mt-1 text-sm opacity-80">
              První tool-first verze. Odpovědi staví na read-only datech, uvádí evidenci a radši přizná missing data, než aby hádala.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 md:items-end">
            <div className="rounded-lg bg-white/70 px-3 py-2 text-xs font-semibold text-blue-900">
              Kontext: {contextLabel}
            </div>
            <div className="flex flex-col gap-2 md:items-end">
              <button
                type="button"
                onClick={askBriefing}
                disabled={briefingLoading || loading}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {briefingLoading ? 'Stavím briefing…' : 'Denní briefing'}
              </button>
              <button
                type="button"
                onClick={() => ask('Jaké nejdůležitější znalosti o našem businessu si teď neseš ke schválení?')}
                disabled={loading || briefingLoading}
                className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Knowledge review
              </button>
            </div>
          </div>
        </div>
      </div>

      {latestBriefing && <BriefingCard briefing={latestBriefing} />}

      <div className="rounded-2xl border border-slate-200 p-4">
        <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-wrap gap-2">
            {STARTER_QUESTIONS.map((starter) => (
              <button
                key={starter}
                onClick={() => ask(starter)}
                disabled={loading}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {starter}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={clearHistory}
            disabled={loading && !messages.length}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Smazat lokální historii
          </button>
        </div>

        {historyState.message && (
          <div className={`mb-3 rounded-lg border p-3 text-xs ${
            historyState.status === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-slate-200 bg-slate-50 text-slate-700'
          }`}>
            {historyState.message}
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            ask();
          }}
          className="flex flex-col gap-2 md:flex-row"
        >
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Zeptej se třeba: Proč padá AOV v Maďarsku? Co nám dnes kazí marži? Které balíčky se prodávají?"
            rows={2}
            className="min-h-[52px] flex-1 resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          <button
            type="submit"
            disabled={!question.trim() || loading}
            className="rounded-xl bg-blue-500 px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {loading ? 'Analyzuji…' : 'Zeptat se'}
          </button>
        </form>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-sm font-semibold">Přidat příklad, co má Pokec umět</h3>
            <p className="mt-1 text-xs opacity-80">
              Uloží se jen jako pending candidate ke schválení. Hodí se pro situace typu “když řešíme AOV, nesmí přeskočit landing pages”.
            </p>
          </div>
          <div className="rounded-md bg-white/70 px-2 py-1 text-[11px] font-semibold">candidate-only</div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <input
            value={exampleForm.title}
            onChange={(event) => setExampleForm((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="Název příkladu"
            className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
          <input
            value={exampleForm.trigger}
            onChange={(event) => setExampleForm((prev) => ({ ...prev, trigger: event.target.value }))}
            placeholder="Trigger / situace"
            className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
          <textarea
            value={exampleForm.expectedBehavior}
            onChange={(event) => setExampleForm((prev) => ({ ...prev, expectedBehavior: event.target.value }))}
            placeholder="Jak se má agent zachovat"
            rows={3}
            className="min-h-[96px] rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
          <textarea
            value={exampleForm.requiredChecks}
            onChange={(event) => setExampleForm((prev) => ({ ...prev, requiredChecks: event.target.value }))}
            placeholder="Povinné kontroly"
            rows={3}
            className="min-h-[96px] rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
          />
          <textarea
            value={exampleForm.badShortcut}
            onChange={(event) => setExampleForm((prev) => ({ ...prev, badShortcut: event.target.value }))}
            placeholder="Zakázaná zkratka / špatná odpověď"
            rows={2}
            className="min-h-[72px] rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 md:col-span-2"
          />
        </div>
        <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="text-xs opacity-80">
            Zapisuje přes `save_example_candidate` do `ai_memory_candidates` s `memory_type=example`.
          </div>
          <button
            type="button"
            onClick={saveExampleCandidate}
            disabled={exampleSaveState.status === 'saving'}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
          >
            {exampleSaveState.status === 'saving' ? 'Ukládám…' : 'Uložit příklad'}
          </button>
        </div>
        {exampleSaveState.message && (
          <div className={`mt-3 rounded-lg border p-3 text-sm ${
            exampleSaveState.status === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-white/70 text-emerald-900'
          }`}>
            {exampleSaveState.message}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {!messages.length && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
            Zatím žádná otázka. Začni business problémem, ne metrikou: “Proč”, “čím je způsobené”, “co bys ověřil”.
            Pokec si v tomto browseru drží lokální historii, aby šlo navázat na předchozí kontext.
          </div>
        )}

        {messages.map((message, index) => (
          <div key={index} className={message.role === 'user' ? 'flex justify-end' : ''}>
            {message.role === 'user' ? (
              <div className="max-w-3xl rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white">
                {message.text}
              </div>
            ) : (
              <div className="w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <ResponseCard
                  response={message.response}
                  saveState={memorySaveState[index]}
                  onSaveMemory={(candidate) => saveMemoryCandidate(index, candidate)}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
