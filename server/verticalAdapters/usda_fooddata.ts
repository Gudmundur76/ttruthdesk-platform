import { registerVertical, EvidenceResult, VerticalAdapter } from "./types";
import { logger } from "../logger";

const log = logger("verticalAdapters/usda_fooddata");

interface FoodItem {
  fdcId: number;
  description: string;
  dataType?: string;
  brandOwner?: string;
  foodNutrients?: Array<{ nutrientName: string; value: number; unitName: string }>;
  score?: number;
}

interface FoodDataResponse {
  foods?: FoodItem[];
  totalHits?: number;
}

class UsdaFooddataAdapter implements VerticalAdapter {
  readonly domainKey = "usda_fooddata";
  readonly displayName = "USDA FoodData Central";
  readonly description =
    "US Department of Agriculture food composition data — nutrient content, dietary reference intakes, food labeling";
  readonly claimExtractorPrompt =
    "Extract food names, nutrient names (e.g., vitamin C, protein, omega-3), or dietary claims from the claim.";
  readonly discoverySearchTerms = [
    "food nutrient content",
    "dietary intake",
    "nutrition label",
    "USDA food composition",
    "vitamin mineral content",
    "protein content food",
    "caloric value",
  ];

  private readonly BASE_URL = "https://api.nal.usda.gov/fdc/v1";
  private readonly API_KEY = "DEMO_KEY";
  private readonly USER_AGENT = "citation.is/1.0 (verification@citation.is)";

  async lookupEvidence(claim: {
    claimText: string;
    extractedValue: string | null;
  }): Promise<EvidenceResult> {
    const blank: EvidenceResult = {
      found: false,
      sourceId: null,
      sourceUrl: null,
      evidenceRaw: null,
      confidenceScore: 0,
      confidenceFlags: [],
    };

    try {
      const q = claim.extractedValue ?? claim.claimText.slice(0, 150);
      const url = `${this.BASE_URL}/foods/search?query=${encodeURIComponent(q)}&pageSize=5&api_key=${this.API_KEY}`;

      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": this.USER_AGENT },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        return { ...blank, confidenceFlags: [`http_error_${res.status}`] };
      }

      const data = (await res.json()) as FoodDataResponse;
      const foods = data?.foods ?? [];

      if (!foods.length) {
        return { ...blank, confidenceFlags: ["no_usda_results"] };
      }

      const top = foods[0];
      const sourceUrl = `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${top.fdcId}/nutrients`;

      const flags: string[] = ["usda_official_food_data"];
      if (top.dataType === "SR Legacy") flags.push("usda_sr_legacy_reference");
      if (top.dataType === "Foundation") flags.push("usda_foundation_food");
      if (top.dataType === "Survey (FNDDS)") flags.push("usda_survey_data");
      if ((data.totalHits ?? 0) > 20) flags.push("high_result_count");

      log.info("USDA FoodData result", { fdcId: top.fdcId, description: top.description });

      return {
        found: true,
        sourceId: `fdc-${top.fdcId}`,
        sourceUrl,
        evidenceRaw: {
          fdcId: top.fdcId,
          description: top.description,
          dataType: top.dataType,
          topNutrients: top.foodNutrients?.slice(0, 5),
        },
        confidenceScore: 0.88,
        confidenceFlags: flags,
      };
    } catch (err) {
      log.error("USDA FoodData fetch error", { err: String(err) });
      return { ...blank, confidenceFlags: ["network_or_parsing_error"] };
    }
  }
}

registerVertical(new UsdaFooddataAdapter());
