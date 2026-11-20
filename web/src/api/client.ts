import type {
  AnalysisResult,
  AnalysisRun,
  Facets,
  Headline,
  LlmSettings,
  LlmSettingsUpdate,
  PublicationsPage,
  PublicationsQuery,
  Upload,
} from '@dcvr/shared';

export class ApiError extends Error {}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `Ошибка ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

function toSearch(query: PublicationsQuery): string {
  const params = new URLSearchParams();
  query.publisher?.forEach((p) => params.append('publisher', p));
  query.category?.forEach((c) => params.append('category', c));
  if (query.topic) params.set('topic', String(query.topic));
  if (query.sort) params.set('sort', query.sort);
  if (query.order) params.set('order', query.order);
  if (query.page) params.set('page', String(query.page));
  if (query.pageSize) params.set('pageSize', String(query.pageSize));
  return params.toString();
}

export const api = {
  listUploads: () => request<Upload[]>('/api/uploads'),

  createUpload: (file: File) => {
    const body = new FormData();
    body.append('file', file);
    return request<Upload>('/api/uploads', { method: 'POST', body });
  },

  deleteUpload: (id: number) => request<void>(`/api/uploads/${id}`, { method: 'DELETE' }),

  listPublications: (uploadId: number, query: PublicationsQuery) =>
    request<PublicationsPage>(`/api/uploads/${uploadId}/publications?${toSearch(query)}`),

  getFacets: (
    uploadId: number,
    filters: Pick<PublicationsQuery, 'publisher' | 'category' | 'topic'>,
  ) => request<Facets>(`/api/uploads/${uploadId}/facets?${toSearch(filters)}`),

  getAnalysis: (uploadId: number) =>
    request<AnalysisResult | null>(`/api/uploads/${uploadId}/analysis`),

  startAnalysis: (uploadId: number) =>
    request<AnalysisRun>(`/api/uploads/${uploadId}/analysis`, { method: 'POST' }),

  resumeAnalysis: (runId: number) =>
    request<AnalysisRun>(`/api/analysis/${runId}/resume`, { method: 'POST' }),

  getSettings: () => request<LlmSettings>('/api/settings'),

  saveSettings: (update: LlmSettingsUpdate) =>
    request<LlmSettings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    }),

  testSettings: () =>
    request<{ ok: true; provider: string }>('/api/settings/test', { method: 'POST' }),

  generateHeadlines: (topicId: number, ideaIndex: number) =>
    request<{ headlines: Headline[] }>(`/api/topics/${topicId}/ideas/${ideaIndex}/headlines`, {
      method: 'POST',
    }),

  finishAnalysis: (runId: number) =>
    request<AnalysisRun>(`/api/analysis/${runId}/finish`, { method: 'POST' }),
};
