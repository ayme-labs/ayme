export interface PageActivitySource {
  subscribe(onActivity: () => void): () => void;
}
