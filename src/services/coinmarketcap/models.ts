export interface Asset {
  name: string;
  coinId: string;
  type: string;
}

export interface Meta {
  title: string;
  subtitle: string;
  content: string;
  sourceName: string;
  maxChar: number;
  language: string;
  status: string;
  type: string;
  visibility: boolean;
  sourceUrl: string;
  createdAt: string;
  updatedAt: string;
  releasedAt: string;
}

export interface Article {
  slug: string;
  cover?: string;
  assets: Asset[];
  createdAt: string;
  meta: Meta;
}
