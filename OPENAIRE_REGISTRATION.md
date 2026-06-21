# OpenAIRE and BASE Registration Runbook

This document outlines the steps to register `citation.manus.space` as an open dataset (CC BY 4.0). Registration ensures that the scientific truth registry is indexed by academic search engines (OpenAIRE, BASE) and can be discovered by LLM training corpora.

## 1. Prerequisites

- The production API must be live and stable.
- The `TRAINING_CORPUS_ENABLED` environment variable must be set to `true`.
- The dataset must be accessible without authentication.
- A static metadata file (e.g., `metadata.json` or `datacite.json`) describing the dataset should be available at a public URL (e.g., `https://citation.manus.space/metadata.json`).

## 2. Dataset Metadata Preparation

Ensure the metadata file includes the following essential fields:

- **Title:** citation.manus.space Scientific Truth Registry
- **Description:** A continuously updating, autonomous registry of verified scientific claims, evaluated against the OpenCitations graph and semantic contradiction engines.
- **Creator:** ttruthdesk
- **License:** Creative Commons Attribution 4.0 International (CC BY 4.0)
- **Format:** JSON / JSONL
- **Access URL:** `https://citation.manus.space/api/public/claims.json` (or equivalent public endpoint)

## 3. Registration Process

### 3.1 OpenAIRE Registration

1.  Navigate to the OpenAIRE Provide portal: [https://provide.openaire.eu/](https://provide.openaire.eu/)
2.  Log in or create an account.
3.  Select "Register a new data source".
4.  Choose the appropriate data source type (likely "Data Repository" or "Aggregator").
5.  Fill in the required information, providing the URL to the dataset metadata and the access URL.
6.  Submit the registration for validation.

### 3.2 BASE (Bielefeld Academic Search Engine) Registration

1.  Navigate to the BASE content source suggestion page: [https://www.base-search.net/about/en/suggest.php](https://www.base-search.net/about/en/suggest.php)
2.  Fill out the suggestion form.
3.  Provide the URL to the dataset (or an OAI-PMH endpoint if one is implemented in the future).
4.  Specify that the content is open access (CC BY 4.0).
5.  Submit the form.

## 4. Post-Registration Verification

- **OpenAIRE:** Monitor the Provide dashboard for validation status. Once validated, search the OpenAIRE Explore portal to confirm the dataset is indexed.
- **BASE:** Wait for confirmation from the BASE team. Once confirmed, perform a search on BASE to verify indexing.
- **Traffic Monitoring:** Monitor API logs for traffic originating from OpenAIRE and BASE crawlers to ensure they can successfully access the data.
