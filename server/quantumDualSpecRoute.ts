/**
 * quantumDualSpecRoute.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Serves the QUANTUM_DUAL trust tier specification as a versioned JSON-LD
 * document at /spec/quantum-dual/v1.
 *
 * This endpoint turns the QUANTUM_DUAL feature into a citable, referenceable
 * standard that other systems (asi-evolve, citation.is, external agents) can
 * verify against.
 *
 * Served at:
 *   GET /spec/quantum-dual/v1
 *   GET /spec/quantum-dual/v1.json  (alias)
 *
 * Content-Type: application/ld+json
 * Cache-Control: public, max-age=86400 (24h — spec is versioned, not mutable)
 */

import type { Express, Request, Response } from "express";

/** The canonical QUANTUM_DUAL v1 specification document */
const QUANTUM_DUAL_SPEC_V1 = {
  "@context": {
    "@vocab": "https://schema.org/",
    qd: "https://truthdesk.claims/spec/quantum-dual/v1#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
  },
  "@type": "TechArticle",
  "@id": "https://truthdesk.claims/spec/quantum-dual/v1",
  name: "QUANTUM_DUAL Trust Tier Specification v1",
  version: "1.0.0",
  datePublished: "2026-06-22",
  description:
    "Formal specification for the QUANTUM_DUAL provenance trust tier in the Truth Desk verification engine. Defines activation criteria, hardware requirements, scoring thresholds, and citation registry behaviour.",
  author: {
    "@type": "Organization",
    name: "Truth Desk",
    url: "https://truthdesk.claims",
  },

  // ── Trust tier hierarchy ───────────────────────────────────────────────────
  "qd:trustTierHierarchy": [
    {
      "qd:tier": "QUANTUM_DUAL",
      "qd:priorityScore": 0.9,
      "qd:activationCriteria": {
        "qd:provenanceStatus": "quantum-hardware",
        "qd:requiredSources": ["wukong-vqe", "jiuzhang-gbs"],
        "qd:minimumVqeEnergy": { "@type": "xsd:float", "@value": -2.0 },
        "qd:minimumGbsSimilarity": { "@type": "xsd:float", "@value": 0.7 },
      },
      "qd:description":
        "Both WuKong VQE energy and Jiuzhang GBS similarity confirmed by real quantum hardware API calls. The highest provenance trust level in the system.",
    },
    {
      "qd:tier": "QUANTUM_READY",
      "qd:priorityScore": 0.75,
      "qd:activationCriteria": {
        "qd:provenanceStatus": "quantum-architecture",
        "qd:requiredSources": ["asi-evolve"],
        "qd:description":
          "Quantum-architecture-ready: VQE and GBS scores present from asi-evolve, but not yet confirmed by direct quantum hardware API calls. Upgrades to QUANTUM_DUAL automatically when hardware job completes.",
      },
    },
    {
      "qd:tier": "QUANTUM_SINGLE",
      "qd:priorityScore": 0.6,
      "qd:activationCriteria": {
        "qd:provenanceStatus": "quantum-architecture",
        "qd:requiredSources": ["asi-evolve"],
        "qd:onlyOneOf": ["wukong-vqe", "jiuzhang-gbs"],
      },
      "qd:description":
        "Only one of VQE or GBS score is present. Lower confidence than QUANTUM_READY.",
    },
    {
      "qd:tier": "STANDARD",
      "qd:priorityScore": 0.3,
      "qd:activationCriteria": {
        "qd:provenanceStatus": "classical",
      },
      "qd:description":
        "No quantum scores present. Classical verification only.",
    },
  ],

  // ── Provenance status lifecycle ────────────────────────────────────────────
  "qd:provenanceStatusLifecycle": {
    "quantum-architecture": {
      "qd:meaning":
        "VQE and/or GBS scores are present from asi-evolve, but no direct quantum hardware API call has been confirmed for this specific claim.",
      "qd:upgradePath": "quantum-hardware",
      "qd:upgradeCondition":
        "A WuKong hardware job (quantum_vqe_jobs.status = done) completes for the associated citation edge.",
    },
    "quantum-hardware": {
      "qd:meaning":
        "A real quantum hardware API call (WuKong VQE via pyqpanda3 QCloudService) has been confirmed for this claim. The VQE energy is a direct measurement from the WK_C180_2 superconducting chip.",
      "qd:upgradePath": null,
    },
    classical: {
      "qd:meaning":
        "No quantum scores. Standard multi-source verification only.",
      "qd:upgradePath": "quantum-architecture",
    },
  },

  // ── Hardware sources ───────────────────────────────────────────────────────
  "qd:hardwareSources": [
    {
      "qd:sourceId": "wukong-vqe",
      "qd:name": "WuKong Superconducting Quantum Computer",
      "qd:operator": "Origin Quantum (本源量子)",
      "qd:backend": "WK_C180_2",
      "qd:qubits": 180,
      "qd:nativeGates": ["RPHI", "CZ"],
      "qd:apiSdk": "pyqpanda3",
      "qd:apiEndpoint": "https://qcloud.originqc.com.cn",
      "qd:scoreField": "pic50_vqe",
      "qd:scoreUnit": "Hartree (ground-state energy)",
      "qd:referenceUrl":
        "https://qcloud.originqc.com.cn/document/pyqpanda3-docs/en/",
    },
    {
      "qd:sourceId": "jiuzhang-gbs",
      "qd:name": "Jiuzhang 4.0 Photonic Quantum Computer",
      "qd:operator": "USTC / Jiuzhang Quantum Technology Co. Ltd.",
      "qd:photons": 3050,
      "qd:modes": 8176,
      "qd:speedupVsClassical": "10^54 (vs El Capitan + MPS algorithm)",
      "qd:scoreField": "similarity_search",
      "qd:scoreUnit": "GBS similarity (0–1)",
      "qd:referenceUrl": "https://doi.org/10.1038/s41586-026-10523-6",
      "qd:accessStatus": "research-partnership — not yet self-serve API",
    },
  ],

  // ── Gap type ───────────────────────────────────────────────────────────────
  "qd:gapType": "quantum_provenance",
  "qd:gapTypeDescription":
    "A knowledge gap of type quantum_provenance is created by the Frontier Engine when a claim has QUANTUM_READY or QUANTUM_DUAL provenance. These gaps are prioritised above evidence gaps (multiplier 0.75 vs 0.5) in the gap ranker.",

  // ── Dream layer contradiction class ───────────────────────────────────────
  "qd:contradictionClass": "quantum_dual_contradiction",
  "qd:contradictionClassDescription":
    "A dream layer contradiction logged to frontier_log when a QUANTUM_DUAL claim receives a Contradicted verdict. Triggers priority re-verification in the next Frontier Engine cycle.",

  // ── Citation registry behaviour ────────────────────────────────────────────
  "qd:citationRegistryBehaviour": {
    "qd:badgeLabel": {
      "quantum-hardware": "QUANTUM-DUAL",
      "quantum-architecture": "QUANTUM-READY",
      classical: null,
    },
    "qd:badgeColour": {
      "quantum-hardware": "violet (pulsing)",
      "quantum-architecture": "amber",
    },
    "qd:registryField": "provenance_status",
    "qd:registryTable": "citation_edges.quantumProvenance (JSON column)",
  },
};

export function registerQuantumDualSpecRoute(app: Express): void {
  const handler = (_req: Request, res: Response): void => {
    res.set({
      "Content-Type": "application/ld+json; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    });
    res.json(QUANTUM_DUAL_SPEC_V1);
  };

  // Primary path
  app.get("/spec/quantum-dual/v1", handler);
  // JSON alias (for direct browser/curl access)
  app.get("/spec/quantum-dual/v1.json", handler);
}
