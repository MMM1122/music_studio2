import type { Pattern } from "../domain/models";
import {
  generateSuggestions,
  type Suggestion,
  type SuggestionCategory,
  type SuggestionProject,
} from "./suggestions";

/** Remote providers must live behind a trusted server; never send an API secret from a browser. */
export interface InspirationRequest {
  /** Key and tempo are required. Tracks and patterns, when given, let ideas follow the song. */
  project: SuggestionProject;
  category: SuggestionCategory;
  seed: number;
  sourcePattern?: Pattern;
  /** Song position where the idea will be placed. */
  atTick?: number;
}
export interface InspirationProvider {
  readonly mode: "local" | "remote";
  suggest(
    request: InspirationRequest,
    signal?: AbortSignal,
  ): Promise<Suggestion[]>;
}
export class LocalInspirationProvider implements InspirationProvider {
  readonly mode = "local" as const;
  async suggest(
    request: InspirationRequest,
    signal?: AbortSignal,
  ): Promise<Suggestion[]> {
    signal?.throwIfAborted();
    // The generator uses musical context only, not storage or audio resources.
    return generateSuggestions(
      request.project,
      request.category,
      request.seed,
      request.sourcePattern,
      request.atTick,
    );
  }
}
