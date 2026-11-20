// Types shared between server and web. Declaration-only, so it never needs a build step.

export interface Upload {
  id: number;
  filename: string;
  uploadedAt: string;
  rowCount: number;
}

/** Row as shown in the UI table. */
export interface PublicationRow {
  id: number;
  title: string;
  publisher: string | null;
  category: string | null;
  entity: string | null;
  sourceUrl: string | null;
  summary: string | null;
  impressions: number | null;
}

export type SortField = 'impressions' | 'title' | 'publisher' | 'category';
export type SortOrder = 'asc' | 'desc';

/** Category filter token that matches rows with an empty Category. */
export type NoCategory = '__none__';

export interface PublicationsQuery {
  publisher?: string[];
  /** AI topic id: only publications of that topic. */
  topic?: number;
  /** Category paths (each includes all descendants) and/or NoCategory. */
  category?: string[];
  sort?: SortField;
  order?: SortOrder;
  page?: number;
  pageSize?: number;
}

export interface PublicationsPage {
  items: PublicationRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PublisherFacet {
  publisher: string;
  count: number;
}

export interface CategoryNode {
  /** Last path segment, e.g. "Soccer". */
  name: string;
  /** Full path, e.g. "/Sports/Team Sports/Soccer". */
  path: string;
  /** Rows in this category including all descendants. */
  count: number;
  children: CategoryNode[];
}

export interface Facets {
  /** Publisher counts with the category filter applied. */
  publishers: PublisherFacet[];
  /** Category tree with the publisher filter applied. */
  categories: CategoryNode[];
  uncategorized: number;
}

export interface ApiError {
  error: string;
}

// ---------- AI analysis ----------

export type AnalysisStatus = 'queued' | 'running' | 'done' | 'failed';
export type AnalysisStep = 'prefilter' | 'map' | 'reduce' | 'score' | 'synth' | 'done';

export interface AnalysisRun {
  id: number;
  uploadId: number;
  provider: string;
  mapModel: string;
  synthModel: string;
  status: AnalysisStatus;
  step: AnalysisStep;
  progressDone: number;
  progressTotal: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** Publications left out: refused by the model (moderation) or skipped to finish the run. */
  skipped: number;
  /** The run was finished with what had been processed, skipping the rest. */
  partial: boolean;
}

export interface TopicInterest {
  id: number;
  name: string;
  /** Publications of the topic tagged with this interest. */
  count: number;
}

export interface ContentIdea {
  title: string;
  format: string;
  angle: string;
  hook: string;
  /** Headlines generated on demand for this idea, newest first. */
  headlines?: Headline[];
}

/** A concrete UGC piece for an idea: a story or list a user could write. */
export interface Headline {
  title: string;
  /** One sentence on what the piece is about. */
  pitch: string;
}

export interface RelatedTopic {
  id: number;
  title: string;
  why: string;
}

export interface Topic {
  id: number;
  rank: number;
  title: string;
  audienceScore: number;
  impressions: number;
  publications: number;
  publishers: number;
  interests: TopicInterest[];
  whyTrending: string | null;
  interestsReason: string | null;
  ideas: ContentIdea[];
  related: RelatedTopic[];
  /** Why the topic has no insights (model refused or it was skipped), else null. */
  synthError: string | null;
}

export interface InterestCoverage {
  id: number;
  name: string;
  /** Top topics that match this interest. */
  topics: number;
  impressions: number;
}

export interface AnalysisResult {
  run: AnalysisRun;
  /** Ranked top topics; empty until the run is done. */
  topics: Topic[];
  /** Every DMP interest, including ones with no topics. */
  coverage: InterestCoverage[];
}

// ---------- Settings ----------

/** LLM settings as the UI sees them; the API key itself is never returned. */
export interface LlmSettings {
  provider: string;
  yandexFolderId: string;
  yandexApiKeySet: boolean;
  /** Last characters of the saved key, e.g. "…x7Qz". */
  yandexApiKeyHint: string;
}

export interface LlmSettingsUpdate {
  /** Omitted: keep; empty string: clear. */
  yandexApiKey?: string;
  yandexFolderId?: string;
}
