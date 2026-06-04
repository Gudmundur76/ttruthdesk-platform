/**
 * verticalAdapters/plantBasedProtein.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Plant-Based Protein vertical adapter.
 *
 * Verifies claims about plant protein sources (soy, pea, rice, hemp, lentil,
 * quinoa, etc.) and their nutritional profiles, bioavailability, and health
 * outcomes compared to animal protein.
 *
 * Evidence sources:
 *  1. PubMed — RCT and meta-analysis evidence for health outcomes
 *  2. USDA FoodData Central — nutrient composition data
 */
import { registerVertical, type VerticalAdapter, type EvidenceResult } from "./types";

// ─── USDA FoodData Central lookup ────────────────────────────────────────────

interface USDAFoodItem {
  fdcId: number;
  description: string;
  dataType: string;
}

async function searchUSDAFood(foodName: string): Promise<USDAFoodItem | null> {
  try {
    const encoded = encodeURIComponent(foodName);
    // USDA FoodData Central public API (no key required for basic search)
    const res = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encoded}&pageSize=1&api_key=DEMO_KEY`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as { foods?: USDAFoodItem[] };
    return data.foods?.[0] ?? null;
  } catch {
    return null;
  }
}

async function searchPlantProteinRCTs(
  proteinSource: string,
  outcome: string
): Promise<{ count: number; pmids: string[] }> {
  try {
    const query = encodeURIComponent(
      `"${proteinSource}" protein ${outcome} AND (randomized controlled trial[pt] OR meta-analysis[pt] OR systematic review[pt])`
    );
    const res = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${query}&retmax=5&retmode=json`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return { count: 0, pmids: [] };
    const data = await res.json() as { esearchresult?: { idlist?: string[]; count?: string } };
    return {
      count: parseInt(data.esearchresult?.count ?? "0", 10),
      pmids: data.esearchresult?.idlist ?? [],
    };
  } catch {
    return { count: 0, pmids: [] };
  }
}

// ─── Plant protein source identification ─────────────────────────────────────

const PLANT_PROTEIN_SOURCES: Record<string, string> = {
  "soy": "soy protein",
  "soya": "soy protein",
  "pea": "pea protein",
  "rice": "rice protein",
  "hemp": "hemp protein",
  "lentil": "lentil protein",
  "quinoa": "quinoa protein",
  "chickpea": "chickpea protein",
  "lupin": "lupin protein",
  "potato": "potato protein",
  "mycoprotein": "mycoprotein",
  "quorn": "mycoprotein",
  "spirulina": "spirulina protein",
  "chlorella": "chlorella protein",
};

function classifyPlantOutcome(claimText: string): string {
  const lower = claimText.toLowerCase();
  if (lower.includes("muscle") || lower.includes("lean mass") || lower.includes("mps")) return "muscle protein synthesis";
  if (lower.includes("cardiovascular") || lower.includes("ldl") || lower.includes("cholesterol")) return "cardiovascular";
  if (lower.includes("diabetes") || lower.includes("glucose") || lower.includes("insulin")) return "glycaemic";
  if (lower.includes("weight") || lower.includes("obesity") || lower.includes("bmi")) return "weight management";
  if (lower.includes("bioavailability") || lower.includes("pdcaas") || lower.includes("diaas")) return "bioavailability";
  if (lower.includes("environment") || lower.includes("carbon") || lower.includes("sustainability")) return "sustainability";
  return "general health";
}

