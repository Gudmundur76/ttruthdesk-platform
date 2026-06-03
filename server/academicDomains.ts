/**
 * Academic domain detection for automatic plan assignment.
 *
 * Strategy:
 * 1. Check exact known academic domains (specific universities)
 * 2. Check academic TLD suffixes (.edu, .ac.uk, .ac.nz, etc.)
 * 3. Check country-specific academic patterns (uni-*.de, *.edu.*, etc.)
 *
 * When a user signs in with a matching email, they are automatically
 * assigned the "academic" plan (unlimited audits, permanent).
 */

// ─── Exact academic domain suffixes (country-specific) ───────────────────────
// These are the official academic second-level domains used by universities
// and research institutes in each country.
const ACADEMIC_TLD_SUFFIXES: string[] = [
  // Global
  ".edu",
  // UK & Ireland
  ".ac.uk",
  ".ac.ie",
  // Australia & New Zealand
  ".edu.au",
  ".ac.nz",
  // Canada
  ".ca",           // many Canadian universities use .ca — checked with KNOWN_ACADEMIC list
  // Europe
  ".ac.at",        // Austria
  ".ac.be",        // Belgium
  ".ac.cy",        // Cyprus
  ".ac.il",        // Israel
  ".ac.in",        // India
  ".ac.id",        // Indonesia
  ".ac.jp",        // Japan
  ".ac.ke",        // Kenya
  ".ac.kr",        // South Korea
  ".ac.ma",        // Morocco
  ".ac.mw",        // Malawi
  ".ac.nz",        // New Zealand
  ".ac.pg",        // Papua New Guinea
  ".ac.pk",        // Pakistan
  ".ac.rs",        // Serbia
  ".ac.rw",        // Rwanda
  ".ac.th",        // Thailand
  ".ac.tz",        // Tanzania
  ".ac.ug",        // Uganda
  ".ac.uk",        // United Kingdom
  ".ac.za",        // South Africa
  ".ac.zw",        // Zimbabwe
  // Nordic countries
  ".hi.is",        // University of Iceland
  ".ru.is",        // Reykjavik University
  ".unak.is",      // University of Akureyri
  ".bifrost.is",   // Bifröst University
  ".lbhi.is",      // Agricultural University of Iceland
  ".holar.is",     // Hólar University
  ".hh.is",        // Haskoli Holum
  // Germany, Austria, Switzerland
  ".uni-muenchen.de",
  ".uni-heidelberg.de",
  ".tu-berlin.de",
  ".rwth-aachen.de",
  ".kit.edu",
  ".ethz.ch",
  ".epfl.ch",
  ".unibas.ch",
  ".uzh.ch",
  // France
  ".univ-paris1.fr",
  ".sorbonne-universite.fr",
  ".polytechnique.edu",
  ".ens.fr",
  // Netherlands
  ".uva.nl",
  ".vu.nl",
  ".tue.nl",
  ".rug.nl",
  ".leidenuniv.nl",
  ".tudelft.nl",
  // Scandinavia
  ".ku.dk",
  ".dtu.dk",
  ".chalmers.se",
  ".kth.se",
  ".su.se",
  ".uu.se",
  ".liu.se",
  ".uio.no",
  ".ntnu.no",
  ".uib.no",
  ".aalto.fi",
  ".helsinki.fi",
  ".oulu.fi",
  // Southern Europe
  ".upm.es",
  ".ub.edu",
  ".uam.es",
  ".unipd.it",
  ".unibo.it",
  ".polimi.it",
  ".unipi.it",
  ".ulisboa.pt",
  ".up.pt",
  ".uoa.gr",
  ".auth.gr",
  // Eastern Europe
  ".uw.edu.pl",
  ".agh.edu.pl",
  ".cvut.cz",
  ".cuni.cz",
  ".bme.hu",
  ".elte.hu",
  ".ubbcluj.ro",
  // Asia
  ".pku.edu.cn",
  ".tsinghua.edu.cn",
  ".fudan.edu.cn",
  ".sjtu.edu.cn",
  ".nus.edu.sg",
  ".ntu.edu.sg",
  ".u-tokyo.ac.jp",
  ".kyoto-u.ac.jp",
  ".osaka-u.ac.jp",
  ".iitb.ac.in",
  ".iitd.ac.in",
  ".iitm.ac.in",
  ".iisc.ac.in",
  ".snu.ac.kr",
  ".kaist.ac.kr",
  ".postech.ac.kr",
  // Latin America
  ".usp.br",
  ".unicamp.br",
  ".ufrj.br",
  ".unam.mx",
  ".uchile.cl",
  ".uba.ar",
  // Middle East
  ".technion.ac.il",
  ".weizmann.ac.il",
  ".huji.ac.il",
  ".kaust.edu.sa",
  ".aub.edu.lb",
  // Africa
  ".uct.ac.za",
  ".wits.ac.za",
  ".sun.ac.za",
  ".uonbi.ac.ke",
  // Research institutes (not universities but academic)
  ".mrc.ac.uk",
  ".crick.ac.uk",
  ".ebi.ac.uk",
  ".embl.de",
  ".mpg.de",
  ".cnrs.fr",
  ".inria.fr",
  ".csic.es",
  ".cnr.it",
];

