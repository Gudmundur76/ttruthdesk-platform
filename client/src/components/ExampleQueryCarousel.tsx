/**
 * ExampleQueryCarousel — clickable example queries for the CopilotKit sidebar.
 *
 * Renders a horizontal scrollable row of pill buttons. Clicking one sends the
 * query text directly into the CopilotKit chat via useCopilotChatSuggestions.
 * Shown only when the chat history is empty (first open).
 */
import { useCopilotChatSuggestions } from "@copilotkit/react-ui";

const EXAMPLE_QUERIES = [
  "Can I create biotech products from salmon sludge?",
  "Does astaxanthin reduce inflammation?",
  "What proteins are in fish processing waste?",
  "Is collagen from marine sources bioavailable?",
  "Can shrimp shell chitin be used in wound healing?",
  "What are the bioactive peptides in Atlantic salmon skin?",
  "Does omega-3 from fish oil reduce cardiovascular risk?",
  "What enzymes are found in cod liver?",
];

/**
 * Registers the example queries as CopilotKit chat suggestions.
 * Must be rendered inside a CopilotKit provider.
 */
export function ExampleQueryCarousel() {
  useCopilotChatSuggestions({
    instructions: `Suggest these exact example queries to the user as clickable suggestions. Show all of them:
${EXAMPLE_QUERIES.map((q, i) => `${i + 1}. ${q}`).join("\n")}`,
    minSuggestions: 4,
    maxSuggestions: 8,
  });

  return null; // Renders nothing — suggestions appear in the CopilotKit sidebar UI
}