const plantBasedProteinAdapter: VerticalAdapter = {
  domainKey: "plant_based_protein",
  displayName: "Plant-Based Protein",
  description:
    "Verifies claims about plant protein sources (soy, pea, rice, hemp, lentil, quinoa, mycoprotein) " +
    "including nutritional composition, bioavailability scores (PDCAAS, DIAAS), " +
    "and health outcomes. Uses USDA FoodData Central for nutrient data and PubMed for clinical evidence.",

  claimExtractorPrompt: `
You are a plant-based protein research claim extractor. Extract every verifiable claim from the text.
Focus on:
- Protein sources: soy, pea, rice, hemp, lentil, quinoa, chickpea, lupin, potato, mycoprotein, spirulina
- Nutritional claims: protein content (g/100g), essential amino acid profile, leucine content (g/100g protein)
- Bioavailability claims: PDCAAS score (0-1), DIAAS score (0-1), digestibility (%)
- Health outcome claims: muscle protein synthesis rate, lean mass gain, cardiovascular risk markers
- Comparison claims: plant vs animal protein equivalence, combining plant proteins
- Environmental claims: carbon footprint (kg CO2e/kg protein), water usage, land use
- Processing claims: isolate vs concentrate vs whole food, anti-nutritional factors (phytates, trypsin inhibitors)
For each claim, extract: the protein source, the claimed property/outcome, the value, and the comparison (if any).
`,

  discoverySearchTerms: [
    "soy protein muscle synthesis RCT meta-analysis",
    "pea protein bioavailability DIAAS clinical study",
    "plant protein cardiovascular risk systematic review",
    "plant vs animal protein muscle mass RCT",
    "mycoprotein muscle protein synthesis trial",
  ],

  async lookupEvidence(claim): Promise<EvidenceResult> {
    const claimLower = claim.claimText.toLowerCase();

    // Identify plant protein source
    let matchedSource: string | null = null;
    for (const [keyword, name] of Object.entries(PLANT_PROTEIN_SOURCES)) {
      if (claimLower.includes(keyword)) {
        matchedSource = name;
        break;
      }
    }

    const outcome = classifyPlantOutcome(claim.claimText);

    const [usdaResult, rctResult] = await Promise.all([
      matchedSource ? searchUSDAFood(matchedSource) : Promise.resolve(null),
      searchPlantProteinRCTs(
        matchedSource ?? "plant protein",
        outcome
      ),
    ]);

    const flags: string[] = [];
    let score = 0.35;

    // Soy protein has the strongest evidence base among plant proteins
    if (matchedSource === "soy protein") {
      score = 0.70;
      flags.push("Soy protein: extensive clinical evidence base");
    }

    if (rctResult.count >= 10) {
      score = Math.max(score, 0.85);
      flags.push(`${rctResult.count} RCTs/meta-analyses found`);
    } else if (rctResult.count >= 3) {
      score = Math.max(score, 0.68);
      flags.push(`${rctResult.count} RCTs found`);
    } else if (rctResult.count >= 1) {
      score = Math.max(score, 0.50);
      flags.push(`${rctResult.count} RCT found`);
    } else {
      flags.push("No RCTs found for this specific plant protein claim");
    }

    if (usdaResult) {
      score = Math.min(score + 0.04, 0.90);
      flags.push(`USDA FoodData Central: ${usdaResult.description} (FDC ID ${usdaResult.fdcId})`);
    }

    return {
      found: rctResult.count > 0 || usdaResult !== null,
      sourceId: rctResult.pmids[0]
        ? `PMID:${rctResult.pmids[0]}`
        : usdaResult
        ? `FDC:${usdaResult.fdcId}`
        : null,
      sourceUrl: rctResult.pmids[0]
        ? `https://pubmed.ncbi.nlm.nih.gov/${rctResult.pmids[0]}/`
        : usdaResult
        ? `https://fdc.nal.usda.gov/fdc-app.html#/?fdcId=${usdaResult.fdcId}`
        : null,
      evidenceRaw: {
        proteinSource: matchedSource,
        outcome,
        rctCount: rctResult.count,
        topPmids: rctResult.pmids,
        usdaFdcId: usdaResult?.fdcId ?? null,
        usdaDescription: usdaResult?.description ?? null,
      },
      confidenceScore: score,
      confidenceFlags: flags,
    };
  },
};

registerVertical(plantBasedProteinAdapter);
