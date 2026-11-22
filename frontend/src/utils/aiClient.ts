import type { AiProvider } from '../stores/useSettingsStore';
import { WorkspaceService } from '../../bindings/dhub/internal/services';

export interface AiChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface SendAiChatParams {
  provider: AiProvider;
  apiKey: string;
  baseUrl?: string;
  model: string;
  systemPrompt: string;
  messages: AiChatHistoryItem[];
}

export const AI_PROVIDER_DEFAULTS: Record<
  AiProvider,
  { label: string; defaultModel: string; defaultBaseUrl: string; models: string[] }
> = {
  openai: {
    label: 'OpenAI / Compatible',
    defaultModel: 'gpt-4o-mini',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'o4-mini', 'llama3.2', 'qwen2.5-coder', 'deepseek-chat'],
  },
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-3.8-flash',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: [
      'gemini-4-hydrogen',
      'gemini-4-argon',
      'gemini-3.8-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-pro-preview',
    ],
  },
};

function resolveOpenAiEndpoint(baseUrl?: string): string {
  const raw = (baseUrl || '').trim() || AI_PROVIDER_DEFAULTS.openai.defaultBaseUrl;
  const clean = raw.replace(/\/+$/, '');
  if (clean.endsWith('/chat/completions')) {
    return clean;
  }
  return `${clean}/chat/completions`;
}

export interface DhubOpenTableAction {
  action: 'open_table';
  table: string;
  where?: string;
  sort?: { column: string; direction: 'asc' | 'desc' }[];
}

export interface DhubOpenConsoleAction {
  action: 'open_console';
  title?: string;
  sql: string;
}

export type DhubAiAction = DhubOpenTableAction | DhubOpenConsoleAction;

function normalizeSingleAction(parsed: any): DhubAiAction | null {
  if (!parsed || typeof parsed !== 'object') return null;
  if (
    parsed.action === 'open_table' &&
    typeof parsed.table === 'string' &&
    parsed.table.trim()
  ) {
    const sort = Array.isArray(parsed.sort)
      ? parsed.sort
          .filter((s: any) => s && typeof s.column === 'string' && s.column.trim())
          .map((s: any) => ({
            column: s.column.trim(),
            direction:
              String(s.direction).toLowerCase() === 'desc'
                ? ('desc' as const)
                : ('asc' as const),
          }))
      : undefined;
    return {
      action: 'open_table',
      table: parsed.table.trim().replace(/^[`"\[]|[`"\]]$/g, ''),
      where: typeof parsed.where === 'string' ? parsed.where.trim() : undefined,
      sort: sort && sort.length > 0 ? sort : undefined,
    };
  }
  if (
    parsed.action === 'open_console' &&
    typeof parsed.sql === 'string' &&
    parsed.sql.trim()
  ) {
    return {
      action: 'open_console',
      title: typeof parsed.title === 'string' ? parsed.title.trim() : undefined,
      sql: parsed.sql.trim(),
    };
  }
  return null;
}

function tryParseActionJson(jsonBody: string): DhubAiAction[] {
  try {
    const parsed = JSON.parse(jsonBody.trim());
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeSingleAction).filter((a): a is DhubAiAction => a !== null);
    }
    const single = normalizeSingleAction(parsed);
    return single ? [single] : [];
  } catch {
    return [];
  }
}

export function parseAiResponse(text: string): {
  displayText: string;
  sqlSnippet?: string;
  actions: DhubAiAction[];
} {
  let working = text;
  const actions: DhubAiAction[] = [];

  // Extract ```dhub-action ... ``` or ```json ... ``` blocks containing valid DHub actions
  working = working.replace(/```(?:dhub-action|json)?\s*([\s\S]*?)```/gi, (fullMatch, body: string) => {
    const parsedActions = tryParseActionJson(body);
    if (parsedActions.length > 0) {
      actions.push(...parsedActions);
      return '';
    }
    return fullMatch;
  });

  const sqlMatch = working.match(
    /```(?:sql|pgsql|postgresql|mysql|sqlite|tsql|plsql|mongodb|json)?\s*\n([\s\S]*?)```/i
  );
  let sqlSnippet: string | undefined;
  if (sqlMatch) {
    sqlSnippet = sqlMatch[1].trim() || undefined;
    working = working.replace(sqlMatch[0], '');
  }

  const displayText =
    working.trim() ||
    (actions.length > 0
      ? 'Siap, aksi dijalankan.'
      : sqlSnippet
      ? 'Berikut query yang disarankan:'
      : text.trim());

  return { displayText, sqlSnippet, actions };
}

export function extractSqlFromMarkdown(text: string): {
  displayText: string;
  sqlSnippet?: string;
} {
  const { displayText, sqlSnippet } = parseAiResponse(text);
  return { displayText, sqlSnippet };
}

export function logAiToTerminal(label: string, data: unknown) {
  try {
    const formatted = `${label}\n${JSON.stringify(data, null, 2)}`;
    WorkspaceService.SaveSetting('__ai_debug_log__', formatted).catch(() => {});
  } catch {}
}

export async function sendAiChatMessage(params: SendAiChatParams): Promise<string> {
  const { provider, apiKey, baseUrl, model, systemPrompt, messages } = params;
  const trimmedKey = apiKey.trim();
  const effectiveModel =
    model.trim() || AI_PROVIDER_DEFAULTS[provider].defaultModel;

  const hasCustomBaseUrl = Boolean((baseUrl || '').trim());

  if (provider === 'openai' && !hasCustomBaseUrl && !trimmedKey) {
    throw new Error('OpenAI API Key belum diisi. Silakan atur di Settings → AI Assistant.');
  }
  if (provider === 'gemini' && !trimmedKey) {
    throw new Error('Gemini API Key belum diisi. Silakan atur di Settings → AI Assistant.');
  }

  if (provider === 'gemini') {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      effectiveModel
    )}:generateContent?key=${encodeURIComponent(trimmedKey)}`;
    const payload = {
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    };

    logAiToTerminal('[DHub AI] Request (gemini):', {
      model: effectiveModel,
      endpoint: endpoint.replace(/key=[^&]+/, 'key=***'),
      payload,
    });

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    logAiToTerminal('[DHub AI] Response (gemini):', { status: res.status, data });
    if (!res.ok) {
      const msg = data?.error?.message || `Gemini API error (${res.status})`;
      throw new Error(msg);
    }

    const replyText = (data?.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p?.text || '')
      .join('')
      .trim();

    if (!replyText) {
      throw new Error('Gemini mengembalikan respons kosong.');
    }
    return replyText;
  }

  // OpenAI & OpenAI-compatible
  const endpoint = resolveOpenAiEndpoint(baseUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (trimmedKey) {
    headers['Authorization'] = `Bearer ${trimmedKey}`;
  }

  const payload = {
    model: effectiveModel,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  };

  logAiToTerminal(`[DHub AI] Request (${provider}):`, {
    model: effectiveModel,
    endpoint,
    payload,
  });

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  logAiToTerminal(`[DHub AI] Response (${provider}):`, { status: res.status, data });
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `API error (${res.status})`;
    throw new Error(msg);
  }

  const replyText = data?.choices?.[0]?.message?.content?.trim();
  if (!replyText) {
    throw new Error('Model mengembalikan respons kosong.');
  }
  return replyText;
}
