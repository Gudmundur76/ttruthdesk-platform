-- Migration 0063: MRAgent FactCheck fields
-- Adds 4 new columns to support the FactCheckAssembler output format
-- (mapped from the Ornith-1.0 fact-check document schema)
--
-- documents:
--   factCheckPreamble  — introductory context paragraph for the fact-check report
--   overallVerdict     — top-level verdict string (e.g. "Mostly False", "True", "Misleading")
--   relevanceAnalysis  — JSON array of relevance notes per claim
--
-- claims:
--   sourceRefs         — JSON array of {pmid, doi, title, url} source references
--                        used by the FactCheckAssembler to build the reference list

ALTER TABLE `documents`
  ADD COLUMN `factCheckPreamble` TEXT NULL COMMENT 'Introductory context paragraph for the fact-check report',
  ADD COLUMN `overallVerdict` VARCHAR(64) NULL COMMENT 'Top-level verdict label (e.g. Mostly False, True, Misleading)',
  ADD COLUMN `relevanceAnalysis` JSON NULL COMMENT 'JSON array of relevance notes per claim';

ALTER TABLE `claims`
  ADD COLUMN `sourceRefs` JSON NULL COMMENT 'JSON array of {pmid,doi,title,url} source references for FactCheckAssembler';