// ─── Known specific academic domains (for ambiguous TLDs like .ca, .de) ──────
const KNOWN_ACADEMIC_DOMAINS: Set<string> = new Set([
  // Canadian universities
  "utoronto.ca",
  "ubc.ca",
  "mcgill.ca",
  "uwaterloo.ca",
  "ualberta.ca",
  "queensu.ca",
  "dal.ca",
  "uottawa.ca",
  "yorku.ca",
  "sfu.ca",
  "ucalgary.ca",
  "umanitoba.ca",
  "usask.ca",
  "uvic.ca",
  "concordia.ca",
  // German universities (generic .de)
  "uni-bonn.de",
  "uni-frankfurt.de",
  "uni-freiburg.de",
  "uni-hamburg.de",
  "uni-koeln.de",
  "uni-mainz.de",
  "uni-marburg.de",
  "uni-muenster.de",
  "uni-stuttgart.de",
  "uni-tuebingen.de",
  "fu-berlin.de",
  "hu-berlin.de",
  "lmu.de",
  "tum.de",
  // US research institutes
  "nih.gov",
  "ncbi.nlm.nih.gov",
  "broadinstitute.org",
  "salk.edu",
  "scripps.edu",
  "janelia.org",
  "cshl.edu",
  "mskcc.org",
  "dana-farber.org",
  "stjude.org",
  // UK research institutes
  "sanger.ac.uk",
  "babraham.ac.uk",
  "mrc-lmb.cam.ac.uk",
  // Iceland (non-.is academic)
  "decode.is",
]);

/**
 * Detect whether an email address belongs to an academic institution.
 * Returns true if the domain matches any known academic TLD suffix
 * or is in the known academic domains list.
 */
export function isAcademicEmail(email: string): boolean {
  const lower = email.toLowerCase().trim();
  const atIdx = lower.indexOf("@");
  if (atIdx === -1) return false;

  const domain = lower.slice(atIdx + 1);

  // Exact match in known academic domains
  if (KNOWN_ACADEMIC_DOMAINS.has(domain)) return true;

  // Check TLD suffix matches
  for (const suffix of ACADEMIC_TLD_SUFFIXES) {
    if (domain === suffix.replace(/^\./, "") || domain.endsWith(suffix)) {
      return true;
    }
  }

  return false;
}

/**
 * Determine the plan to assign to a new email user based on their email domain.
 * Returns 'academic' for academic emails, 'free_trial' for everyone else.
 */
export function getPlanForEmail(email: string): {
  plan: "academic" | "free_trial";
  trialExpiresAt: Date | null;
} {
  if (isAcademicEmail(email)) {
    return { plan: "academic", trialExpiresAt: null };
  }
  // Free trial: 30 days from now
  const trialExpiresAt = new Date();
  trialExpiresAt.setDate(trialExpiresAt.getDate() + 30);
  return { plan: "free_trial", trialExpiresAt };
}

/**
 * Check whether a user is within their plan limits for submitting an audit.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export function checkAuditLimit(user: {
  plan: string;
  trialExpiresAt: Date | null;
  auditCount: number;
}): { allowed: boolean; reason?: string } {
  const { plan, trialExpiresAt, auditCount } = user;

  switch (plan) {
    case "academic":
    case "platform":
      return { allowed: true };

    case "free_trial": {
      if (trialExpiresAt && new Date() > trialExpiresAt) {
        return {
          allowed: false,
          reason:
            "Your 30-day free trial has expired. Please upgrade to continue submitting audits.",
        };
      }
      if (auditCount >= 3) {
        return {
          allowed: false,
          reason:
            "You have used all 3 audits included in your free trial. Please upgrade to continue.",
        };
      }
      return { allowed: true };
    }

    case "starter":
      if (auditCount >= 10) {
        return {
          allowed: false,
          reason:
            "You have reached the 10-audit monthly limit for the Starter plan. Please upgrade to Diligence.",
        };
      }
      return { allowed: true };

    case "diligence":
      if (auditCount >= 50) {
        return {
          allowed: false,
          reason:
            "You have reached the 50-audit monthly limit for the Diligence plan. Please contact us to upgrade.",
        };
      }
      return { allowed: true };

    default:
      return { allowed: true };
  }
}
