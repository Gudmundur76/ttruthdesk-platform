import { registerVertical, VerticalAdapter, EvidenceResult } from './types';

const ARXIV_ID_REGEX = /(\d{4}\.\d{4,5})/; // Matches patterns like 1234.56789 or 1234.5678

const arxivAdapter: VerticalAdapter = {
  domainKey: 'arxiv',
  displayName: 'arXiv preprints',
  description: 'Adapter for https://arxiv.org/',
  claimExtractorPrompt: 'Extract any arXiv IDs (e.g., 1234.56789) or keywords from the following claim for searching scientific preprints.',
  discoverySearchTerms: ['machine learning', 'physics', 'mathematics', 'computer science', 'quantitative biology'],

  async lookupEvidence(claim: { claimText: string; extractedValue: string | null }): Promise<EvidenceResult> {
    let query = '';
    const arxivIdMatch = claim.claimText.match(ARXIV_ID_REGEX);

    if (arxivIdMatch && arxivIdMatch[1]) {
      query = `id:${arxivIdMatch[1]}`;
    } else if (claim.extractedValue) {
      query = claim.extractedValue;
    } else {
      query = claim.claimText;
    }

    if (!query) {
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.0,
        confidenceFlags: ['no_search_query_generated'],
      };
    }

    const apiUrl = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&max_results=3`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(apiUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'citation-engine/1.0 (citation-engine@citation.is)',
          'Accept': 'application/atom+xml'
        },
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const xmlText = await response.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

      const entries = xmlDoc.querySelectorAll('entry');

      if (entries.length === 0) {
        return {
          found: false,
          sourceId: null,
          sourceUrl: null,
          evidenceRaw: null,
          confidenceScore: 0.1,
          confidenceFlags: ['no_arxiv_entries_found'],
        };
      }

      const firstEntry = entries[0];
      const title = firstEntry.querySelector('title')?.textContent || 'No Title';
      const summary = firstEntry.querySelector('summary')?.textContent || 'No Summary';
      const idLink = firstEntry.querySelector('id')?.textContent || '';
      const arxivId = idLink.split('/').pop() ?? null;
      const primaryLink = firstEntry.querySelector('link[rel="alternate"]')?.getAttribute('href') || null;
      const journalRef = firstEntry.querySelector('arxiv\\:journal_ref, journal_ref')?.textContent || null;

      let confidenceScore = 0.65; // Default for preprints
      const confidenceFlags: string[] = ['arxiv_preprint'];

      if (journalRef) {
        confidenceScore = 0.80; // Higher confidence if published journal ref present
        confidenceFlags.push('published_journal_reference');
      }

      return {
        found: true,
        sourceId: arxivId,
        sourceUrl: primaryLink,
        evidenceRaw: {
          title,
          summary,
          arxivId,
          primaryLink,
          journalRef,
        },
        confidenceScore,
        confidenceFlags,
      };

    } catch (error: any) {
      console.error(`Error fetching from arXiv: ${error.message}`);
      return {
        found: false,
        sourceId: null,
        sourceUrl: null,
        evidenceRaw: null,
        confidenceScore: 0.2,
        confidenceFlags: ['network_error_or_api_failure'],
      };
    }
  },
};

registerVertical(arxivAdapter);
